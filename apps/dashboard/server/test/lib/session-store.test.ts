// apps/dashboard/server/test/lib/session-store.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { buildSessionFixture } from '../fixtures/build';
import { isSafeAgentId, listSessions, readSessionDetail } from '../../src/lib/session-store';

describe('session-store', () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => { if (cleanup) await cleanup(); cleanup = null; });

  it('lists native session with correct timestamps and counts', async () => {
    const { home, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const sessions = await listSessions(home);
    expect(sessions).toHaveLength(1);
    const s = sessions[0]!;
    expect(s.sessionId).toBe('session_fixture');
    expect(s.title).toBe('fixture: hello world');
    expect(s.lastPrompt).toBe('say hi');
    expect(s.agentCount).toBe(2);
    expect(s.mainAgentExists).toBe(true);
    expect(s.mainWireRecordCount).toBe(10);  // 10 lines in main wire incl. metadata
    expect(s.wireProtocolVersion).toBe('2.0');
    expect(s.health).toBe('ok');
    expect(s.workDir).toBe('/tmp/work');
    expect(s.createdAt).toBe(Date.parse('2026-05-20T05:59:51.085Z'));
    expect(s.updatedAt).toBe(Date.parse('2026-05-21T03:12:08.000Z'));
  });

  it('marks an older wire as incompatible', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { readFile, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const wirePath = join(sessionDir, 'agents', 'main', 'wire.jsonl');
    const lines = (await readFile(wirePath, 'utf8')).split('\n');
    lines[0] = JSON.stringify({ type: 'metadata', protocol_version: '1.0', created_at: 1 });
    await writeFile(wirePath, lines.join('\n'));
    const sessions = await listSessions(home);
    expect(sessions[0]!.health).toBe('incompatible_wire');
    expect(sessions[0]!.wireProtocolVersion).toBeNull();
  });

  it('marks a newer wire as incompatible', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { readFile, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const wirePath = join(sessionDir, 'agents', 'main', 'wire.jsonl');
    const lines = (await readFile(wirePath, 'utf8')).split('\n');
    lines[0] = JSON.stringify({ type: 'metadata', protocol_version: '2.2', created_at: 1 });
    await writeFile(wirePath, lines.join('\n'));
    const sessions = await listSessions(home);
    expect(sessions[0]!.health).toBe('incompatible_wire');
    expect(sessions[0]!.wireProtocolVersion).toBeNull();
  });

  it('falls back to empty workDir when session is not in the index', async () => {
    const { home, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await rm(join(home, 'session_index.jsonl'));
    const sessions = await listSessions(home);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.workDir).toBe('');
  });

  it('marks a session incompatible when its wire file cannot be scanned', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { rm, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    // Replace the wire FILE with a directory of the same name, so the
    // createReadStream below will reject with EISDIR.
    const wirePath = join(sessionDir, 'agents', 'main', 'wire.jsonl');
    await rm(wirePath);
    await mkdir(wirePath);
    const sessions = await listSessions(home);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.health).toBe('incompatible_wire');
    expect(sessions[0]!.mainWireRecordCount).toBe(0);
  });

  it('keeps a valid session with no main wire listable as missing_main_wire', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await rm(join(sessionDir, 'agents', 'main', 'wire.jsonl'));

    const sessions = await listSessions(home);
    expect(sessions[0]!.health).toBe('missing_main_wire');
    const detail = await readSessionDetail(home, 'session_fixture');
    expect(detail!.agents.find((agent) => agent.agentId === 'main')!.wireExists).toBe(false);
  });

  it('keeps a valid session with no main agent listable as missing_main_wire', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { readFile, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const statePath = join(sessionDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      agents: Record<string, { parentAgentId: string | null }>;
    };
    delete state.agents['main'];
    state.agents['agent-0']!.parentAgentId = null;
    await writeFile(statePath, JSON.stringify(state));

    const sessions = await listSessions(home);
    expect(sessions[0]!.health).toBe('missing_main_wire');
    expect(sessions[0]!.mainAgentExists).toBe(false);
  });

  it('marks a session incompatible when the wire metadata header is malformed', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const wirePath = join(sessionDir, 'agents', 'main', 'wire.jsonl');
    // First line is not a `metadata` record — list health used to stay
    // 'ok' while readAgentWire would fail on open.
    await writeFile(
      wirePath,
      '{"type":"config.update","cwd":"/x","time":1}\n',
    );
    const sessions = await listSessions(home);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.health).toBe('incompatible_wire');
  });

  it('rejects unsafe agent ids', () => {
    expect(isSafeAgentId('main')).toBe(true);
    expect(isSafeAgentId('agent-0')).toBe(true);
    expect(isSafeAgentId('agent_0.v2')).toBe(true);
    expect(isSafeAgentId('..')).toBe(false);
    expect(isSafeAgentId('.')).toBe(false);
    expect(isSafeAgentId('../foo')).toBe(false);
    expect(isSafeAgentId('a/b')).toBe(false);
    expect(isSafeAgentId('a\\b')).toBe(false);
    expect(isSafeAgentId('')).toBe(false);
  });

  it('rejects unsafe agent ids in strict state metadata', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { readFile, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const statePath = join(sessionDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.agents['../escape'] = {
      type: 'sub',
      parentAgentId: 'main',
    };
    await writeFile(statePath, JSON.stringify(state));
    await expect(readSessionDetail(home, 'session_fixture')).rejects.toMatchObject({ kind: 'state' });
  });

  it('rejects session_index entries that point outside PYTHINKER_CODE_HOME', async () => {
    const { home, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    // Poison the index: claim session_fixture lives at /tmp/elsewhere.
    const elsewhere = '/tmp/dashboard-poison-test-' + Date.now();
    await mkdir(elsewhere, { recursive: true });
    await writeFile(
      join(home, 'session_index.jsonl'),
      JSON.stringify({
        sessionId: 'session_fixture',
        sessionDir: elsewhere,
        workDir: '/somewhere',
      }) + '\n',
    );
    // Detail must fall back to bucket scanning (legit path under home)
    // rather than honour the poisoned index entry.
    const d = await readSessionDetail(home, 'session_fixture');
    expect(d).not.toBeNull();
    expect(d!.sessionDir.startsWith(home)).toBe(true);
    const { rm } = await import('node:fs/promises');
    await rm(elsewhere, { recursive: true, force: true });
  });

  it('rejects an unreadable subagent wire instead of leaking the agent inventory', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    // Break the subagent wire after valid state metadata is loaded.
    await writeFile(
      join(sessionDir, 'agents', 'agent-0', 'wire.jsonl'),
      'not even json\n',
    );
    await expect(readSessionDetail(home, 'session_fixture')).rejects.toMatchObject({ kind: 'wire' });
  });

  it('exposes the canonical session directory in detail responses', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const d = await readSessionDetail(home, 'session_fixture');
    expect(d!.sessionDir).toBe(sessionDir);
  });

  it('lists incompatible state without exposing detail or disk agents', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await writeFile(join(sessionDir, 'state.json'), '{ this is not json');
    const summaries = await listSessions(home);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.health).toBe('incompatible_state');
    await expect(readSessionDetail(home, 'session_fixture')).rejects.toMatchObject({ kind: 'state' });
  });

  it('reads session detail with full agent inventory', async () => {
    const { home, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const d = await readSessionDetail(home, 'session_fixture');
    expect(d).not.toBeNull();
    expect(d!.workDir).toBe('/tmp/work');
    expect(d!.agents.map((a) => a.agentId).toSorted()).toEqual(['agent-0', 'main']);
    const main = d!.agents.find((a) => a.agentId === 'main')!;
    expect(main.type).toBe('main');
    expect(main.parentAgentId).toBeNull();
    expect(main.wireExists).toBe(true);
    expect(main.wireRecordCount).toBe(10);
    const sub = d!.agents.find((a) => a.agentId === 'agent-0')!;
    expect(sub.parentAgentId).toBe('main');
  });

  it('surfaces dynamicWorkflowItem from state metadata without the removed field', async () => {
    const { home, sessionDir, cleanup: c } = await buildSessionFixture('sample-main');
    cleanup = c;
    const { readFile, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const statePath = join(sessionDir, 'state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    state.agents['agent-0'].dynamicWorkflowItem = 'task A';
    await writeFile(statePath, JSON.stringify(state));
    const d = await readSessionDetail(home, 'session_fixture');
    expect(d).not.toBeNull();
    const sub = d!.agents.find((a) => a.agentId === 'agent-0')!;
    expect(sub.dynamicWorkflowItem).toBe('task A');
    expect(sub).not.toHaveProperty('swarmItem');
    // main has no dynamicWorkflowItem in state.json → null, not undefined.
    const main = d!.agents.find((a) => a.agentId === 'main')!;
    expect(main.dynamicWorkflowItem).toBeNull();
  });
});
