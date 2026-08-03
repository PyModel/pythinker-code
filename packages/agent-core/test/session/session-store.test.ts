import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionStore } from '../../src/session/store';

const tempDirs: string[] = [];

afterEach(async () => {
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
      () => store.list(),
      () => store.list({ workDir }),
      () => store.list({ workDir, sessionId: source.id }),
      () => store.rename(source.id, 'Renamed'),
      () => store.archive(source.id),
      () => store.fork({ sourceId: source.id, targetId: 'ses_invalid_fork' }),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: 'session.state_invalid' });
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
