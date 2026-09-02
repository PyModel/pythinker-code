import { mkdtemp, mkdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileStorageService } from '#/persistence/backends/node-fs/fileStorageService';

const fsReadHook = vi.hoisted(() => ({
  transform: undefined as
    | ((path: string, bytes: Uint8Array) => Uint8Array | undefined)
    | undefined,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const bytes = await actual.readFile(...args);
      if (typeof bytes === 'string') return bytes;
      const path = args[0];
      return typeof path === 'string' ? (fsReadHook.transform?.(path, bytes) ?? bytes) : bytes;
    },
  };
});

const isWin = process.platform === 'win32';
const encoder = new TextEncoder();

describe('FileStorageService — consistent reads', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fss-read-'));
  });

  afterEach(async () => {
    fsReadHook.transform = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it('retries when the bytes read are shorter than the file size', async () => {
    const path = join(dir, 'scope', 'k.json');
    const expected = encoder.encode('{"model":"ready"}');
    const svc = new FileStorageService(dir);
    await svc.write('scope', 'k.json', expected);
    let reads = 0;
    fsReadHook.transform = (readPath, bytes) => {
      if (readPath !== path) return undefined;
      reads += 1;
      return reads === 1 ? bytes.subarray(0, 4) : bytes;
    };

    expect(new TextDecoder().decode(await svc.read('scope', 'k.json'))).toBe('{"model":"ready"}');
    expect(reads).toBe(2);
  });

  it('waits for a non-atomic replacement to settle before notifying readers', async () => {
    const path = join(dir, 'scope', 'config.toml');
    const svc = new FileStorageService(dir);
    await svc.write('scope', 'config.toml', encoder.encode('model = "old"\n'));
    const snapshots: string[] = [];
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const subscription = svc.watch('scope', 'config.toml')(async () => {
      snapshots.push(new TextDecoder().decode(await svc.read('scope', 'config.toml')));
      resolveFirst();
    });

    try {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
      await writeFile(path, '');
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
      await writeFile(path, 'model = "ready"\n');
      await first;
      subscription.dispose();

      expect(snapshots).toEqual(['model = "ready"\n']);
    } finally {
      subscription.dispose();
    }
  });

  it('waits for a delayed atomic replacement before notifying readers', async () => {
    const path = join(dir, 'scope', 'config.toml');
    const replacement = join(dir, 'scope', 'config.toml.next');
    const svc = new FileStorageService(dir);
    await svc.write('scope', 'config.toml', encoder.encode('model = "old"\n'));
    const snapshots: string[] = [];
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const subscription = svc.watch('scope', 'config.toml')(async () => {
      try {
        snapshots.push(new TextDecoder().decode(await svc.read('scope', 'config.toml')));
      } catch {
        snapshots.push('<missing>');
      }
      resolveFirst();
    });

    try {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
      await writeFile(replacement, 'model = "ready"\n');
      await rm(path);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 300);
      });
      await rename(replacement, path);
      await first;
      subscription.dispose();

      expect(snapshots).toEqual(['model = "ready"\n']);
    } finally {
      subscription.dispose();
    }
  });
});

describe('FileStorageService — file permissions', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fss-perm-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(isWin)('creates scope directories with dirMode (0700)', async () => {
    const svc = new FileStorageService(dir, 0o700, 0o600);
    await svc.write('cron/ws', 'abc.json', encoder.encode('{}'));

    const dirStat = await stat(join(dir, 'cron/ws'));
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it.skipIf(isWin)('writes documents with fileMode (0600)', async () => {
    const svc = new FileStorageService(dir, 0o700, 0o600);
    await svc.write('cron/ws', 'abc.json', encoder.encode('{"x":1}'));

    const fileStat = await stat(join(dir, 'cron/ws', 'abc.json'));
    expect(fileStat.mode & 0o777).toBe(0o600);
  });

  it.skipIf(isWin)('defaults to the process umask when modes are omitted', async () => {
    const svc = new FileStorageService(dir);
    await svc.write('scope', 'k.json', encoder.encode('{}'));
    const fileStat = await stat(join(dir, 'scope', 'k.json'));
    expect(fileStat.mode & 0o400).toBe(0o400);
  });
});

describe('FileStorageService — error translation', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fss-err-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps ENOENT semantics: read returns undefined, list returns []', async () => {
    const svc = new FileStorageService(dir);
    expect(await svc.read('scope', 'missing.json')).toBeUndefined();
    expect(await svc.list('missing-scope')).toEqual([]);
    await expect(svc.delete('scope', 'missing.json')).resolves.toBeUndefined();
  });

  it.skipIf(isWin)('translates non-ENOENT failures into StorageError(io_failed)', async () => {
    const svc = new FileStorageService(dir);
    await mkdir(join(dir, 'scope', 'adir'), { recursive: true });
    await expect(svc.read('scope', 'adir')).rejects.toSatisfy((error: unknown) => {
      expect(error).toMatchObject({ code: 'storage.io_failed' });
      const io = error as { details?: Record<string, unknown>; cause?: unknown };
      expect(io.details).toMatchObject({
        path: join(dir, 'scope', 'adir'),
        op: 'read',
        errno: 'EISDIR',
      });
      expect(io.cause).toBeInstanceOf(Error);
      return true;
    });
  });

  it.skipIf(isWin)('translates write failures into StorageError(io_failed)', async () => {
    const svc = new FileStorageService(dir);
    await writeFile(join(dir, 'blocked'), 'x');
    await expect(svc.write('blocked', 'k.json', encoder.encode('{}'))).rejects.toMatchObject({
      code: 'storage.io_failed',
      details: { op: 'write', errno: expect.any(String) },
    });
  });
});

describe('FileStorageService — writeStream', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fss-stream-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a chunked source and replaces the whole value', async () => {
    const svc = new FileStorageService(dir);
    await svc.write('scope', 'k.bin', encoder.encode('old'));
    await svc.writeStream('scope', 'k.bin', (async function* () {
      yield encoder.encode('aa');
      yield encoder.encode('bbb');
    })());

    const chunks: Uint8Array[] = [];
    for await (const chunk of svc.readStream('scope', 'k.bin')) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString()).toBe('aabbb');
  });

  it('leaves no target file behind when the source fails mid-stream', async () => {
    const svc = new FileStorageService(dir);
    await expect(
      svc.writeStream('scope', 'k.bin', (async function* () {
        yield encoder.encode('partial');
        throw new Error('boom');
      })()),
    ).rejects.toThrow();

    expect(await svc.read('scope', 'k.bin')).toBeUndefined();
    expect(await svc.list('scope')).toEqual([]);
  });
});

describe('FileStorageService — mtime', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fss-mtime-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns undefined for a missing file and the stat mtime for an existing one', async () => {
    const svc = new FileStorageService(dir);
    expect(await svc.mtime('scope', 'missing.json')).toBeUndefined();

    await svc.write('scope', 'k.json', encoder.encode('{}'));
    const expected = (await stat(join(dir, 'scope', 'k.json'))).mtimeMs;
    expect(await svc.mtime('scope', 'k.json')).toBe(expected);
  });

  it('reflects rewrites and deletions', async () => {
    const svc = new FileStorageService(dir);
    await svc.write('scope', 'k.json', encoder.encode('{}'));
    const before = await svc.mtime('scope', 'k.json');

    const bumped = new Date(Date.now() + 10_000);
    await utimes(join(dir, 'scope', 'k.json'), bumped, bumped);
    expect(await svc.mtime('scope', 'k.json')).toBeGreaterThan(before ?? 0);

    await svc.delete('scope', 'k.json');
    expect(await svc.mtime('scope', 'k.json')).toBeUndefined();
  });
});
