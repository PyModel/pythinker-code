import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { LocalKaos, type Kaos } from '@pymodel/kaos';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCodes } from '../../src/errors';
import { SessionFileCheckpointStore } from '../../src/session/file-checkpoints';

describe('SessionFileCheckpointStore', () => {
  let root: string;
  let workspace: string;
  let sessionDir: string;
  let persistenceKaos: LocalKaos;
  let kaos: Kaos;
  let store: SessionFileCheckpointStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pythinker-file-checkpoints-'));
    workspace = join(root, 'workspace');
    sessionDir = join(root, 'session');
    persistenceKaos = await LocalKaos.create();
    await persistenceKaos.mkdir(workspace);
    await persistenceKaos.mkdir(sessionDir);
    kaos = persistenceKaos.withCwd(workspace);
    store = new SessionFileCheckpointStore(kaos, persistenceKaos, sessionDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('does not read checkpoint persistence before the store is used', async () => {
    const readText = vi.fn(() => new Promise<string>(() => {}));
    new SessionFileCheckpointStore(
      kaos,
      overrideKaos(persistenceKaos, {
        mkdir: vi.fn().mockResolvedValue(undefined),
        readText,
      }),
      join(root, 'unused-session'),
    );

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(readText).not.toHaveBeenCalled();
  });

  it('restores the first before-image captured for a path', async () => {
    const path = join(workspace, 'greeting.txt');
    await kaos.writeText(path, 'before\n');
    const checkpointId = await store.beginUserCheckpoint('change greeting');

    await store.capture(checkpointId, path);
    await kaos.writeText(path, 'middle\n');
    await store.capture(checkpointId, path);
    await kaos.writeText(path, 'after\n');

    const result = await store.restore(checkpointId);

    expect(await kaos.readText(path)).toBe('before\n');
    expect(result.restoredPaths).toEqual([path]);
    expect(result.deletedPaths).toEqual([]);
    expect(result.recoveryCheckpointId).not.toBe(checkpointId);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: checkpointId, kind: 'user', complete: true }),
      expect.objectContaining({
        id: result.recoveryCheckpointId,
        kind: 'recovery',
        complete: true,
      }),
    ]);
  });

  it('deletes a file that did not exist before its checkpoint', async () => {
    const path = join(workspace, 'created.txt');
    const checkpointId = await store.beginUserCheckpoint('create file');

    await store.capture(checkpointId, path);
    await kaos.writeText(path, 'created\n');

    const result = await store.restore(checkpointId);

    await expect(kaos.stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(result.restoredPaths).toEqual([]);
    expect(result.deletedPaths).toEqual([path]);
  });

  it.runIf(process.platform !== 'win32')(
    'restores the captured file mode',
    async () => {
      const path = join(workspace, 'script.sh');
      await kaos.writeText(path, '#!/bin/sh\n');
      await kaos.chmod(path, 0o600);
      const checkpointId = await store.beginUserCheckpoint('make script executable');

      await store.capture(checkpointId, path);
      await kaos.writeText(path, '#!/bin/sh\necho changed\n');
      await kaos.chmod(path, 0o755);

      await store.restore(checkpointId);

      expect(await kaos.readText(path)).toBe('#!/bin/sh\n');
      expect((await kaos.stat(path)).stMode & 0o777).toBe(0o600);
    },
  );

  it('restores every path first changed at or after the selected checkpoint', async () => {
    const firstPath = join(workspace, 'first.txt');
    const secondPath = join(workspace, 'second.txt');
    await kaos.writeText(firstPath, 'first-before\n');
    await kaos.writeText(secondPath, 'second-before\n');

    const firstCheckpoint = await store.beginUserCheckpoint('first change');
    await store.capture(firstCheckpoint, firstPath);
    await kaos.writeText(firstPath, 'first-middle\n');

    const secondCheckpoint = await store.beginUserCheckpoint('second change');
    await store.capture(secondCheckpoint, firstPath);
    await store.capture(secondCheckpoint, secondPath);
    await kaos.writeText(firstPath, 'first-after\n');
    await kaos.writeText(secondPath, 'second-after\n');

    await store.restore(firstCheckpoint);

    expect(await kaos.readText(firstPath)).toBe('first-before\n');
    expect(await kaos.readText(secondPath)).toBe('second-before\n');
  });

  it('replays persisted checkpoints after resume', async () => {
    const path = join(workspace, 'persisted.txt');
    await kaos.writeText(path, 'before\n');
    const checkpointId = await store.beginUserCheckpoint('persist this');
    await store.capture(checkpointId, path);
    await kaos.writeText(path, 'after\n');

    const resumed = new SessionFileCheckpointStore(
      kaos,
      persistenceKaos,
      sessionDir,
    );

    await expect(resumed.list()).resolves.toEqual([
      expect.objectContaining({
        id: checkpointId,
        prompt: 'persist this',
        changedPaths: [path],
        complete: true,
      }),
    ]);
    await resumed.restore(checkpointId);
    expect(await kaos.readText(path)).toBe('before\n');
  });

  it('keeps only the newest 100 checkpoints across resume', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 101; index++) {
      ids.push(await store.beginUserCheckpoint(`prompt ${String(index)}`));
    }

    const summaries = await store.list();
    expect(summaries).toHaveLength(100);
    expect(summaries.map((summary) => summary.id)).not.toContain(ids[0]);
    expect(summaries.at(-1)?.id).toBe(ids.at(-1));

    const resumed = new SessionFileCheckpointStore(
      kaos,
      persistenceKaos,
      sessionDir,
    );
    const resumedSummaries = await resumed.list();
    expect(resumedSummaries).toHaveLength(100);
    expect(resumedSummaries.map((summary) => summary.id)).not.toContain(ids[0]);
  });

  it('serializes concurrent captures so one path is read once', async () => {
    const path = join(workspace, 'concurrent.txt');
    await kaos.writeText(path, 'before\n');
    const readText = vi.fn((candidate: string) => kaos.readText(candidate));
    const countingKaos = overrideKaos(kaos, { readText });
    store = new SessionFileCheckpointStore(
      countingKaos,
      persistenceKaos,
      sessionDir,
    );
    const checkpointId = await store.beginUserCheckpoint('concurrent change');

    await Promise.all([
      store.capture(checkpointId, path),
      store.capture(checkpointId, path),
    ]);

    expect(readText).toHaveBeenCalledTimes(1);
  });

  it('marks a failed capture incomplete and refuses preview and restore after resume', async () => {
    const path = join(workspace, 'unreadable.txt');
    await kaos.writeText(path, 'before\n');
    const diagnostics: string[] = [];
    const failingKaos = overrideKaos(kaos, {
      readText: async () => {
        throw new Error('read denied');
      },
    });
    store = new SessionFileCheckpointStore(
      failingKaos,
      persistenceKaos,
      sessionDir,
      (message) => diagnostics.push(message),
    );
    const checkpointId = await store.beginUserCheckpoint('unsafe change');

    await expect(store.capture(checkpointId, path)).resolves.toBeUndefined();
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: checkpointId, complete: false }),
    ]);
    expect(diagnostics).toEqual([
      expect.stringContaining(`Failed to capture ${path}`),
    ]);

    const resumed = new SessionFileCheckpointStore(
      kaos,
      persistenceKaos,
      sessionDir,
    );
    await expect(resumed.preview(checkpointId)).rejects.toMatchObject({
      code: ErrorCodes.REQUEST_INVALID,
    });
    await expect(resumed.restore(checkpointId)).rejects.toMatchObject({
      code: ErrorCodes.REQUEST_INVALID,
    });
  });

  it('refuses an earlier restore when a later checkpoint is incomplete', async () => {
    const safePath = join(workspace, 'safe.txt');
    const failedPath = join(workspace, 'failed.txt');
    await kaos.writeText(safePath, 'safe-before\n');
    await kaos.writeText(failedPath, 'failed-before\n');
    const toolKaos = overrideKaos(kaos, {
      readText: async (path) => {
        if (path === failedPath) throw new Error('read denied');
        return kaos.readText(path);
      },
    });
    store = new SessionFileCheckpointStore(
      toolKaos,
      persistenceKaos,
      sessionDir,
    );

    const firstCheckpoint = await store.beginUserCheckpoint('safe change');
    await store.capture(firstCheckpoint, safePath);
    await kaos.writeText(safePath, 'safe-after\n');
    const secondCheckpoint = await store.beginUserCheckpoint('failed change');
    await store.capture(secondCheckpoint, failedPath);

    await expect(store.restore(firstCheckpoint)).rejects.toMatchObject({
      code: ErrorCodes.REQUEST_INVALID,
    });
    expect(await kaos.readText(safePath)).toBe('safe-after\n');
  });

  it('fails backup preflight before mutating the workspace', async () => {
    const path = join(workspace, 'missing-backup.txt');
    await kaos.writeText(path, 'before\n');
    const checkpointId = await store.beginUserCheckpoint('lose backup');
    await store.capture(checkpointId, path);
    await kaos.writeText(path, 'after\n');
    const capture = await persistedCapture(sessionDir, persistenceKaos, checkpointId);
    if (capture.image.absent === true) {
      throw new Error('Expected a content capture.');
    }
    await persistenceKaos.unlink(
      join(sessionDir, 'file-checkpoints', 'blobs', capture.image.blob),
    );

    await expect(store.restore(checkpointId)).rejects.toBeInstanceOf(Error);
    expect(await kaos.readText(path)).toBe('after\n');
    expect((await store.list()).filter((item) => item.kind === 'recovery')).toEqual([]);
  });

  it('fails recovery capture before mutating the workspace', async () => {
    const path = join(workspace, 'recovery-preflight.txt');
    await kaos.writeText(path, 'before\n');
    const checkpointId = await store.beginUserCheckpoint('prepare restore');
    await store.capture(checkpointId, path);
    await kaos.writeText(path, 'after\n');
    store.setToolKaos(
      overrideKaos(kaos, {
        readText: async () => {
          throw new Error('current file unreadable');
        },
      }),
    );

    await expect(store.restore(checkpointId)).rejects.toMatchObject({
      code: ErrorCodes.REQUEST_INVALID,
    });
    expect(await kaos.readText(path)).toBe('after\n');
  });

  it('rolls back partial workspace mutation and reports the recovery checkpoint', async () => {
    const firstPath = join(workspace, 'rollback-first.txt');
    const secondPath = join(workspace, 'rollback-second.txt');
    await kaos.writeText(firstPath, 'first-before\n');
    await kaos.writeText(secondPath, 'second-before\n');
    const checkpointId = await store.beginUserCheckpoint('restore with failure');
    await store.capture(checkpointId, firstPath);
    await store.capture(checkpointId, secondPath);
    await kaos.writeText(firstPath, 'first-after\n');
    await kaos.writeText(secondPath, 'second-after\n');

    let injected = false;
    store.setToolKaos(
      overrideKaos(kaos, {
        writeText: async (path, data, options) => {
          if (path === secondPath && data === 'second-before\n' && !injected) {
            injected = true;
            throw new Error('injected restore failure');
          }
          return kaos.writeText(path, data, options);
        },
      }),
    );

    const error = await store.restore(checkpointId).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(error).toMatchObject({
      code: ErrorCodes.REQUEST_INVALID,
      details: {
        checkpointId,
        recoveryCheckpointId: expect.any(String),
        failures: [
          { path: secondPath, message: 'injected restore failure' },
        ],
        rollbackFailures: [],
      },
    });
    expect(await kaos.readText(firstPath)).toBe('first-after\n');
    expect(await kaos.readText(secondPath)).toBe('second-after\n');
  });

  it('restores a recovery checkpoint from its direct images', async () => {
    const path = join(workspace, 'recoverable.txt');
    await kaos.writeText(path, 'before\n');
    const checkpointId = await store.beginUserCheckpoint('rewind once');
    await store.capture(checkpointId, path);
    await kaos.writeText(path, 'after\n');

    const firstRestore = await store.restore(checkpointId);
    expect(await kaos.readText(path)).toBe('before\n');

    await store.restore(firstRestore.recoveryCheckpointId);
    expect(await kaos.readText(path)).toBe('after\n');
  });

  it('previews exact line and mode changes without mutating files', async () => {
    const path = join(workspace, 'preview.txt');
    await kaos.writeText(path, 'one\ntwo\n');
    const checkpointId = await store.beginUserCheckpoint('preview lines');
    await store.capture(checkpointId, path);
    await kaos.writeText(path, 'one\nthree\nfour\n');

    const preview = await store.preview(checkpointId);

    expect(preview).toEqual({
      checkpointId,
      complete: true,
      paths: [
        {
          path,
          insertions: 2,
          deletions: 1,
          modeChanged: false,
        },
      ],
      insertions: 2,
      deletions: 1,
    });
    expect(await kaos.readText(path)).toBe('one\nthree\nfour\n');
  });

  it.runIf(process.platform !== 'win32')(
    'includes a mode-only change in preview',
    async () => {
      const path = join(workspace, 'mode-only.txt');
      await kaos.writeText(path, 'unchanged\n');
      await kaos.chmod(path, 0o600);
      const checkpointId = await store.beginUserCheckpoint('preview mode');
      await store.capture(checkpointId, path);
      await kaos.chmod(path, 0o644);

      await expect(store.preview(checkpointId)).resolves.toMatchObject({
        paths: [
          {
            path,
            insertions: 0,
            deletions: 0,
            modeChanged: true,
          },
        ],
      });
    },
  );
});

function overrideKaos(base: Kaos, overrides: Partial<Kaos>): Kaos {
  return new Proxy(base, {
    get(target, property, receiver) {
      const override = Reflect.get(overrides, property);
      if (override !== undefined) return override;
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

interface PersistedCapture {
  readonly type: 'capture';
  readonly checkpointId: string;
  readonly image:
    | { readonly path: string; readonly absent: true }
    | { readonly path: string; readonly absent?: false; readonly blob: string; readonly mode: number };
}

async function persistedCapture(
  sessionDir: string,
  kaos: Kaos,
  checkpointId: string,
): Promise<PersistedCapture> {
  const manifest = await kaos.readText(
    join(sessionDir, 'file-checkpoints', 'manifest.jsonl'),
  );
  const capture = manifest
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown)
    .find(
      (event): event is PersistedCapture =>
        isRecord(event) &&
        event['type'] === 'capture' &&
        event['checkpointId'] === checkpointId,
    );
  if (capture === undefined) throw new Error('Persisted capture not found.');
  return capture;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
