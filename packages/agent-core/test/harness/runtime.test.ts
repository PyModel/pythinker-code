import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import type { Environment, Kaos } from '@pythoughts/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FLAG_DEFINITIONS,
  MASTER_ENV,
  createRPC,
  ErrorCodes,
  PythinkerCore,
  PythinkerError,
  type ApprovalResponse,
  type CoreAPI,
  type SDKAPI,
} from '../../src';
import {
  __resetRootLoggerForTest,
  getRootLogger,
  resolveGlobalLogPath,
} from '../../src/logging/logger';
import { resolveLoggingConfig } from '../../src/logging/resolve-config';
import { testKaos } from '../fixtures/test-kaos';

function requiredFlagEnv(id: string): string {
  const def = FLAG_DEFINITIONS.find((item) => item.id === id);
  if (def === undefined) throw new Error(`Missing flag definition: ${id}`);
  return def.env;
}

function clearExperimentalEnv(): void {
  vi.stubEnv(MASTER_ENV, '0');
  for (const def of FLAG_DEFINITIONS) {
    vi.stubEnv(def.env, '');
  }
}

function experimentalFeatureEnabled(core: PythinkerCore, id: string): boolean | undefined {
  return core.getExperimentalFeatures().find((feature) => feature.id === id)?.enabled;
}

function setCoreKaos(core: PythinkerCore, kaos: Promise<Kaos>): void {
  (core as unknown as { kaos?: Promise<Kaos> }).kaos = kaos;
}

function rejectedKaos(error: Error): Promise<Kaos> {
  const promise = Promise.reject(error) as Promise<Kaos>;
  promise.catch(() => undefined);
  return promise;
}

describe('PythinkerCore runtime config', () => {
  let tmp: string;

  afterEach(async () => {
    if (tmp !== undefined) {
      await rm(tmp, { recursive: true, force: true });
    }
    await __resetRootLoggerForTest();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('logs all enabled experimental flags once on core startup', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    await mkdir(homeDir, { recursive: true });
    await getRootLogger().configure(resolveLoggingConfig({ homeDir }));

    vi.stubEnv(MASTER_ENV, '0');
    for (const def of FLAG_DEFINITIONS) {
      vi.stubEnv(def.env, '0');
    }
    vi.stubEnv(requiredFlagEnv('micro_compaction'), '1');

    void new PythinkerCore(async () => ({}) as never, { homeDir });
    await getRootLogger().flushGlobal();

    const text = await readFile(resolveGlobalLogPath(homeDir), 'utf-8');
    expect(text).toContain('experimental flags enabled');
    expect(text).toContain('micro_compaction');
    expect(text.match(/experimental flags enabled/g)).toHaveLength(1);
  });

  it('resolves experimental flags from each core config independently', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const firstHome = join(tmp, 'first-home');
    const secondHome = join(tmp, 'second-home');
    await mkdir(firstHome, { recursive: true });
    await mkdir(secondHome, { recursive: true });
    await writeFile(
      join(firstHome, 'config.toml'),
      `
[experimental]
micro_compaction = true
`,
    );
    await writeFile(
      join(secondHome, 'config.toml'),
      `
[experimental]
micro_compaction = false
`,
    );
    clearExperimentalEnv();

    const first = new PythinkerCore(async () => ({}) as never, { homeDir: firstHome });
    const second = new PythinkerCore(async () => ({}) as never, { homeDir: secondHome });

    expect(experimentalFeatureEnabled(first, 'micro_compaction')).toBe(true);
    expect(experimentalFeatureEnabled(second, 'micro_compaction')).toBe(false);
  });

  it('updates the scoped experimental resolver after setPythinkerConfig', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    await mkdir(homeDir, { recursive: true });
    await writeFile(
      join(homeDir, 'config.toml'),
      `
[experimental]
micro_compaction = false
`,
    );
    clearExperimentalEnv();

    const core = new PythinkerCore(async () => ({}) as never, { homeDir });
    expect(experimentalFeatureEnabled(core, 'micro_compaction')).toBe(false);

    await core.setPythinkerConfig({
      experimental: {
        'micro_compaction': true,
      },
    });

    expect(experimentalFeatureEnabled(core, 'micro_compaction')).toBe(true);
  });

  it('gates and reloads external config.toml changes', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const configPath = join(homeDir, 'config.toml');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(
      configPath,
      `${baseModelConfig()}
[experimental]
micro_compaction = false
`,
    );
    clearExperimentalEnv();

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });
    const created = await rpc.createSession({
      id: 'ses_external_runtime_config',
      workDir,
      model: 'default-mock',
    });
    const trigger = vi.spyOn(core.sessions.get(created.id)!.hookEngine, 'triggerBlock');
    expect(experimentalFeatureEnabled(core, 'micro_compaction')).toBe(false);
    trigger.mockResolvedValueOnce({ block: true, reason: 'keep the current config' });

    await writeFile(
      configPath,
      `${baseModelConfig()}
[experimental]
micro_compaction = true
`,
    );

    await vi.waitFor(() => {
      expect(trigger).toHaveBeenCalledTimes(1);
    });
    expect(experimentalFeatureEnabled(core, 'micro_compaction')).toBe(false);
    expect(trigger).toHaveBeenCalledWith('ConfigChange', {
      matcherValue: 'user_settings',
      inputData: {
        agentId: 'main',
        source: 'user_settings',
        filePath: configPath,
      },
    });

    await writeFile(
      configPath,
      `${baseModelConfig()}
# external retry
[experimental]
micro_compaction = true
`,
    );
    await vi.waitFor(() => {
      expect(experimentalFeatureEnabled(core, 'micro_compaction')).toBe(true);
    });

    await core.setPythinkerConfig({ defaultThinking: true });
    await core.close();
    expect(trigger).toHaveBeenCalledTimes(3);
  });

  it('blocks config writes rejected by a matching ConfigChange hook', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    const configPath = join(homeDir, 'config.toml');
    await writeFile(
      configPath,
      `${baseModelConfig()}
[[hooks]]
event = "ConfigChange"
matcher = "user_settings"
command = "printf 'policy says no' >&2; exit 2"
`,
    );
    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });
    await rpc.createSession({
      id: 'ses_runtime_config_hook',
      workDir,
      model: 'default-mock',
    });
    const before = await readFile(configPath, 'utf8');

    await expect(core.setPythinkerConfig({ defaultThinking: true })).rejects.toThrow(
      /ConfigChange hook blocked.*policy says no/i,
    );

    await expect(readFile(configPath, 'utf8')).resolves.toBe(before);
  });

  it('updates the shared experimental resolver while goal tools stay available', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(homeDir, 'config.toml'),
      `${baseModelConfig()}
[experimental]
micro_compaction = false
`,
    );
    clearExperimentalEnv();

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_experimental_refresh',
      workDir,
      model: 'default-mock',
    });
    const session = core.sessions.get(created.id);
    const mainAgent = session?.getReadyAgent('main');

    expect(session?.experimentalFlags.enabled('micro_compaction')).toBe(false);
    expect(mainAgent?.experimentalFlags.enabled('micro_compaction')).toBe(false);
    expect(mainAgent?.tools.data().some((tool) => tool.name === 'CreateGoal')).toBe(true);
    expect(mainAgent?.tools.data().some((tool) => tool.name === 'Config')).toBe(true);

    await core.setPythinkerConfig({
      experimental: {
        'micro_compaction': true,
      },
    });

    expect(session?.experimentalFlags.enabled('micro_compaction')).toBe(true);
    expect(mainAgent?.experimentalFlags.enabled('micro_compaction')).toBe(true);
    expect(mainAgent?.tools.data().some((tool) => tool.name === 'CreateGoal')).toBe(true);

    await rpc.reloadSession({ sessionId: created.id });
    const reloadedMainAgent = core.sessions.get(created.id)?.getReadyAgent('main');
    expect(reloadedMainAgent?.tools.data().some((tool) => tool.name === 'CreateGoal')).toBe(true);
    expect(reloadedMainAgent?.tools.data().some((tool) => tool.name === 'Config')).toBe(true);
  });

  it('registers user and project agent profiles on new sessions', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(join(homeDir, 'agents'), { recursive: true });
    await mkdir(join(workDir, '.pythinker-code', 'agents'), { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());
    await writeFile(
      join(homeDir, 'agents', 'review.yaml'),
      'name: review\ndescription: User review\nsystemPromptTemplate: Review carefully.\ntools: [Read]\n',
    );
    await writeFile(
      join(workDir, '.pythinker-code', 'agents', 'review.yaml'),
      'name: review\ndescription: Project review\nsystemPromptTemplate: Review this project.\ntools: [Read, Grep]\n',
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_agent_profiles',
      workDir,
      model: 'default-mock',
    });
    const session = core.sessions.get(created.id);
    const mainAgent = session?.getReadyAgent('main');
    const agentTool = mainAgent?.tools.loopTools.find((tool) => tool.name === 'Agent');

    expect(session?.agentProfiles['review']).toMatchObject({
      description: 'Project review',
      tools: ['Read', 'Grep'],
    });
    expect(agentTool?.description).toContain('- review: Project review');
  });

  it('registers project task tools when the task graph flag is enabled', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(homeDir, 'config.toml'),
      `${baseModelConfig()}
[experimental]
task_graph = true
agent_teams = true
worktree_mode = true
`,
    );
    clearExperimentalEnv();

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_task_graph',
      workDir,
      model: 'default-mock',
    });
    const toolNames = core.sessions
      .get(created.id)
      ?.getReadyAgent('main')
      ?.tools.data()
      .map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'TaskCreate',
        'TaskGet',
        'TaskList',
        'TaskUpdate',
        'TeamCreate',
        'TeamDelete',
        'SendMessage',
        'EnterWorktree',
        'ExitWorktree',
      ]),
    );
    const agentTool = core.sessions
      .get(created.id)
      ?.getReadyAgent('main')
      ?.tools.loopTools.find((tool) => tool.name === 'Agent');
    expect((agentTool?.parameters as { properties?: object }).properties).toHaveProperty('name');
  });

  it('registers PowerShell only on Windows when its flag is enabled', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(homeDir, 'config.toml'),
      `${baseModelConfig()}
[experimental]
powershell = true
`,
    );
    clearExperimentalEnv();

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const LocalKaosCtor = testKaos.constructor as unknown as new (osEnv: Environment) => Kaos;
    setCoreKaos(
      core,
      Promise.resolve(
        new LocalKaosCtor({
          osKind: 'Windows',
          osArch: 'x64',
          osVersion: 'test',
          shellName: 'bash',
          shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
        }),
      ),
    );
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_powershell',
      workDir,
      model: 'default-mock',
    });
    const names = core.sessions
      .get(created.id)
      ?.getReadyAgent('main')
      ?.tools.data()
      .map((tool) => tool.name);

    expect(names).toContain('PowerShell');
  });

  it('registers LSP when the flag and an enabled plugin server are present', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const pluginDir = join(tmp, 'lsp-plugin');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(pluginDir, { recursive: true });
    await writeFile(
      join(homeDir, 'config.toml'),
      `${baseModelConfig()}
[experimental]
lsp = true
`,
    );
    await writeFile(
      join(pluginDir, 'pythinker.plugin.json'),
      JSON.stringify({
        name: 'typescript-lsp',
        lspServers: {
          typescript: {
            command: 'typescript-language-server',
            args: ['--stdio'],
            extensionToLanguage: { '.ts': 'typescript' },
          },
        },
      }),
    );
    clearExperimentalEnv();

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    await core.installPlugin({ source: pluginDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_lsp',
      workDir,
      model: 'default-mock',
    });
    const names = core.sessions
      .get(created.id)
      ?.getReadyAgent('main')
      ?.tools.data()
      .map((tool) => tool.name);

    expect(names).toContain('LSP');
  });

  it('loads namespaced agent profiles from enabled plugins', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const pluginDir = join(tmp, 'agent-plugin');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(join(pluginDir, 'agents'), { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());
    await writeFile(
      join(pluginDir, 'pythinker.plugin.json'),
      JSON.stringify({ name: 'demo' }),
    );
    await writeFile(
      join(pluginDir, 'agents', 'review.md'),
      '---\nname: review\ndescription: Review plugin changes.\ntools: [Read]\n---\nReview code.',
    );
    clearExperimentalEnv();

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    await core.installPlugin({ source: pluginDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_plugin_agent',
      workDir,
      model: 'default-mock',
    });
    const agentTool = core.sessions
      .get(created.id)
      ?.getReadyAgent('main')
      ?.tools.loopTools.find((tool) => tool.name === 'Agent');

    expect(agentTool?.description).toContain('demo:review');
    expect(agentTool?.description).toContain('Review plugin changes.');
  });

  it('lists and applies the configured output style to new main-agent sessions', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(join(homeDir, 'output-styles'), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(homeDir, 'config.toml'),
      `output_style = "concise"\n${baseModelConfig()}`,
    );
    await writeFile(
      join(homeDir, 'output-styles', 'concise.md'),
      '---\nname: concise\ndescription: Short answers\n---\nAnswer in short paragraphs.',
    );
    clearExperimentalEnv();

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    await expect(rpc.listOutputStyles({ workDir })).resolves.toMatchObject({
      active: 'concise',
      styles: expect.arrayContaining([
        expect.objectContaining({ name: 'concise', active: true, source: 'user' }),
      ]),
    });
    const created = await rpc.createSession({
      id: 'ses_runtime_output_style',
      workDir,
      model: 'default-mock',
    });

    expect(core.sessions.get(created.id)?.getReadyAgent('main')?.config.systemPrompt).toContain(
      '# Output Style: concise\nAnswer in short paragraphs.',
    );
  });

  it('lists built-in and precedence-resolved agent profiles', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(join(homeDir, 'agents'), { recursive: true });
    await mkdir(join(workDir, '.pythinker-code', 'agents'), { recursive: true });
    await writeFile(
      join(homeDir, 'agents', 'reviewer.yaml'),
      [
        'name: reviewer',
        'description: User reviewer',
        'systemPromptTemplate: Review changes.',
        'tools: [Read]',
      ].join('\n'),
    );
    await writeFile(
      join(workDir, '.pythinker-code', 'agents', 'reviewer.yaml'),
      [
        'name: reviewer',
        'description: Project reviewer',
        'systemPromptTemplate: Review this project.',
        'tools: [Read, Grep]',
        'memory: project',
      ].join('\n'),
    );
    clearExperimentalEnv();

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    void new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    await expect(rpc.listAgentProfiles({ workDir })).resolves.toMatchObject({
      profiles: expect.arrayContaining([
        expect.objectContaining({ name: 'coder', source: 'built-in' }),
        expect.objectContaining({
          name: 'reviewer',
          source: 'project',
          description: 'Project reviewer',
          tools: ['Read', 'Grep'],
          memory: 'project',
        }),
      ]),
      warnings: [],
    });
  });


  it('falls back to defaultModel when createSession receives no model option', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(homeDir, 'config.toml'),
      `default_model = "default-mock"

[providers.test]
type = "pythinker"
api_key = "test-key"

[models."default-mock"]
provider = "test"
model = "default-mock"
max_context_size = 100000
`,
    );

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({ id: 'ses_runtime_default_model', workDir });
    const session = core.sessions.get(created.id);
    const mainAgent = session?.getReadyAgent('main');

    expect(mainAgent?.config.modelAlias).toBe('default-mock');
  });

  it('rejects createSession when shell runtime initialization fails', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });
    setCoreKaos(
      core,
      rejectedKaos(
        new PythinkerError(ErrorCodes.SHELL_GIT_BASH_NOT_FOUND, 'Git Bash missing'),
      ),
    );

    await expect(
      rpc.createSession({
        id: 'ses_runtime_shell_missing_create',
        workDir,
        model: 'default-mock',
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.SHELL_GIT_BASH_NOT_FOUND });
    expect(core.sessions.has('ses_runtime_shell_missing_create')).toBe(false);
  });

  it('rejects resumeSession when shell runtime initialization fails', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });
    setCoreKaos(core, Promise.resolve(testKaos));
    const created = await rpc.createSession({
      id: 'ses_runtime_shell_missing_resume',
      workDir,
      model: 'default-mock',
    });
    await rpc.closeSession({ sessionId: created.id });
    setCoreKaos(
      core,
      rejectedKaos(
        new PythinkerError(ErrorCodes.SHELL_GIT_BASH_NOT_FOUND, 'Git Bash missing'),
      ),
    );

    await expect(rpc.resumeSession({ sessionId: created.id })).rejects.toMatchObject({
      code: ErrorCodes.SHELL_GIT_BASH_NOT_FOUND,
    });
    expect(core.sessions.has(created.id)).toBe(false);
  });

  it('reloads an active session with fresh runtime services from config.toml', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    const configPath = join(homeDir, 'config.toml');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(configPath, baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_reload',
      workDir,
      model: 'default-mock',
    });
    const before = core.sessions.get(created.id);
    expect(before?.options.toolServices?.webSearcher).toBeUndefined();

    await writeFile(
      configPath,
      `${baseModelConfig()}
[services.pythoughts_search]
base_url = "https://search.example.test/v1"
`,
    );

    const reloaded = await rpc.reloadSession({ sessionId: created.id });
    const after = core.sessions.get(created.id);

    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(after?.options.toolServices?.webSearcher).toBeDefined();
    expect(reloaded.agents['main']).toBeDefined();
  });

  it('rejects reloadSession while the active session has a running turn', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'pythinker-core-runtime-'));
    const homeDir = join(tmp, 'home');
    const workDir = join(tmp, 'work');
    await mkdir(homeDir, { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(join(homeDir, 'config.toml'), baseModelConfig());

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    const core = new PythinkerCore(coreRpc, { homeDir });
    const rpc = await sdkRpc({
      emitEvent: vi.fn(),
      requestApproval: vi.fn(async (): Promise<ApprovalResponse> => ({ decision: 'rejected' })),
      requestQuestion: vi.fn(async () => null),
      toolCall: vi.fn(async () => ({ output: '' })),
    });

    const created = await rpc.createSession({
      id: 'ses_runtime_reload_busy',
      workDir,
      model: 'default-mock',
    });
    const active = core.sessions.get(created.id);
    const main = active?.getReadyAgent('main');
    vi.spyOn(main!.turn, 'hasActiveTurn', 'get').mockReturnValue(true);

    await expect(rpc.reloadSession({ sessionId: created.id })).rejects.toMatchObject({
      code: ErrorCodes.TURN_AGENT_BUSY,
    });
    expect(core.sessions.get(created.id)).toBe(active);
  });
});

function baseModelConfig(): string {
  return `default_model = "default-mock"

[providers.test]
type = "pythinker"
api_key = "test-key"

[models."default-mock"]
provider = "test"
model = "default-mock"
max_context_size = 100000
`;
}
