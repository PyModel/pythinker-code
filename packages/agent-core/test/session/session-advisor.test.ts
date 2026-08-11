import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { testKaos } from '../fixtures/test-kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import type { PythinkerConfig } from '../../src/config';
import type { ResolvedAgentProfile } from '../../src/profile';
import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import { ProviderManager } from '../../src/session/provider-manager';
import { createScriptedGenerate } from '../agent/harness/scripted-generate';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('SessionAdvisor', () => {
  it('does not spawn an advisor when config is disabled', async () => {
    const fixture = await createFixture();
    const spawn = vi.spyOn(fixture.session, 'createAgent');

    fixture.scripted.mockNextResponse({ type: 'text', text: 'Done.' });
    await runMainTurn(fixture.main);
    await flushAsync();

    expect(spawn).not.toHaveBeenCalled();
    await fixture.session.close();
  });

  it('buffers notes while idle and steers them into the next user turn', async () => {
    const fixture = await createFixture({ advisorAlias: 'advisor' });
    const spawn = vi.spyOn(fixture.session, 'createAgent');
    const steer = vi.spyOn(fixture.main.turn, 'steer').mockReturnValue(null);
    queueReview(fixture.scripted, 'Check the error path.', 'concern');

    await runMainTurn(fixture.main);
    await waitForAdvisor(fixture);

    expect(spawn).toHaveBeenCalledOnce();
    const child = (await spawn.mock.results[0]!.value).agent;
    expect(child.config.modelAlias).toBe('advisor');
    expect(steer).not.toHaveBeenCalled();

    fixture.scripted.mockNextResponse({ type: 'text', text: 'Next turn.' });
    await runMainTurn(fixture.main);

    expect(steer).toHaveBeenCalledWith(
      [
        {
          type: 'text',
          text: expect.stringContaining(
            '<advisory>\nThe following notes are from a second reviewing model. Weigh them; do not blindly obey.\n- [concern] Check the error path.',
          ),
        },
      ],
      { kind: 'hook_result', event: 'advisor' },
    );
    await fixture.session.close();
  });

  it('skips a cross-provider advisor and warns once', async () => {
    const fixture = await createFixture({ advisorAlias: 'cross-advisor' });
    const spawn = vi.spyOn(fixture.session, 'createAgent');
    const warn = vi.spyOn(fixture.session.log, 'warn');
    const steer = vi.spyOn(fixture.main.turn, 'steer');

    fixture.scripted.mockNextResponse({ type: 'text', text: 'First.' });
    await runMainTurn(fixture.main);
    fixture.scripted.mockNextResponse({ type: 'text', text: 'Second.' });
    await runMainTurn(fixture.main);
    await flushAsync();

    expect(spawn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(steer).not.toHaveBeenCalled();
    await fixture.session.close();
  });

  it('stays idle without an advisor model', async () => {
    const fixture = await createFixture({ enabled: true });
    const spawn = vi.spyOn(fixture.session, 'createAgent');

    fixture.scripted.mockNextResponse({ type: 'text', text: 'Done.' });
    await runMainTurn(fixture.main);
    await flushAsync();

    expect(spawn).not.toHaveBeenCalled();
    await fixture.session.close();
  });

  it('does not steer when the advisor returns no notes', async () => {
    const fixture = await createFixture({ advisorAlias: 'advisor' });
    const steer = vi.spyOn(fixture.main.turn, 'steer');
    queueReview(fixture.scripted);

    await runMainTurn(fixture.main);
    await waitForAdvisor(fixture);

    expect(steer).not.toHaveBeenCalled();
    await fixture.session.close();
  });

  it('does not start a second advisor while one is running', async () => {
    const fixture = await createFixture({ advisorAlias: 'advisor' });
    const gate = createDeferred<void>();
    const originalCreate = fixture.session.createAgent.bind(fixture.session);
    const spawn = vi
      .spyOn(fixture.session, 'createAgent')
      .mockImplementation(async (...args) => {
        const created = await originalCreate(...args);
        const wait = created.agent.turn.waitForCurrentTurn.bind(created.agent.turn);
        vi.spyOn(created.agent.turn, 'waitForCurrentTurn').mockImplementation(async (signal) => {
          const result = await wait(signal);
          await gate.promise;
          return result;
        });
        return created;
      });
    queueReview(fixture.scripted, 'Review pending.', 'nit');

    await runMainTurn(fixture.main);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    fixture.scripted.mockNextResponse({ type: 'text', text: 'Another turn.' });
    await runMainTurn(fixture.main);

    expect(spawn).toHaveBeenCalledOnce();
    gate.resolve();
    await waitForAdvisor(fixture);
    await fixture.session.close();
  });

  it('does not launch a main turn when review notes finish while idle', async () => {
    const fixture = await createFixture({ advisorAlias: 'advisor' });
    const steer = vi.spyOn(fixture.main.turn, 'steer');
    queueReview(fixture.scripted, 'Check the edge case.', 'blocker');

    await runMainTurn(fixture.main);
    await waitForAdvisor(fixture);

    expect(fixture.main.turn.hasActiveTurn).toBe(false);
    expect(fixture.scripted.calls).toHaveLength(2);
    expect(steer).not.toHaveBeenCalled();
    await fixture.session.close();
  });
});

interface FixtureOptions {
  readonly enabled?: boolean;
  readonly advisorAlias?: 'advisor' | 'cross-advisor';
}

async function createFixture(options: FixtureOptions = {}): Promise<{
  readonly session: Session;
  readonly main: Agent;
  readonly scripted: ReturnType<typeof createScriptedGenerate>;
}> {
  const workDir = await makeTempDir();
  const sessionDir = await makeTempDir();
  const config = testConfig(options);
  const scripted = createScriptedGenerate();
  const session = new Session({
    id: 'test-session-advisor',
    kaos: testKaos.withCwd(workDir),
    homedir: sessionDir,
    rpc: createSessionRpc(),
    skills: { explicitDirs: [join(workDir, 'missing-skills')] },
    config,
    providerManager: new ProviderManager({ config }),
  });
  const { agent: main } = await session.createAgent(
    { type: 'main', generate: scripted.generate },
    { profile: testProfile() },
  );
  main.config.update({ modelAlias: 'main', thinkingLevel: 'off' });
  return { session, main, scripted };
}

function testConfig(options: FixtureOptions): PythinkerConfig {
  return {
    providers: {
      primary: { type: 'pythinker', apiKey: 'primary-key' },
      secondary: { type: 'pythinker', apiKey: 'secondary-key' },
    },
    defaultProvider: 'primary',
    defaultModel: 'main',
    models: {
      main: { provider: 'primary', model: 'main', maxContextSize: 100_000 },
      advisor: { provider: 'primary', model: 'advisor', maxContextSize: 100_000 },
      'cross-advisor': {
        provider: 'secondary',
        model: 'cross-advisor',
        maxContextSize: 100_000,
      },
    },
    ...(options.advisorAlias === undefined
      ? {}
      : { modelRoles: { advisor: options.advisorAlias } }),
    ...(options.enabled === true || options.advisorAlias !== undefined
      ? { advisor: { enabled: true } }
      : {}),
  };
}

function queueReview(
  scripted: ReturnType<typeof createScriptedGenerate>,
  note?: string,
  severity?: 'nit' | 'concern' | 'blocker',
): void {
  scripted.mockNextResponse({ type: 'text', text: 'Main turn complete.' });
  scripted.mockNextResponse({
    type: 'function',
    id: 'advisor-output',
    name: 'StructuredOutput',
    arguments: JSON.stringify({ notes: note === undefined ? [] : [{ note, severity }] }),
  });
}

async function runMainTurn(main: Agent): Promise<void> {
  const turnId = main.turn.prompt([{ type: 'text', text: 'Continue.' }]);
  expect(turnId).not.toBeNull();
  await main.turn.waitForCurrentTurn();
}

async function waitForAdvisor(fixture: {
  readonly session: Session;
  readonly scripted: ReturnType<typeof createScriptedGenerate>;
}): Promise<void> {
  await vi.waitFor(() => {
    expect(fixture.scripted.calls.length).toBeGreaterThanOrEqual(2);
    expect(fixture.session.agents.size).toBe(1);
  });
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pythinker-session-advisor-'));
  tempDirs.push(dir);
  return dir;
}

function testProfile(): ResolvedAgentProfile {
  return { name: 'test', systemPrompt: () => '<system-prompt>', tools: [] };
}

function createSessionRpc(): SDKSessionRPC {
  return {
    emitEvent: vi.fn(async () => {}),
    requestApproval: vi.fn(async () => ({ decision: 'cancelled' })),
    requestQuestion: vi.fn(async () => null),
    toolCall: vi.fn(async () => ({ output: 'not supported', isError: true })),
  } as SDKSessionRPC;
}
