/**
 * Scenario: PythinkerHarness session creation and resume transport behavior.
 * Responsibilities: SDK options reach the in-process core and session identity remains stable.
 * Wiring: the real SDK/core are used; model/network boundaries are configured but never called.
 * Run: pnpm -C packages/node-sdk exec vitest run test/create-session-transport.test.ts
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Pyaos } from '@pymodel/pyaos';
import { createPythinkerHarness, PythinkerHarness } from '#/index';
import type { PythinkerError } from '#/index';
import type { ResumeSessionInput, ResumedSessionSummary } from '#/types';
import { SDKRpcClientBase } from '#/rpc';
import { afterEach, describe, expect, it } from 'vitest';

import { waitForAgentWireEvent } from './session-runtime-helpers';
import { recordingTelemetry, type TelemetryRecord } from './telemetry';
import { TEST_IDENTITY } from './test-identity';

// node-sdk/agent-core normalize paths to forward slashes (pathe). Mirror that
// in path assertions so they hold on Windows, where node:path produces
// backslashes.
const toPosix = (p: string): string => p.replaceAll('\\', '/');

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pythinker-sdk-create-'));
  tempDirs.push(dir);
  return dir;
}

async function writeTestModelConfig(homeDir: string, modelName = 'pythinker-test-model'): Promise<void> {
  await writeFile(
    join(homeDir, 'config.toml'),
    `
[providers.local]
type = "pythinker"
base_url = "https://example.test/v1"
api_key = "sk-test"

[models."${modelName}"]
provider = "local"
model = "${modelName}"
max_context_size = 1000
`,
    'utf-8',
  );
}

async function writeReviewerAgent(workDir: string): Promise<void> {
  const agentDir = join(workDir, '.pythinker-code', 'agents');
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(agentDir, 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews code.\nsubagents:\n  - explore\n---\n\nReview the requested change.\n',
    'utf-8',
  );
}

class StubRpc extends SDKRpcClientBase {
  resumeCalls: Array<{ input: ResumeSessionInput; pyaos: Pyaos; persistencePyaos?: Pyaos }> = [];
  createPyaosCalls: Array<{ input: object; pyaos: Pyaos; persistencePyaos?: Pyaos }> = [];

  protected async getRpc(): Promise<never> {
    throw new Error('not used');
  }

  override async createSession(input: { id?: string; workDir: string }) {
    return {
      id: input.id ?? 'ses_stub',
      workDir: input.workDir,
      sessionDir: '/tmp/session',
      createdAt: 1,
      updatedAt: 1,
    };
  }

  override async createSessionWithPyaos(input: { id?: string; workDir: string }, pyaos: Pyaos, persistencePyaos?: Pyaos) {
    this.createPyaosCalls.push({ input, pyaos, persistencePyaos });
    return this.createSession(input);
  }

  override async resumeSessionWithPyaos(input: ResumeSessionInput, pyaos: Pyaos, persistencePyaos?: Pyaos): Promise<ResumedSessionSummary> {
    this.resumeCalls.push({ input, pyaos, persistencePyaos });
    return {
      id: input.id,
      workDir: '/tmp/work',
      sessionDir: '/tmp/session',
      createdAt: 1,
      updatedAt: 1,
      sessionMetadata: {
        createdAt: '',
        updatedAt: '',
        title: '',
        isCustomTitle: false,
        agents: {},
        custom: {},
      },
      agents: {},
    };
  }
}

describe('PythinkerHarness.createSession transport link', () => {
  it('emits session_started with client attribution when a session is opened', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const records: TelemetryRecord[] = [];
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
      telemetry: recordingTelemetry(records),
    });

    try {
      const session = await harness.createSession({
        id: 'ses_session_started',
        workDir,
      });
      await harness.resumeSession({ id: session.id });

      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: session.id,
        properties: {
          client_id: null,
          client_name: 'pythinker-code-cli',
          client_version: '0.0.0-test',
          ui_mode: 'shell',
          resumed: false,
        },
      });
      expect(records.filter((record) => record.event === 'session_started')).toHaveLength(1);
      expect(records).toContainEqual({
        event: 'session_new',
        sessionId: session.id,
        properties: undefined,
      });

      await session.close();
      await harness.resumeSession({ id: session.id });

      expect(records.filter((record) => record.event === 'session_started')).toHaveLength(2);
      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: session.id,
        properties: {
          client_id: null,
          client_name: 'pythinker-code-cli',
          client_version: '0.0.0-test',
          ui_mode: 'shell',
          resumed: true,
        },
      });
      expect(records).toContainEqual({
        event: 'session_resume',
        sessionId: session.id,
        properties: undefined,
      });
    } finally {
      await harness.close();
    }
  });

  it('uses the configured UI mode for session_started attribution', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const records: TelemetryRecord[] = [];
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
      telemetry: recordingTelemetry(records),
      uiMode: 'print',
    });

    try {
      const session = await harness.createSession({
        id: 'ses_session_started_print',
        workDir,
      });

      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: session.id,
        properties: {
          client_id: null,
          client_name: 'pythinker-code-cli',
          client_version: '0.0.0-test',
          ui_mode: 'print',
          resumed: false,
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('merges process-level sessionStartedProperties into session_started', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const records: TelemetryRecord[] = [];
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
      telemetry: recordingTelemetry(records),
      sessionStartedProperties: { yolo: true, plan: false },
    });

    try {
      const session = await harness.createSession({
        id: 'ses_process_props',
        workDir,
      });

      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: session.id,
        properties: {
          client_id: null,
          client_name: 'pythinker-code-cli',
          client_version: '0.0.0-test',
          ui_mode: 'shell',
          resumed: false,
          yolo: true,
          plan: false,
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('merges session-level sessionStartedProperties and overrides process-level ones', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const records: TelemetryRecord[] = [];
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
      telemetry: recordingTelemetry(records),
      sessionStartedProperties: { mode: 'process', source: 'process' },
    });

    try {
      const session = await harness.createSession({
        id: 'ses_scoped_props',
        workDir,
        sessionStartedProperties: { mode: 'new' },
      });

      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: session.id,
        properties: {
          client_id: null,
          client_name: 'pythinker-code-cli',
          client_version: '0.0.0-test',
          ui_mode: 'shell',
          resumed: false,
          mode: 'new',
          source: 'process',
        },
      });

      await session.close();
      await harness.resumeSession({
        id: session.id,
        sessionStartedProperties: { mode: 'load' },
      });

      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: session.id,
        properties: {
          client_id: null,
          client_name: 'pythinker-code-cli',
          client_version: '0.0.0-test',
          ui_mode: 'shell',
          resumed: true,
          mode: 'load',
          source: 'process',
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('does not let sessionStartedProperties override canonical session_started fields', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const records: TelemetryRecord[] = [];
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
      telemetry: recordingTelemetry(records),
    });

    try {
      const session = await harness.createSession({
        id: 'ses_reserved_keys',
        workDir,
        sessionStartedProperties: {
          client_name: 'evil',
          client_version: 'evil',
          ui_mode: 'evil',
          resumed: true,
          extra: 'kept',
        },
      });

      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: session.id,
        properties: {
          client_id: null,
          client_name: 'pythinker-code-cli',
          client_version: '0.0.0-test',
          ui_mode: 'shell',
          resumed: false,
          extra: 'kept',
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('evaluates sessionStartedDynamicProperties at every session_started emission', async () => {
    const records: TelemetryRecord[] = [];
    const rpc = new StubRpc();
    let flags = 'tower';
    const harness = new PythinkerHarness(rpc, {
      homeDir: '/tmp/home',
      configPath: '/tmp/config.toml',
      auth: { status: async () => ({ providers: [] }) } as never,
      telemetry: recordingTelemetry(records),
      ensureConfigFile: async () => undefined,
      onClose: () => undefined,
      sessionStartedDynamicProperties: () => ({ experimental_flags: flags }),
    });

    await harness.createSession({ id: 'ses_dynamic_one', workDir: '/tmp/work' });
    flags = 'tower,wait_for';
    await harness.createSession({ id: 'ses_dynamic_two', workDir: '/tmp/work' });
    await harness.createSession({
      id: 'ses_dynamic_three',
      workDir: '/tmp/work',
      sessionStartedProperties: { experimental_flags: 'caller_supplied' },
    });

    const started = records.filter((record) => record.event === 'session_started');
    expect(started).toHaveLength(3);
    expect(started[0]).toMatchObject({
      sessionId: 'ses_dynamic_one',
      properties: { experimental_flags: 'tower' },
    });
    expect(started[1]).toMatchObject({
      sessionId: 'ses_dynamic_two',
      properties: { experimental_flags: 'tower,wait_for' },
    });
    expect(started[2]).toMatchObject({
      sessionId: 'ses_dynamic_three',
      properties: { experimental_flags: 'tower,wait_for' },
    });
  });

  it('emits session_fork with the forked session context', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const records: TelemetryRecord[] = [];
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
      telemetry: recordingTelemetry(records),
    });

    try {
      const source = await harness.createSession({
        id: 'ses_fork_source',
        workDir,
      });
      const forked = await harness.forkSession({
        id: source.id,
        forkId: 'ses_fork_child',
        title: 'Forked child',
      });

      expect(forked.id).toBe('ses_fork_child');
      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: forked.id,
        properties: {
          client_id: null,
          client_name: 'pythinker-code-cli',
          client_version: '0.0.0-test',
          ui_mode: 'shell',
          resumed: true,
        },
      });
      expect(records).toContainEqual({
        event: 'session_fork',
        sessionId: forked.id,
        properties: undefined,
      });
    } finally {
      await harness.close();
    }
  });

  it('does not invent client attribution without host identity', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const records: TelemetryRecord[] = [];
    const harness = createPythinkerHarness({
      homeDir,
      telemetry: recordingTelemetry(records),
    });

    try {
      const session = await harness.createSession({
        id: 'ses_session_started_shell',
        workDir,
      });

      expect(records).toContainEqual({
        event: 'session_started',
        sessionId: session.id,
        properties: {
          client_id: null,
          client_name: null,
          client_version: null,
          ui_mode: 'shell',
          resumed: false,
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('creates metadata and keeps the session active in the harness', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    await writeTestModelConfig(homeDir);
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      const session = await harness.createSession({
        id: 'ses_transport_link',
        workDir,
        model: 'pythinker-test-model',
      });

      expect(session.id).toBe('ses_transport_link');
      expect(session.workDir).toBe(toPosix(workDir));
      await expect(session.getStatus()).resolves.toMatchObject({ model: 'pythinker-test-model' });
      expect(harness.sessions.get(session.id)).toBe(session);
      const configEvent = await waitForAgentWireEvent(
        homeDir,
        session.id,
        'config.update',
        (event) => event['modelAlias'] === 'pythinker-test-model',
      );
      expect(configEvent).toMatchObject({
        type: 'config.update',
        modelAlias: 'pythinker-test-model',
      });
      expect(configEvent).not.toHaveProperty('provider');

      const summaries = await harness.listSessions({ workDir });
      const summary = summaries.find((item) => item.id === session.id);
      expect(summary?.sessionDir).not.toBe(join(homeDir, 'sessions', session.id));
      expect(summary?.sessionDir).toContain(toPosix(join(homeDir, 'sessions')));
      expect(existsSync(join(summary!.sessionDir, 'state.json'))).toBe(true);
      expect(await readFile(join(homeDir, 'session_index.jsonl'), 'utf-8')).toContain(session.id);

      const summariesById = await harness.listSessions({ sessionId: session.id });
      expect(summariesById).toHaveLength(1);
      expect(summariesById[0]).toMatchObject({
        id: session.id,
        workDir: toPosix(workDir),
      });
      await expect(harness.listSessions({ sessionId: 'ses_missing' })).resolves.toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it('accepts configured model aliases while creating the core session', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    await writeFile(
      join(homeDir, 'config.toml'),
      `
default_model = "alias-model"

[providers.local]
type = "openai"
base_url = "https://example.test/v1"
api_key = "sk-test"

[models.alias-model]
provider = "local"
model = "real-model"
max_context_size = 1000

[thinking]
effort = "medium"
`,
      'utf-8',
    );
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      const session = await harness.createSession({ id: 'ses_alias_model', workDir });
      expect(session.id).toBe('ses_alias_model');
      await expect(session.getStatus()).resolves.toMatchObject({ model: 'alias-model' });
      expect(harness.sessions.get(session.id)).toBe(session);
      const configEvent = await waitForAgentWireEvent(
        homeDir,
        session.id,
        'config.update',
        (event) => event['modelAlias'] === 'alias-model',
      );
      expect(configEvent).toMatchObject({
        type: 'config.update',
        modelAlias: 'alias-model',
      });
      expect(configEvent).not.toHaveProperty('provider');
    } finally {
      await harness.close();
    }
  });

  it('does not require provider config or API keys before prompt is implemented', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      const session = await harness.createSession({ id: 'ses_empty_config', workDir });
      expect(session.id).toBe('ses_empty_config');
      expect((await session.getStatus()).model).toBeUndefined();
      expect(harness.sessions.get(session.id)).toBe(session);
    } finally {
      await harness.close();
    }
  });

  it('requires a non-empty workDir on createSession', async () => {
    const homeDir = await makeTempDir();
    const harness = createPythinkerHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(
        harness.createSession({ id: 'ses_missing_workdir' } as never),
      ).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'request.work_dir_required',
      } satisfies Partial<PythinkerError>);
      await expect(
        harness.createSession({ id: 'ses_blank_workdir', workDir: '   ' }),
      ).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'request.work_dir_required',
      } satisfies Partial<PythinkerError>);
    } finally {
      await harness.close();
    }
  });

  it('does not persist a session record when MCP config validation fails', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    // Project-local mcp.json is intentionally ignored, so plant the malformed
    // file under the user home dir where the loader actually reads from.
    await writeFile(join(homeDir, 'mcp.json'), '{not json}', 'utf-8');
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await expect(
        harness.createSession({ id: 'ses_bad_mcp_config', workDir }),
      ).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'config.invalid',
      });
      expect(await harness.listSessions({ workDir })).toEqual([]);
      expect(existsSync(join(homeDir, 'session_index.jsonl'))).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it('does not persist a session record when the requested agent profile is missing', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await expect(
        harness.createSession({
          id: 'ses_missing_agent_profile',
          workDir,
          agentProfile: 'missing-agent',
        }),
      ).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'agent.not_found',
      });
      expect(await harness.listSessions({ workDir })).toEqual([]);
      expect(existsSync(join(homeDir, 'session_index.jsonl'))).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it('allows the session ID to be reused after agent profile selection fails', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await expect(
        harness.createSession({
          id: 'ses_reusable_after_missing_profile',
          workDir,
          agentProfile: 'missing-agent',
        }),
      ).rejects.toMatchObject({ code: 'agent.not_found' });

      await expect(
        harness.createSession({
          id: 'ses_reusable_after_missing_profile',
          workDir,
        }),
      ).resolves.toMatchObject({ id: 'ses_reusable_after_missing_profile' });
    } finally {
      await harness.close();
    }
  });

  it('does not persist a session record when an explicit agent file cannot be loaded', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await expect(
        harness.createSession({
          id: 'ses_missing_explicit_agent_file',
          workDir,
          agentFiles: [join(workDir, 'missing-agent.md')],
        }),
      ).rejects.toThrow(/missing-agent\.md/);
      expect(await harness.listSessions({ workDir })).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it('closes active runtime handles through closeSession, session.close, and close', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    await writeTestModelConfig(homeDir);
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    const first = await harness.createSession({
      id: 'ses_close_one',
      workDir,
      model: 'pythinker-test-model',
    });
    const second = await harness.createSession({
      id: 'ses_close_two',
      workDir,
      model: 'pythinker-test-model',
    });
    expect(coreSessionIds(harness)).toEqual([first.id, second.id]);

    await harness.closeSession(first.id);
    expect(harness.getSession(first.id)).toBeUndefined();
    expect(coreSessionIds(harness)).toEqual([second.id]);

    await second.close();
    expect(harness.getSession(second.id)).toBeUndefined();
    expect(coreSessionIds(harness)).toEqual([]);

    await harness.close();
    expect(harness.sessions.size).toBe(0);
    expect(coreSessionIds(harness)).toEqual([]);
  });

  it('permanently deletes an active session', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      const session = await harness.createSession({ id: 'ses_delete_active', workDir });
      const [summary] = await harness.listSessions({ sessionId: session.id });

      await harness.deleteSession(session.id);

      expect(harness.getSession(session.id)).toBeUndefined();
      await expect(harness.listSessions({ sessionId: session.id })).resolves.toEqual([]);
      expect(existsSync(summary!.sessionDir)).toBe(false);
    } finally {
      await harness.close();
    }
  });

  it('returns session.not_found when deleteSession targets a missing id', async () => {
    const homeDir = await makeTempDir();
    const harness = createPythinkerHarness({ identity: TEST_IDENTITY, homeDir });

    try {
      await expect(harness.deleteSession('ses_delete_missing')).rejects.toMatchObject({
        name: 'PythinkerError',
        code: 'session.not_found',
      } satisfies Partial<PythinkerError>);
    } finally {
      await harness.close();
    }
  });

  it('allows a deleted session id to be created again', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createPythinkerHarness({ identity: TEST_IDENTITY, homeDir });
    const sessionId = 'ses_delete_recreate';

    try {
      await harness.createSession({ id: sessionId, workDir });
      await harness.deleteSession(sessionId);

      const recreated = await harness.createSession({ id: sessionId, workDir });

      expect(recreated.id).toBe(sessionId);
      await expect(harness.listSessions({ sessionId })).resolves.toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('preserves a legacy source directory referenced by session metadata', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const legacySourceDir = await makeTempDir();
    const markerPath = join(legacySourceDir, 'legacy-marker.txt');
    await writeFile(markerPath, 'legacy source remains', 'utf-8');
    const harness = createPythinkerHarness({ identity: TEST_IDENTITY, homeDir });

    try {
      const session = await harness.createSession({
        id: 'ses_delete_migrated',
        workDir,
        metadata: { pythinker_cli_source_path: legacySourceDir },
      });

      await harness.deleteSession(session.id);

      await expect(readFile(markerPath, 'utf-8')).resolves.toBe('legacy source remains');
    } finally {
      await harness.close();
    }
  });

  it('applies initial thinking and permission runtime options', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      const session = await harness.createSession({
        id: 'ses_initial_runtime_options',
        workDir,
        thinking: 'low',
        permission: 'auto',
      });

      await expect(
        waitForAgentWireEvent(
          homeDir,
          session.id,
          'config.update',
          (event) => event['thinkingEffort'] === 'low',
        ),
      ).resolves.toMatchObject({
        type: 'config.update',
        thinkingEffort: 'low',
      });
      await expect(
        waitForAgentWireEvent(
          homeDir,
          session.id,
          'permission.set_mode',
          (event) => event['mode'] === 'auto',
        ),
      ).resolves.toMatchObject({
        type: 'permission.set_mode',
        mode: 'auto',
      });
    } finally {
      await harness.close();
    }
  });

  it('applies configured default permission mode to new sessions', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    await writeFile(join(homeDir, 'config.toml'), 'default_permission_mode = "auto"\n', 'utf-8');
    const harness = createPythinkerHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      const session = await harness.createSession({
        id: 'ses_default_permission_mode',
        workDir,
      });

      await expect(session.getStatus()).resolves.toMatchObject({ permission: 'auto' });
      await expect(
        waitForAgentWireEvent(
          homeDir,
          session.id,
          'permission.set_mode',
          (event) => event['mode'] === 'auto',
        ),
      ).resolves.toMatchObject({
        type: 'permission.set_mode',
        mode: 'auto',
      });

      const explicit = await harness.createSession({
        id: 'ses_default_permission_explicit_override',
        workDir,
        permission: 'manual',
      });
      await expect(explicit.getStatus()).resolves.toMatchObject({ permission: 'manual' });
    } finally {
      await harness.close();
    }
  });

  it('rebinds an active session when resumeSession receives a new Pyaos', async () => {
    const records: TelemetryRecord[] = [];
    const rpc = new StubRpc();
    const harness = new PythinkerHarness(rpc, {
      homeDir: '/tmp/home',
      configPath: '/tmp/config.toml',
      auth: { status: async () => ({ providers: [] }) } as never,
      telemetry: recordingTelemetry(records),
      ensureConfigFile: async () => undefined,
      onClose: () => undefined,
    });

    const session = await harness.createSession({ id: 'ses_active', workDir: '/tmp/work' });
    const pyaos = {} as Pyaos;

    const resumed = await harness.resumeSession({ id: session.id, pyaos });

    expect(resumed).toBe(session);
    expect(rpc.resumeCalls).toHaveLength(1);
    expect(rpc.resumeCalls[0]).toMatchObject({
      input: { id: 'ses_active' },
      pyaos,
      persistencePyaos: undefined,
    });
  });

  it('rejects an active session resume when the requested profile differs from its binding', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    await writeTestModelConfig(homeDir);
    await writeReviewerAgent(workDir);
    const harness = createPythinkerHarness({ identity: TEST_IDENTITY, homeDir });

    try {
      const session = await harness.createSession({
        id: 'ses_active_profile_identity',
        workDir,
        agentProfile: 'reviewer',
      });

      await expect(
        harness.resumeSession({ id: session.id, agentProfile: 'agent' }),
      ).rejects.toThrow(
        'agent is already bound to profile "reviewer"; cannot switch to "agent" in this session',
      );
    } finally {
      await harness.close();
    }
  });

  it('returns the active session when the requested profile matches its binding', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    await writeTestModelConfig(homeDir);
    await writeReviewerAgent(workDir);
    const harness = createPythinkerHarness({ identity: TEST_IDENTITY, homeDir });

    try {
      const session = await harness.createSession({
        id: 'ses_matching_profile_identity',
        workDir,
        agentProfile: 'reviewer',
      });

      await expect(
        harness.resumeSession({ id: session.id, agentProfile: 'reviewer' }),
      ).resolves.toBe(session);
    } finally {
      await harness.close();
    }
  });

  it('rejects a persisted session resume when the requested profile differs from its binding', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    await writeTestModelConfig(homeDir);
    await writeReviewerAgent(workDir);
    const harness = createPythinkerHarness({ identity: TEST_IDENTITY, homeDir });

    try {
      const session = await harness.createSession({
        id: 'ses_persisted_profile_identity',
        workDir,
        agentProfile: 'reviewer',
      });
      await session.close();

      await expect(
        harness.resumeSession({ id: session.id, agentProfile: 'agent' }),
      ).rejects.toThrow(
        'agent is already bound to profile "reviewer"; cannot switch to "agent" in this session',
      );
    } finally {
      await harness.close();
    }
  });
});

function coreSessionIds(harness: PythinkerHarness): readonly string[] {
  const core = (
    harness as unknown as {
      readonly rpc: { readonly core: { readonly sessions: ReadonlyMap<string, unknown> } };
    }
  ).rpc.core;
  return Array.from(core.sessions.keys()).toSorted();
}

describe('deprecated kaos alias session params', () => {
  function makeStubHarness() {
    const rpc = new StubRpc();
    const harness = new PythinkerHarness(rpc, {
      homeDir: '/tmp/home',
      configPath: '/tmp/config.toml',
      auth: { status: async () => ({ providers: [] }) } as never,
      telemetry: recordingTelemetry([]),
      ensureConfigFile: async () => undefined,
      onClose: () => undefined,
    });
    return { rpc, harness };
  }

  it('createSession accepts { kaos, persistenceKaos } as aliases for the pyaos params', async () => {
    const { rpc, harness } = makeStubHarness();
    const legacy = {} as Pyaos;
    const legacyPersistence = {} as Pyaos;

    await harness.createSession({
      id: 'ses_legacy_alias',
      workDir: '/tmp/work',
      kaos: legacy,
      persistenceKaos: legacyPersistence,
    });

    expect(rpc.createPyaosCalls).toHaveLength(1);
    expect(rpc.createPyaosCalls[0]).toMatchObject({
      pyaos: legacy,
      persistencePyaos: legacyPersistence,
    });
    expect(rpc.createPyaosCalls[0]?.input).not.toHaveProperty('kaos');
    expect(rpc.createPyaosCalls[0]?.input).not.toHaveProperty('persistenceKaos');
  });

  it('resumeSession accepts { kaos } as an alias and prefers an explicit pyaos', async () => {
    const { rpc, harness } = makeStubHarness();
    const session = await harness.createSession({ id: 'ses_legacy_resume', workDir: '/tmp/work' });
    const legacy = {} as Pyaos;

    await harness.resumeSession({ id: session.id, kaos: legacy });

    expect(rpc.resumeCalls).toHaveLength(1);
    expect(rpc.resumeCalls[0]).toMatchObject({ pyaos: legacy, persistencePyaos: undefined });
    expect(rpc.resumeCalls[0]?.input).not.toHaveProperty('kaos');

    const preferred = {} as Pyaos;
    await harness.resumeSession({ id: session.id, kaos: legacy, pyaos: preferred });
    expect(rpc.resumeCalls[1]).toMatchObject({ pyaos: preferred });
  });
});
