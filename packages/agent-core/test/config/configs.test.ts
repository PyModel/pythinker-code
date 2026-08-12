import { mkdtempSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it } from 'vitest';

import { ErrorCodes, PythinkerError } from '../../src/errors';
import {
  PythinkerConfigSchema,
  ensureConfigFile,
  loadRuntimeConfig,
  loadRuntimeConfigSafe,
  mergeConfigPatch,
  parseConfigString,
  parseBooleanEnv,
  readConfigFile,
  readConfigFileForUpdate,
  resolveConfigPath,
  resolveConfigValue,
  resolvePythinkerHome,
  validateConfig,
  writeConfigFile,
} from '../../src/config';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pythinker-core-config-'));
  tempDirs.push(dir);
  return dir;
}

function expectPythinkerErrorCode(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PythinkerError);
  expect((thrown as PythinkerError).code).toBe(code);
}

const COMPLETE_TOML = `
default_model = "pythinker-code/pythinker-for-coding"
default_thinking = true
default_permission_mode = "auto"
default_plan_mode = false
merge_all_available_skills = true
extra_skill_dirs = ["~/team-skills", ".agents/team-skills"]
additional_dirs = ["~/shared-project", "/tmp/reference"]
telemetry = false
theme = "dark"

[providers."managed:kimi-code"]
type = "pythinker"
base_url = "https://api.pythinker.com/coding/v1"
api_key = "sk-file"
custom_headers = { "X-Test" = "1" }

[providers."managed:kimi-code".env]
GOOGLE_CLOUD_PROJECT = "project-1"

[models."pythinker-code/pythinker-for-coding"]
provider = "managed:kimi-code"
model = "pythinker-for-coding"
max_context_size = 262144
capabilities = ["image_in", "thinking", "video_in"]
display_name = "Pythinker for Coding"

[thinking]
mode = "auto"
effort = "medium"

[permission]
mode = "manual"

[[permission.rules]]
decision = "deny"
scope = "user"
pattern = "Bash(rm *)"
reason = "no rm"

[[permission.allow]]
tool = "Read"
match = "src/**"
reason = "read src"

[loop_control]
max_steps_per_run = 42
max_retries_per_step = 3
reserved_context_size = 50000
compaction_trigger_ratio = 0.85

[background]
max_running_tasks = 4
keep_alive_on_exit = false
kill_grace_period_ms = 2000
print_wait_ceiling_s = 3600

[[hooks]]
event = "PreToolUse"
matcher = "Shell"
command = "echo pre"
timeout = 5

[[hooks]]
event = "Stop"
command = "echo stop"

[services.pythoughts_search]
base_url = "https://api.pythinker.com/coding/v1/search"
api_key = "sk-search"
custom_headers = { "X-Search" = "1" }

[services.pythoughts_fetch]
base_url = "https://api.pythinker.com/coding/v1/fetch"
api_key = "sk-fetch"

[notifications]
claim_stale_after_ms = 15000
`;

describe('harness config TOML loader', () => {
  it('parses the current config.toml shape through explicit field mappings', () => {
    const config = parseConfigString(COMPLETE_TOML, 'config.toml');

    expect(config.defaultModel).toBe('pythinker-code/pythinker-for-coding');
    expect(config.defaultThinking).toBe(true);
    expect(config.defaultPermissionMode).toBe('auto');
    expect(config.defaultPlanMode).toBe(false);
    expect(config.mergeAllAvailableSkills).toBe(true);
    expect(config.extraSkillDirs).toEqual(['~/team-skills', '.agents/team-skills']);
    expect(config.additionalDirs).toEqual(['~/shared-project', '/tmp/reference']);
    expect(config.telemetry).toBe(false);
    expect(config.providers['managed:kimi-code']).toMatchObject({
      type: 'pythinker',
      baseUrl: 'https://api.pythinker.com/coding/v1',
      apiKey: 'sk-file',
      env: { GOOGLE_CLOUD_PROJECT: 'project-1' },
      customHeaders: { 'X-Test': '1' },
    });
    expect(config.models?.['pythinker-code/pythinker-for-coding']).toMatchObject({
      provider: 'managed:kimi-code',
      model: 'pythinker-for-coding',
      maxContextSize: 262144,
      capabilities: ['image_in', 'thinking', 'video_in'],
      displayName: 'Pythinker for Coding',
    });
    expect(config.thinking).toEqual({ mode: 'auto', effort: 'medium' });
    expect(config.permission).toEqual({
      rules: [
        {
          decision: 'deny',
          scope: 'user',
          pattern: 'Bash(rm *)',
          reason: 'no rm',
        },
        {
          decision: 'allow',
          scope: 'user',
          pattern: 'Read(src/**)',
          reason: 'read src',
        },
      ],
    });
    expect(config.loopControl).toMatchObject({
      maxStepsPerTurn: 42,
      maxRetriesPerStep: 3,
      reservedContextSize: 50000,
      compactionTriggerRatio: 0.85,
    });
    expect(config.background).toMatchObject({
      maxRunningTasks: 4,
      keepAliveOnExit: false,
      killGracePeriodMs: 2000,
      printWaitCeilingS: 3600,
    });
    expect(config.hooks).toEqual([
      {
        event: 'PreToolUse',
        matcher: 'Shell',
        command: 'echo pre',
        timeout: 5,
      },
      {
        event: 'Stop',
        command: 'echo stop',
      },
    ]);
    expect(config.services?.pythoughtsSearch?.customHeaders).toEqual({ 'X-Search': '1' });
    expect(config.services?.pythoughtsFetch?.apiKey).toBe('sk-fetch');

    expect('theme' in config).toBe(false);
    expect(config.raw?.['theme']).toBe('dark');
    expect(config.raw?.['notifications']).toEqual({ claim_stale_after_ms: 15000 });
  });

  it('round-trips a custom registry source field on a provider', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'round-trip.toml');
    const toml = `
[providers.custom]
type = "openai"
base_url = "https://custom.example/v1"
api_key = "sk-test"
source = { kind = "apiJson", url = "https://registry.example/api.json", apiKey = "sk-registry" }
`;
    const config = parseConfigString(toml, configPath);
    expect(config.providers['custom']).toMatchObject({
      type: 'openai',
      baseUrl: 'https://custom.example/v1',
      apiKey: 'sk-test',
      source: { kind: 'apiJson', url: 'https://registry.example/api.json', apiKey: 'sk-registry' },
    });

    await writeConfigFile(configPath, config);
    const text = await readFile(configPath, 'utf-8');
    const roundTripped = parseConfigString(text, configPath);
    expect(roundTripped.providers['custom']?.source).toEqual({
      kind: 'apiJson',
      url: 'https://registry.example/api.json',
      apiKey: 'sk-registry',
    });
  });

  it('round-trips model roles from a fresh config', async () => {
    const configPath = join(makeTempDir(), 'model-roles.toml');

    await writeConfigFile(configPath, { providers: {}, modelRoles: { small: 'haiku' } });

    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('[model_roles]');
    expect(text).toContain('small = "haiku"');
    expect(readConfigFile(configPath).modelRoles).toEqual({ small: 'haiku' });
  });

  it('round-trips reassigned model roles instead of stale raw values', async () => {
    const configPath = join(makeTempDir(), 'model-roles-reassigned.toml');
    const config = parseConfigString('[model_roles]\nsmall = "old"\n', configPath);

    await writeConfigFile(configPath, { ...config, modelRoles: { small: 'new' } });

    expect(readConfigFile(configPath).modelRoles).toEqual({ small: 'new' });
  });

  it('round-trips cleared model roles instead of stale raw values', async () => {
    const configPath = join(makeTempDir(), 'model-roles-cleared.toml');
    const config = parseConfigString('[model_roles]\nsmall = "old"\n', configPath);

    await writeConfigFile(configPath, { ...config, modelRoles: { small: '' } });

    expect(readConfigFile(configPath).modelRoles).toEqual({ small: '' });
  });

  it('round-trips an API key environment reference without an API key', async () => {
    const configPath = join(makeTempDir(), 'api-key-env-var.toml');
    const config = parseConfigString(
      `
[providers.deepseek]
type = "openai"
api_key_env_var = "DEEPSEEK_API_KEY"
`,
      configPath,
    );

    await writeConfigFile(configPath, config);
    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('api_key_env_var = "DEEPSEEK_API_KEY"');
    expect(text).not.toContain('api_key =');
    expect(parseConfigString(text, configPath).providers['deepseek']).toMatchObject({
      apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    });
  });

  it('parses and round-trips experimental feature flags', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'experimental.toml');
    const toml = `
[experimental]
micro_compaction = false
`;
    const config = parseConfigString(toml, configPath);

    expect(config.experimental).toEqual({
      'micro_compaction': false,
    });

    await writeConfigFile(configPath, config);
    const text = await readFile(configPath, 'utf-8');

    expect(text).toContain('[experimental]');
    expect(text).toContain('micro_compaction = false');
    expect(parseConfigString(text, configPath).experimental).toEqual(config.experimental);
  });

  it('round-trips disableWorkflows as disable_workflows', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'disable-workflows.toml');

    expect(parseConfigString('disable_workflows = true\n', configPath).disableWorkflows).toBe(true);

    // Written from an in-memory config with no `raw`, so the key only reaches the
    // file through the scalar-field writer rather than being copied from `raw`.
    await writeConfigFile(configPath, { providers: {}, disableWorkflows: true });
    const text = await readFile(configPath, 'utf-8');

    expect(text).toContain('disable_workflows = true');
    expect(parseConfigString(text, configPath).disableWorkflows).toBe(true);
  });

  it('round-trips workflowSizeGuideline as workflow_size_guideline', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'workflow-size-guideline.toml');

    expect(
      parseConfigString('workflow_size_guideline = "small"\n', configPath).workflowSizeGuideline,
    ).toBe('small');

    // Written from an in-memory config with no `raw`, so the key only reaches the
    // file through the scalar-field writer rather than being copied from `raw`.
    await writeConfigFile(configPath, { providers: {}, workflowSizeGuideline: 'small' });
    const text = await readFile(configPath, 'utf-8');

    expect(text).toContain('workflow_size_guideline = "small"');
    expect(parseConfigString(text, configPath).workflowSizeGuideline).toBe('small');
  });

  it('accepts obsolete experimental feature keys as inert config', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'obsolete-experimental.toml');
    const toml = `
[experimental]
legacy_feature = true
obsolete_feature = false
removed_flag = true
`;

    const config = parseConfigString(toml, configPath);

    expect(config.experimental).toEqual({
      'legacy_feature': true,
      'obsolete_feature': false,
      'removed_flag': true,
    });

    await writeConfigFile(configPath, config);
    const text = await readFile(configPath, 'utf-8');
    expect(parseConfigString(text, configPath).experimental).toEqual(config.experimental);
  });

  it('loads defaults for absent files and writes typed fields without dropping raw sections', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'config.toml');

    expect(readConfigFile(configPath)).toEqual({ providers: {} });

    const config = parseConfigString(COMPLETE_TOML, configPath);
    const loopControl = config.loopControl;
    expect(loopControl).toBeDefined();
    await writeConfigFile(configPath, {
      ...config,
      defaultModel: 'pythinker-code/pythinker-for-coding',
      loopControl: {
        ...loopControl!,
        maxStepsPerTurn: 7,
      },
    });

    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('default_model = "pythinker-code/pythinker-for-coding"');
    expect(text).toContain('default_permission_mode = "auto"');
    expect(text).toContain('extra_skill_dirs = [ "~/team-skills", ".agents/team-skills" ]');
    expect(text).toContain('additional_dirs = [ "~/shared-project", "/tmp/reference" ]');
    expect(text).toContain('telemetry = false');
    expect(text).not.toContain('default_yolo');
    expect(text).toContain('[[permission.rules]]');
    expect(text).toContain('pattern = "Bash(rm *)"');
    expect(text).toContain('pattern = "Read(src/**)"');
    expect(text).not.toContain('[[permission.allow]]');
    expect(text).toContain('max_steps_per_turn = 7');
    expect(text).toContain('GOOGLE_CLOUD_PROJECT = "project-1"');
    expect(text).toContain('theme = "dark"');
    expect(text).toContain('claim_stale_after_ms = 15000');
    expect(text).toContain('[[hooks]]');
    expect(text).toContain('event = "PreToolUse"');
    expect(text).toContain('command = "echo pre"');

    const reloaded = readConfigFile(configPath);
    expect(reloaded.loopControl?.maxStepsPerTurn).toBe(7);
    expect(reloaded.hooks?.[0]?.event).toBe('PreToolUse');
    expect(reloaded.raw?.['theme']).toBe('dark');
  });

  it('creates a parseable default config scaffold without changing runtime defaults', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'config.toml');

    await ensureConfigFile(configPath);

    const text = await readFile(configPath, 'utf-8');
    expect(text).toContain('Runtime settings for Pythinker Code.');
    expect(text).not.toMatch(/^default_thinking =/m);
    expect(text).not.toMatch(/^default_model =/m);

    const config = readConfigFile(configPath);
    expect(config.providers).toEqual({});
    expect(config.defaultModel).toBeUndefined();
    expect(config.defaultThinking).toBeUndefined();
  });

  it('does not overwrite an existing config file', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'config.toml');
    const existing = 'default_model = "custom"\n';
    await writeFile(configPath, existing, 'utf-8');

    await ensureConfigFile(configPath);

    await expect(readFile(configPath, 'utf-8')).resolves.toBe(existing);
  });

  it('drops deprecated default_yolo when rewriting config files', async () => {
    const dir = makeTempDir();
    const configPath = join(dir, 'config.toml');
    const config = parseConfigString('default_yolo = true\n', configPath);

    expect(config.defaultPermissionMode).toBeUndefined();

    await writeConfigFile(configPath, config);

    const text = await readFile(configPath, 'utf-8');
    expect(text).not.toContain('default_yolo');
    expect(text).not.toContain('default_permission_mode');
  });

  it('rejects invalid TOML and invalid schema with PythinkerError(config.invalid)', () => {
    expect.hasAssertions();
    expectPythinkerErrorCode(
      () => parseConfigString('[[[', 'broken.toml'),
      ErrorCodes.CONFIG_INVALID,
    );
    expectPythinkerErrorCode(
      () =>
        parseConfigString(
          `
[providers.bad]
type = "not-a-provider"
`,
          'broken.toml',
        ),
      ErrorCodes.CONFIG_INVALID,
    );
    expectPythinkerErrorCode(
      () =>
        parseConfigString(
          `
[[permission.rules]]
decision = "deny"
pattern = "Bash(rm *"
`,
          'broken.toml',
        ),
      ErrorCodes.CONFIG_INVALID,
    );
  });

  it('parses hooks config from TOML arrays of tables', () => {
    const config = parseConfigString(
      `
[[hooks]]
event = "PreToolUse"
matcher = "Shell"
command = "echo hi"
timeout = 5
`,
      'hooks.toml',
    );

    expect(config.hooks).toEqual([
      {
        event: 'PreToolUse',
        matcher: 'Shell',
        command: 'echo hi',
        timeout: 5,
      },
    ]);
  });

  it('accepts project task lifecycle hook events', () => {
    const config = parseConfigString(
      `
[[hooks]]
event = "TaskCreated"
command = "echo created"

[[hooks]]
event = "TaskCompleted"
command = "echo completed"

[[hooks]]
event = "InstructionsLoaded"
matcher = "session_start"
command = "echo loaded"

[[hooks]]
event = "CwdChanged"
command = "echo cwd"

[[hooks]]
event = "PermissionDenied"
matcher = "Bash"
command = "echo denied"

[[hooks]]
event = "FileChanged"
matcher = ".env|.env.local"
command = "echo changed"

[[hooks]]
event = "Setup"
matcher = "init"
command = "echo setup"

[[hooks]]
event = "ConfigChange"
matcher = "user_settings"
command = "echo config"
`,
      'hooks.toml',
    );

    expect(config.hooks?.map((hook) => hook.event)).toEqual([
      'TaskCreated',
      'TaskCompleted',
      'InstructionsLoaded',
      'CwdChanged',
      'PermissionDenied',
      'FileChanged',
      'Setup',
      'ConfigChange',
    ]);
  });

  it('rejects invalid hooks config', () => {
    expect.hasAssertions();
    expectPythinkerErrorCode(
      () =>
        parseConfigString(
          `
hooks = [{ type = "pre-tool-call", command = "echo hi" }]
`,
          'hooks.toml',
        ),
      ErrorCodes.CONFIG_INVALID,
    );
  });
});

describe('harness config schema and patch merge', () => {
  it('accepts the empty public config and requires model context size in full configs', () => {
    expect(PythinkerConfigSchema.parse({})).toEqual({ providers: {} });
    expect(PythinkerConfigSchema.parse({ outputStyle: 'Explanatory' }).outputStyle).toBe(
      'Explanatory',
    );
    expect(() =>
      validateConfig({
        providers: {
          local: { type: 'openai', apiKey: 'sk-test' },
        },
        models: {
          broken: { provider: 'local', model: 'gpt-test' },
        },
      }),
    ).toThrow(/max_context_size/);
  });


  it('deep-merges validated patches while preserving existing typed and raw data', () => {
    const base = parseConfigString(COMPLETE_TOML);
    const merged = mergeConfigPatch(base, {
      providers: {
        'managed:kimi-code': {
          apiKey: 'sk-patched',
          baseUrl: undefined,
        },
      },
      models: {
        'pythinker-code/pythinker-for-coding': {
          capabilities: ['tool_use'],
        },
      },
      thinking: {
        effort: 'high',
      },
    });

    expect(merged.providers['managed:kimi-code']).toMatchObject({
      type: 'pythinker',
      baseUrl: 'https://api.pythinker.com/coding/v1',
      apiKey: 'sk-patched',
      env: { GOOGLE_CLOUD_PROJECT: 'project-1' },
    });
    expect(merged.models?.['pythinker-code/pythinker-for-coding']).toMatchObject({
      provider: 'managed:kimi-code',
      model: 'pythinker-for-coding',
      maxContextSize: 262144,
      capabilities: ['tool_use'],
    });
    expect(merged.thinking).toEqual({ mode: 'auto', effort: 'high' });
    expect(merged.hooks).toEqual(base.hooks);
    expect(merged.raw?.['theme']).toBe('dark');
  });

  it('deep-merges model role patches', () => {
    const merged = mergeConfigPatch(
      { providers: {}, modelRoles: { small: 'x', advisor: 'z' } },
      { modelRoles: { small: 'y' } },
    );

    expect(merged.modelRoles).toEqual({ small: 'y', advisor: 'z' });
  });

  it('deep-merges experimental config patches', () => {
    const base = parseConfigString(`
[experimental]
micro_compaction = false
`);

    const merged = mergeConfigPatch(base, {
      experimental: {
        'micro_compaction': true,
      },
    });

    expect(merged.experimental).toEqual({
      'micro_compaction': true,
    });
  });

  it('rejects unknown fields in config patches', () => {
    expect.hasAssertions();
    expectPythinkerErrorCode(
      () => mergeConfigPatch({ providers: {} }, { theme: 'dark' } as never),
      ErrorCodes.CONFIG_INVALID,
    );
  });

  it('replaces hooks arrays in config patches', () => {
    const base = parseConfigString(COMPLETE_TOML);
    const merged = mergeConfigPatch(base, {
      hooks: [{ event: 'Notification', matcher: 'task_completed', command: 'echo notified' }],
    });

    expect(merged.hooks).toEqual([
      { event: 'Notification', matcher: 'task_completed', command: 'echo notified' },
    ]);
  });

  it('accepts maxOutputSize on a model alias and round-trips it', () => {
    const parsed = PythinkerConfigSchema.parse({
      providers: { local: { type: 'anthropic', apiKey: 'sk-test' } },
      models: {
        opus: {
          provider: 'local',
          model: 'claude-opus-4-7',
          maxContextSize: 200000,
          maxOutputSize: 32000,
        },
      },
    });
    expect(parsed.models?.['opus']).toMatchObject({
      maxContextSize: 200000,
      maxOutputSize: 32000,
    });
  });

  it('leaves maxOutputSize undefined when omitted', () => {
    const parsed = PythinkerConfigSchema.parse({
      providers: { local: { type: 'anthropic', apiKey: 'sk-test' } },
      models: {
        opus: {
          provider: 'local',
          model: 'claude-opus-4-7',
          maxContextSize: 200000,
        },
      },
    });
    expect(parsed.models?.['opus']?.maxOutputSize).toBeUndefined();
  });

  it('rejects maxOutputSize <= 0', () => {
    expect(() =>
      PythinkerConfigSchema.parse({
        providers: { local: { type: 'anthropic', apiKey: 'sk-test' } },
        models: {
          opus: {
            provider: 'local',
            model: 'claude-opus-4-7',
            maxContextSize: 200000,
            maxOutputSize: 0,
          },
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "origin": "number",
          "code": "too_small",
          "minimum": 1,
          "inclusive": true,
          "path": [
            "models",
            "opus",
            "maxOutputSize"
          ],
          "message": "Too small: expected number to be >=1"
        }
      ]]
    `);
  });
});

describe('config path env override', () => {
  it('uses PYTHINKER_CODE_HOME when no explicit homeDir is supplied', () => {
    const saved = process.env['PYTHINKER_CODE_HOME'];
    try {
      process.env['PYTHINKER_CODE_HOME'] = '/tmp/pythinker-from-env';

      expect(resolvePythinkerHome()).toBe('/tmp/pythinker-from-env');
      expect(resolvePythinkerHome('/tmp/pythinker-explicit')).toBe('/tmp/pythinker-explicit');
      expect(resolveConfigPath({})).toBe('/tmp/pythinker-from-env/config.toml');
      expect(resolveConfigPath({ configPath: '/tmp/custom.toml' })).toBe('/tmp/custom.toml');
    } finally {
      if (saved === undefined) delete process.env['PYTHINKER_CODE_HOME'];
      else process.env['PYTHINKER_CODE_HOME'] = saved;
    }
  });
});

describe('config value env override helpers', () => {
  it('parses boolean env values', () => {
    expect(parseBooleanEnv('1')).toBe(true);
    expect(parseBooleanEnv(' true ')).toBe(true);
    expect(parseBooleanEnv('yes')).toBe(true);
    expect(parseBooleanEnv('on')).toBe(true);
    expect(parseBooleanEnv('0')).toBe(false);
    expect(parseBooleanEnv(' false ')).toBe(false);
    expect(parseBooleanEnv('no')).toBe(false);
    expect(parseBooleanEnv('off')).toBe(false);
    expect(parseBooleanEnv('')).toBeUndefined();
    expect(parseBooleanEnv('maybe')).toBeUndefined();
  });

  it('resolves env before config before default', () => {
    expect(
      resolveConfigValue({
        env: { PYTHINKER_TEST_FLAG: '0' },
        envKey: 'PYTHINKER_TEST_FLAG',
        configValue: true,
        defaultValue: true,
        parseEnv: parseBooleanEnv,
      }),
    ).toBe(false);

    expect(
      resolveConfigValue({
        env: {},
        envKey: 'PYTHINKER_TEST_FLAG',
        configValue: false,
        defaultValue: true,
        parseEnv: parseBooleanEnv,
      }),
    ).toBe(false);

    expect(
      resolveConfigValue({
        env: {},
        envKey: 'PYTHINKER_TEST_FLAG',
        defaultValue: true,
        parseEnv: parseBooleanEnv,
      }),
    ).toBe(true);
  });

  it('ignores invalid env values', () => {
    expect(
      resolveConfigValue({
        env: { PYTHINKER_TEST_FLAG: 'invalid' },
        envKey: 'PYTHINKER_TEST_FLAG',
        configValue: false,
        defaultValue: true,
        parseEnv: parseBooleanEnv,
      }),
    ).toBe(false);
  });
});

describe('loadRuntimeConfigSafe', () => {
  const VALID_TOML = `
default_model = "k2"

[providers.pythinker]
type = "pythinker"
api_key = "sk-good"

[models.k2]
provider = "pythinker"
model = "pythinker-for-coding"
max_context_size = 128000
`;

  async function writeTempConfig(text: string): Promise<string> {
    const configPath = join(makeTempDir(), 'config.toml');
    await writeFile(configPath, text, 'utf-8');
    return configPath;
  }

  it('loads a valid file with no warnings, matching the strict loader', async () => {
    const configPath = await writeTempConfig(VALID_TOML);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.fileWarnings).toEqual([]);
    expect(result.envWarnings).toEqual([]);
    expect(result.config).toEqual(loadRuntimeConfig(configPath, {}));
  });

  it('returns defaults with no warnings when the file is missing', () => {
    const configPath = join(makeTempDir(), 'config.toml');
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.fileWarnings).toEqual([]);
    expect(result.envWarnings).toEqual([]);
    expect(result.config.providers).toEqual({});
  });

  it('reports a fileError and defaults on invalid TOML syntax', async () => {
    const configPath = await writeTempConfig('[[[');
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.providers).toEqual({});
    // The whole file is unusable: callers decide to fail startup (fileError)
    // or keep the last good config mid-run (fileWarnings).
    expect(result.fileError).toBeInstanceOf(PythinkerError);
    expect(result.fileError?.code).toBe(ErrorCodes.CONFIG_INVALID);
    expect(result.fileError?.message).toContain('Invalid TOML');
    expect(result.fileError?.message).toContain(configPath);
    expect(result.fileWarnings).toHaveLength(1);
    const warning = result.fileWarnings[0]!;
    expect(warning).toContain('Invalid TOML');
    // Single-line summary with the error location, not the multi-line code frame.
    expect(warning).not.toContain('\n');
    expect(warning).toContain('line 1');
  });

  it('does not set fileError when only sections are dropped', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "nope"
`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.fileError).toBeUndefined();
    expect(result.fileWarnings).toHaveLength(1);
  });

  it('drops only an invalid section on schema errors and keeps the rest', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "not-a-number"
`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.loopControl).toBeUndefined();
    expect(result.config.providers['pythinker']).toMatchObject({ type: 'pythinker', apiKey: 'sk-good' });
    expect(result.config.models?.['k2']).toMatchObject({ maxContextSize: 128000 });
    expect(result.config.defaultModel).toBe('k2');
    expect(result.fileWarnings).toHaveLength(1);
    expect(result.fileWarnings[0]).toContain('loop_control');
    // The original file content stays visible in raw so nothing is lost.
    expect(result.config.raw?.['loop_control']).toEqual({ max_steps_per_turn: 'not-a-number' });
  });

  it('drops only the broken provider entry, keeping other providers', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[providers.bad]
type = "not-a-provider"
`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.providers['bad']).toBeUndefined();
    expect(result.config.providers['pythinker']).toMatchObject({ type: 'pythinker' });
    expect(result.fileWarnings).toHaveLength(1);
    expect(result.fileWarnings[0]).toContain('providers.bad');
  });

  it('keeps other providers when one entry has multiple validation issues', async () => {
    // Two issues on the same entry: the second must not escalate to
    // deleting the whole providers section after the first dropped the entry.
    const configPath = await writeTempConfig(`${VALID_TOML}
[providers.bad]
type = "not-a-provider"
api_key = 123
`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.providers['bad']).toBeUndefined();
    expect(result.config.providers['pythinker']).toMatchObject({ type: 'pythinker' });
    expect(result.fileWarnings).toHaveLength(1);
    expect(result.fileWarnings[0]).toContain('providers.bad');
    expect(result.fileWarnings[0]).not.toMatch(/providers[,.]? /);
  });

  it('drops only the broken model entry', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[models.broken]
provider = "pythinker"
model = "x"
max_context_size = -5
`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.models?.['broken']).toBeUndefined();
    expect(result.config.models?.['k2']).toBeDefined();
    expect(result.fileWarnings[0]).toContain('models.broken');
  });

  it('drops only the broken model role entry', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[model_roles]
small = 123
implementer = "k2"
`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.modelRoles?.['small']).toBeUndefined();
    expect(result.config.modelRoles?.['implementer']).toBe('k2');
    expect(result.fileWarnings[0]).toContain('model_roles.small');
  });

  it('drops the whole hooks list when one hook is invalid', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[[hooks]]
event = "NotARealEvent"
command = "echo hi"
`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.hooks).toBeUndefined();
    expect(result.config.providers['pythinker']).toBeDefined();
    expect(result.fileWarnings[0]).toContain('hooks');
  });

  it('reports every dropped section in the warning', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "nope"

[background]
max_running_tasks = 0
`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.loopControl).toBeUndefined();
    expect(result.config.background).toBeUndefined();
    expect(result.fileWarnings).toHaveLength(1);
    expect(result.fileWarnings[0]).toContain('loop_control');
    expect(result.fileWarnings[0]).toContain('background');
  });

  it('applies PYTHINKER_MODEL_* env overrides on top of a salvaged config', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "nope"
`);
    const result = loadRuntimeConfigSafe(configPath, {
      PYTHINKER_MODEL_NAME: 'env-model',
      PYTHINKER_MODEL_API_KEY: 'sk-env',
      PYTHINKER_MODEL_MAX_CONTEXT_SIZE: '262144',
      PYTHINKER_MODEL_BASE_URL: 'https://llm.example.com/v1',
    });
    expect(result.envWarnings).toEqual([]);
    expect(result.config.models?.['__pythinker_env_model__']).toBeDefined();
    expect(result.config.providers['pythinker']).toBeDefined();
    expect(result.fileWarnings).toHaveLength(1);
  });

  it('skips PYTHINKER_MODEL_* overrides with an env warning instead of throwing', async () => {
    const configPath = await writeTempConfig(VALID_TOML);
    const result = loadRuntimeConfigSafe(configPath, {
      PYTHINKER_MODEL_NAME: 'env-model',
    });
    expect(result.fileWarnings).toEqual([]);
    expect(result.envWarnings).toHaveLength(1);
    expect(result.envWarnings[0]).toContain('PYTHINKER_MODEL');
    expect(result.config).toEqual(readConfigFile(configPath));
  });

  it('readConfigFileForUpdate rewraps validation errors with an actionable message', async () => {
    const configPath = await writeTempConfig(`${VALID_TOML}
[loop_control]
max_steps_per_turn = "nope"
`);
    let thrown: unknown;
    try {
      readConfigFileForUpdate(configPath);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PythinkerError);
    expect((thrown as PythinkerError).message).toContain('fix it first');
    expect((thrown as PythinkerError).message).toContain('pythinker doctor');
    expect((thrown as PythinkerError).message).not.toContain('invalid_type');

    const goodPath = await writeTempConfig(VALID_TOML);
    expect(readConfigFileForUpdate(goodPath)).toEqual(readConfigFile(goodPath));
  });

  it('drops invalid top-level scalars and keeps the rest', async () => {
    const configPath = await writeTempConfig(`default_thinking = "not-a-boolean"
${VALID_TOML}`);
    const result = loadRuntimeConfigSafe(configPath, {});
    expect(result.config.defaultThinking).toBeUndefined();
    expect(result.config.providers['pythinker']).toBeDefined();
    expect(result.fileWarnings).toHaveLength(1);
    expect(result.fileWarnings[0]).toContain('default_thinking');
  });
});
