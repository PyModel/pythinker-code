import type { PathLike, Stats } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorCodes } from '../../src/errors';
import { SessionStore } from '../../src/session/store';

type StatFunction = (path: PathLike) => Promise<Stats>;

const statControl = vi.hoisted(() => ({
  actual: undefined as StatFunction | undefined,
  implementation: undefined as StatFunction | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const actualStat = actual.stat as StatFunction;
  statControl.actual = actualStat;
  return {
    ...actual,
    stat: (path: PathLike) => (statControl.implementation ?? actualStat)(path),
  };
});

const tempDirs: string[] = [];

afterEach(async () => {
  statControl.implementation = undefined;
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pythinker-session-store-'));
  tempDirs.push(dir);
  return dir;
}

function currentState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionFormatVersion: 2,
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    title: 'Stored session',
    isCustomTitle: false,
    agents: {
      main: {
        type: 'main',
        parentAgentId: null,
      },
    },
    custom: {},
    ...overrides,
  };
}

async function createCurrentSession(
  store: SessionStore,
  input: { readonly id: string; readonly workDir: string },
) {
  return store.create(input, async (summary) => {
    await mkdir(join(summary.sessionDir, 'agents', 'main'), { recursive: true });
    await writeFile(
      join(summary.sessionDir, 'state.json'),
      `${JSON.stringify(currentState(), null, 2)}\n`,
      'utf-8',
    );
    await writeFile(
      join(summary.sessionDir, 'agents', 'main', 'wire.jsonl'),
      '{"type":"metadata","protocol_version":"2.0","created_at":1}\n',
      'utf-8',
    );
  });
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('SessionStore persisted-state boundary', () => {
  it('rejects a raw own __proto__ agent entry before it can disappear during parsing', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    const source = await createCurrentSession(store, { id: 'ses_proto_agent', workDir });

    await writeFile(
      join(source.sessionDir, 'state.json'),
      '{"sessionFormatVersion":2,"createdAt":"2026-08-02T00:00:00.000Z","updatedAt":"2026-08-02T00:00:00.000Z","title":"Stored session","isCustomTitle":false,"agents":{"__proto__":{"type":"main","parentAgentId":null}},"custom":{}}\n',
      'utf-8',
    );

    await expect(store.get(source.id)).rejects.toMatchObject({ code: 'session.state_invalid' });
  });

  it('rejects a parentAgentId that exists only on the object prototype', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    const source = await createCurrentSession(store, { id: 'ses_proto_parent', workDir });
    await writeFile(
      join(source.sessionDir, 'state.json'),
      `${JSON.stringify(
        currentState({
          agents: {
            main: { type: 'main', parentAgentId: null },
            'agent-0': { type: 'sub', parentAgentId: 'toString' },
          },
        }),
      )}\n`,
      'utf-8',
    );

    await expect(store.get(source.id)).rejects.toMatchObject({
      code: 'session.state_invalid',
      message: 'Session agent "agent-0" references missing parent "toString"',
    });
  });

  it.each([
    ['missing format', currentState({ sessionFormatVersion: undefined })],
    ['older format', currentState({ sessionFormatVersion: 1 })],
    ['newer format', currentState({ sessionFormatVersion: 3 })],
    [
      'removed child homedir',
      currentState({
        agents: { main: { type: 'main', parentAgentId: null, homedir: '/tmp/outside' } },
      }),
    ],
    [
      'unsafe child id',
      currentState({
        agents: { '../outside': { type: 'main', parentAgentId: null } },
      }),
    ],
    [
      'missing parent reference',
      currentState({
        agents: {
          main: { type: 'main', parentAgentId: null },
          'agent-0': { type: 'sub', parentAgentId: 'missing-parent' },
        },
      }),
    ],
    [
      'cyclic parent references',
      currentState({
        agents: {
          main: { type: 'main', parentAgentId: null },
          'agent-0': { type: 'sub', parentAgentId: 'agent-1' },
          'agent-1': { type: 'sub', parentAgentId: 'agent-0' },
        },
      }),
    ],
    ['unknown root key', currentState({ unexpected: true })],
  ])('rejects %s through every direct store reader and mutator', async (_label, state) => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    const source = await createCurrentSession(store, { id: 'ses_invalid_state', workDir });
    await writeFile(join(source.sessionDir, 'state.json'), `${JSON.stringify(state)}\n`, 'utf-8');

    const operations = [
      () => store.get(source.id),
      () => store.list({ sessionId: source.id }),
      () => store.list({ workDir, sessionId: source.id }),
      () => store.rename(source.id, 'Renamed'),
      () => store.archive(source.id),
      () => store.fork({ sourceId: source.id, targetId: 'ses_invalid_fork' }),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: 'session.state_invalid' });
    }
  });

  it('skips invalid sessions during enumeration but rejects direct access', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    const valid = await createCurrentSession(store, { id: 'ses_valid', workDir });
    const invalid = await createCurrentSession(store, { id: 'ses_invalid', workDir });
    await writeFile(join(invalid.sessionDir, 'state.json'), '{"title":"old"}\n', 'utf-8');

    await expect(store.list({})).resolves.toMatchObject([{ id: valid.id }]);
    await expect(store.list({ workDir })).resolves.toMatchObject([{ id: valid.id }]);
    await expect(store.get(invalid.id)).rejects.toMatchObject({
      code: ErrorCodes.SESSION_STATE_INVALID,
    });
  });

  it('lists all sessions with bounded overlap while preserving order and filtering', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    const valid = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createCurrentSession(store, { id: `ses_concurrent_${String(index)}`, workDir }),
      ),
    );
    const archived = await createCurrentSession(store, { id: 'ses_concurrent_archived', workDir });
    const invalid = await createCurrentSession(store, { id: 'ses_concurrent_invalid', workDir });
    await writeFile(
      join(archived.sessionDir, 'state.json'),
      `${JSON.stringify(currentState({ archived: true }))}\n`,
      'utf-8',
    );
    await writeFile(join(invalid.sessionDir, 'state.json'), '{"title":"old"}\n', 'utf-8');

    const ordered = [...valid, archived];
    const baseMtime = Date.now() + 60_000;
    await Promise.all(
      ordered.map((session, index) =>
        utimes(
          join(session.sessionDir, 'agents', 'main', 'wire.jsonl'),
          new Date(baseMtime + index * 1_000),
          new Date(baseMtime + index * 1_000),
        ),
      ),
    );

    const targetDirs = new Set([...ordered, invalid].map((session) => session.sessionDir));
    const gatedDirs = new Set<string>();
    const firstStarted = deferred();
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const actualStat = statControl.actual!;
    statControl.implementation = async (path) => {
      const value = String(path);
      if (targetDirs.has(value) && !gatedDirs.has(value)) {
        gatedDirs.add(value);
        active += 1;
        peak = Math.max(peak, active);
        firstStarted.resolve();
        await gate.promise;
        active -= 1;
      }
      return actualStat(path);
    };

    const listing = store.list();
    try {
      await firstStarted.promise;
      gate.resolve();
      const visible = await listing;
      const withArchive = await store.list({ includeArchive: true });

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);
      expect(visible.map((session) => session.id)).toEqual(valid.toReversed().map((session) => session.id));
      expect(withArchive.map((session) => session.id)).toEqual(
        ordered.toReversed().map((session) => session.id),
      );
      expect(withArchive.map((session) => session.id)).not.toContain(invalid.id);
    } finally {
      gate.resolve();
      statControl.implementation = undefined;
    }
  });

  it('finds the newest agent wire mtime with bounded overlap', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    const session = await createCurrentSession(store, { id: 'ses_agent_mtimes', workDir });
    const wirePaths = await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        const agentId = index === 0 ? 'main' : `agent-${String(index)}`;
        const agentDir = join(session.sessionDir, 'agents', agentId);
        const wirePath = join(agentDir, 'wire.jsonl');
        await mkdir(agentDir, { recursive: true });
        await writeFile(wirePath, '{}\n', 'utf-8');
        const mtime = new Date(Date.now() + 60_000 + index * 1_000);
        await utimes(wirePath, mtime, mtime);
        return wirePath;
      }),
    );
    const newestMtime = (await stat(wirePaths.at(-1)!)).mtimeMs;

    const targetWires = new Set(wirePaths);
    const firstStarted = deferred();
    const gate = deferred();
    let active = 0;
    let peak = 0;
    const actualStat = statControl.actual!;
    statControl.implementation = async (path) => {
      if (targetWires.has(String(path))) {
        active += 1;
        peak = Math.max(peak, active);
        firstStarted.resolve();
        await gate.promise;
        active -= 1;
      }
      return actualStat(path);
    };

    const summaryPromise = store.get(session.id);
    try {
      await firstStarted.promise;
      gate.resolve();
      const summary = await summaryPromise;

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(8);
      expect(summary.updatedAt).toBe(newestMtime);
    } finally {
      gate.resolve();
      statControl.implementation = undefined;
    }
  });

  it('accepts archived state and preserves forkedFrom in a strict fork', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    const source = await createCurrentSession(store, { id: 'ses_archived_source', workDir });

    await expect(store.archive(source.id)).resolves.toMatchObject({ archived: true });
    await expect(store.get(source.id)).resolves.toMatchObject({ archived: true });

    const fork = await store.fork({ sourceId: source.id, targetId: 'ses_archived_fork' });
    const forkState = JSON.parse(await readFile(join(fork.sessionDir, 'state.json'), 'utf-8')) as {
      forkedFrom?: string;
      archived?: boolean;
    };
    expect(forkState.forkedFrom).toBe(source.id);
    expect(forkState.archived).toBe(true);
  });

  it('publishes a created session only after its initializer writes current state', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    let initialized = false;
    let release: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });

    const creating = store.create({ id: 'ses_pending', workDir }, async (summary) => {
      initialized = true;
      await ready;
      await writeFile(
        join(summary.sessionDir, 'state.json'),
        `${JSON.stringify(currentState(), null, 2)}\n`,
        'utf-8',
      );
    });
    await vi.waitFor(() => {
      expect(initialized).toBe(true);
    });

    expect(initialized).toBe(true);
    await expect(store.get('ses_pending')).rejects.toMatchObject({ code: 'session.not_found' });
    await expect(store.list()).resolves.toEqual([]);
    await expect(store.list({ workDir })).resolves.toEqual([]);
    await expect(store.list({ workDir, sessionId: 'ses_pending' })).resolves.toEqual([]);

    release?.();
    await expect(creating).resolves.toMatchObject({ id: 'ses_pending' });
    await expect(store.get('ses_pending')).resolves.toMatchObject({ id: 'ses_pending' });
    await expect(store.list({ workDir })).resolves.toHaveLength(1);
  });

  it('removes only the unpublished directory when its initializer fails', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const store = new SessionStore(homeDir);
    const sessionDir = store.sessionDirFor({ id: 'ses_failed_initializer', workDir });

    await expect(
      store.create({ id: 'ses_failed_initializer', workDir }, async () => {
        throw new Error('initializer failed');
      }),
    ).rejects.toThrow('initializer failed');
    await expect(store.get('ses_failed_initializer')).rejects.toMatchObject({
      code: 'session.not_found',
    });
    await expect(readFile(sessionDir, 'utf-8')).rejects.toThrow('ENOENT');
  });
});
