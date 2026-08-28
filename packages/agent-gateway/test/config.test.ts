import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { configResponseSchema, type ConfigResponse } from '../src/protocol/rest-config';
import { ErrorCode } from '../src/protocol/error-codes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type RunningServer, startServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { authedFetch } from './helpers/auth';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
}

describe('server-v2 /api/v1/config', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pythinker-server-v2-config-'));
  });

  afterEach(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  async function boot(toml?: string): Promise<void> {
    if (toml !== undefined) {
      await writeFile(join(home as string, 'config.toml'), toml, 'utf-8');
    }
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  }

  async function getConfig(): Promise<ConfigResponse> {
    const res = await authedFetch(server as RunningServer, base, '/api/v1/config');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<ConfigResponse>;
    expect(body.code).toBe(0);
    return configResponseSchema.parse(body.data);
  }

  async function patchConfig(patch: Record<string, unknown>): Promise<ConfigResponse> {
    const res = await authedFetch(server as RunningServer, base, '/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Envelope<ConfigResponse>;
    expect(body.code).toBe(0);
    return configResponseSchema.parse(body.data);
  }

  it('GET echoes default_permission_mode and derives yolo = false', async () => {
    await boot('default_permission_mode = "auto"\n');
    const cfg = await getConfig();
    expect(cfg.default_permission_mode).toBe('auto');
    expect(cfg.yolo).toBe(false);
  });

  it('POST { yolo: true } sets default_permission_mode = yolo and echoes yolo = true', async () => {
    await boot();
    const cfg = await patchConfig({ yolo: true });
    expect(cfg.default_permission_mode).toBe('yolo');
    expect(cfg.yolo).toBe(true);

    const after = await getConfig();
    expect(after.default_permission_mode).toBe('yolo');
    expect(after.yolo).toBe(true);
  });

  it('POST { default_permission_mode: auto } writes the canonical field and derives yolo = false', async () => {
    await boot();
    const cfg = await patchConfig({ default_permission_mode: 'auto' });
    expect(cfg.default_permission_mode).toBe('auto');
    expect(cfg.yolo).toBe(false);

    const after = await getConfig();
    expect(after.default_permission_mode).toBe('auto');
    expect(after.yolo).toBe(false);
  });

  const FAST_MODELS_TOML = [
    '[providers.provider]',
    'type = "openai"',
    'api_key = "sk-test"',
    'base_url = "https://provider.example.test"',
    '',
    '[models."provider/fast"]',
    'provider = "provider"',
    'model = "fast"',
    'max_context_size = 1000',
    '',
    '[models."provider/fast_model"]',
    'provider = "provider"',
    'model = "fast-model"',
    'max_context_size = 1000',
    '',
    '[models."provider/slow"]',
    'provider = "provider"',
    'model = "slow"',
    'max_context_size = 1000',
    '',
  ].join('\n');

  it('POST { secondary_model } persists the subagent model pool and GET echoes it', async () => {
    await boot(FAST_MODELS_TOML);
    const cfg = await patchConfig({
      secondary_model: {
        default_model: 'provider/fast',
        models: { 'provider/fast': 'fast and cheap' },
      },
    });
    expect(cfg.secondary_model).toMatchObject({ defaultModel: 'provider/fast' });

    const after = await getConfig();
    expect(after.secondary_model).toMatchObject({
      defaultModel: 'provider/fast',
      models: { 'provider/fast': 'fast and cheap' },
    });
  });

  it('POST { secondary_model } preserves pool alias keys containing underscores', async () => {
    await boot(FAST_MODELS_TOML);
    await patchConfig({
      secondary_model: { default_model: 'provider/fast_model', models: { 'provider/fast_model': '' } },
    });

    const after = await getConfig();
    expect(after.secondary_model).toMatchObject({
      defaultModel: 'provider/fast_model',
      models: { 'provider/fast_model': '' },
    });
    expect(
      Object.keys((after.secondary_model as { models: Record<string, string> }).models),
    ).not.toContain('provider/fastModel');
  });

  it('POST { secondary_model: null } removes the subagent model override', async () => {
    await boot(`${FAST_MODELS_TOML}[secondary_model]\nmodel = "provider/fast"\ndefault_effort = "low"\n`);

    const cfg = await patchConfig({ secondary_model: null });
    expect(cfg.secondary_model).toBeUndefined();
    expect((await getConfig()).secondary_model).toBeUndefined();
  });

  it('POST { providers } converts fields of a provider id colliding with a map-valued key', async () => {
    await boot();
    await patchConfig({
      providers: {
        models: { type: 'openai', base_url: 'https://example.test', api_key: 'sk-test' },
      },
    });

    const after = await getConfig();
    expect(after.providers['models']).toMatchObject({
      type: 'openai',
      base_url: 'https://example.test',
      has_api_key: true,
    });
  });

  it('session create with a broken subagent model pool fails with VALIDATION_FAILED', async () => {
    await boot(
      '[experimental]\n"secondary-model" = true\n\n[secondary_model.models]\n"provider/fast" = "fast and cheap"\n',
    );
    const res = await authedFetch(server as RunningServer, base, '/api/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { cwd: home as string } }),
    });
    const body = (await res.json()) as Envelope<null>;
    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(body.msg).toContain('[secondary_model].default_model is required');
  });

  it('session create with a broken subagent model pool succeeds while the experiment is off', async () => {
    await boot('[secondary_model.models]\n"provider/fast" = "fast and cheap"\n');
    const res = await authedFetch(server as RunningServer, base, '/api/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { cwd: home as string } }),
    });
    const body = (await res.json()) as Envelope<{ id: string }>;
    expect(body.code).toBe(0);
  });
});

describe('server-v2 /api/v1/config secondary_model replacement and request atomicity', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pythinker-server-v2-config-atomic-'));
  });

  afterEach(async () => {
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  async function boot(toml?: string, env?: NodeJS.ProcessEnv): Promise<void> {
    if (toml !== undefined) {
      await writeFile(join(home as string, 'config.toml'), toml, 'utf-8');
    }
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
      env,
    });
    base = `http://127.0.0.1:${server.port}`;
  }

  async function post(patch: unknown): Promise<{ status: number; body: Envelope<unknown> }> {
    const res = await authedFetch(server as RunningServer, base, '/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return { status: res.status, body: (await res.json()) as Envelope<unknown> };
  }

  async function getConfig(): Promise<ConfigResponse> {
    const res = await authedFetch(server as RunningServer, base, '/api/v1/config');
    const body = (await res.json()) as Envelope<ConfigResponse>;
    expect(body.code).toBe(0);
    return configResponseSchema.parse(body.data);
  }

  async function diskToml(): Promise<string> {
    return readFile(join(home as string, 'config.toml'), 'utf-8');
  }

  const MODELS_TOML = [
    '[providers.provider]',
    'type = "openai"',
    'api_key = "sk-test"',
    'base_url = "https://provider.example.test"',
    '',
    '[models."provider/fast"]',
    'provider = "provider"',
    'model = "fast"',
    'max_context_size = 1000',
    '',
    '[models."provider/slow"]',
    'provider = "provider"',
    'model = "slow"',
    'max_context_size = 1000',
    '',
  ].join('\n');

  it('force true -> false drops the force field instead of keeping the stale value', async () => {
    await boot(MODELS_TOML);
    await post({ secondary_model: { default_model: 'provider/fast', force: true } });
    expect((await getConfig()).secondary_model).toMatchObject({ force: true });

    const res = await post({ secondary_model: { default_model: 'provider/fast', force: false } });
    expect(res.body.code).toBe(0);
    const after = await getConfig();
    expect(after.secondary_model).toEqual({ defaultModel: 'provider/fast' });
    expect(await diskToml()).not.toContain('force');
  });

  it('pool -> default drops the models table', async () => {
    await boot(MODELS_TOML);
    await post({
      secondary_model: {
        default_model: 'provider/fast',
        models: { 'provider/fast': 'fast', 'provider/slow': 'slow' },
      },
    });
    await post({ secondary_model: { default_model: 'provider/slow' } });
    expect((await getConfig()).secondary_model).toEqual({ defaultModel: 'provider/slow' });
    expect(await diskToml()).not.toContain('[secondary_model.models]');
  });

  it('pool -> force drops the models table and keeps force', async () => {
    await boot(MODELS_TOML);
    await post({
      secondary_model: { default_model: 'provider/fast', models: { 'provider/fast': '' } },
    });
    await post({ secondary_model: { default_model: 'provider/fast', force: true } });
    expect((await getConfig()).secondary_model).toEqual({
      defaultModel: 'provider/fast',
      force: true,
    });
  });

  it('default -> inherit removes the section from disk', async () => {
    await boot(MODELS_TOML);
    await post({ secondary_model: { default_model: 'provider/fast' } });
    await post({ secondary_model: null });
    expect((await getConfig()).secondary_model).toBeUndefined();
    expect(await diskToml()).not.toContain('secondary_model');
  });

  it('an invalid domain in a multi-domain request leaves every participating domain unchanged', async () => {
    await boot('default_permission_mode = "auto"\n');
    const res = await post({
      default_permission_mode: 'yolo',
      subagent: { timeout_ms: 'not-a-number' },
    });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    const after = await getConfig();
    expect(after.default_permission_mode).toBe('auto');
    expect(after.subagent).toEqual({ timeoutMs: 7_200_000 });
    expect(await diskToml()).toContain('default_permission_mode = "auto"');
    expect(await diskToml()).not.toContain('yolo');
  });

  it('accepts the web client camelCase secondary_model shape and drops force: false', async () => {
    await boot(MODELS_TOML);
    const res = await post({
      secondary_model: { defaultModel: 'provider/fast', defaultEffort: 'low', force: false },
    });
    expect(res.body.code).toBe(0);
    expect((await getConfig()).secondary_model).toEqual({
      defaultModel: 'provider/fast',
      defaultEffort: 'low',
    });
  });

  it('a providers patch still merges with the existing providers table', async () => {
    await boot();
    await post({
      providers: { alpha: { type: 'openai', base_url: 'https://alpha.example.test' } },
    });
    await post({
      providers: { beta: { type: 'openai', base_url: 'https://beta.example.test' } },
    });
    const after = await getConfig();
    expect(Object.keys(after.providers).sort()).toEqual(['alpha', 'beta']);
    expect(after.providers['alpha']?.base_url).toBe('https://alpha.example.test');
  });

  it('a section patch never writes environment or default values into the user layer', async () => {
    await boot(undefined, { ...process.env, PYTHINKER_SUBAGENT_TIMEOUT_MS: '1234' });
    expect((await getConfig()).subagent).toEqual({ timeoutMs: 1234 });

    const res = await post({ subagent: {} });
    expect(res.body.code).toBe(0);
    expect((await getConfig()).subagent).toEqual({ timeoutMs: 1234 });
    expect(await diskToml()).not.toContain('timeout_ms');
  });

  it('validates secondary_model against the prospective post-request model configuration', async () => {
    await boot(MODELS_TOML);
    const luna = { provider: 'provider', model: 'luna', max_context_size: 1000 };

    const unknown = await post({ secondary_model: { default_model: 'provider/luna' } });
    expect(unknown.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await diskToml()).not.toContain('secondary_model');

    const together = await post({
      models: { 'provider/luna': luna },
      secondary_model: { default_model: 'provider/luna', models: { 'provider/luna': 'new' } },
    });
    expect(together.body.code).toBe(0);
    expect((await getConfig()).secondary_model).toMatchObject({ defaultModel: 'provider/luna' });
    expect(await diskToml()).toContain('[models."provider/luna"]');

    const mixedInvalid = await post({
      models: { 'provider/sol': { provider: 'provider', model: 'sol', max_context_size: 1000 } },
      secondary_model: { default_model: 'provider/sol', models: { 'provider/sol': '', 'provider/nope': '' } },
    });
    expect(mixedInvalid.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await diskToml()).not.toContain('[models."provider/sol"]');
    expect((await getConfig()).secondary_model).toMatchObject({ defaultModel: 'provider/luna' });

    const swap = await post({
      models: { 'provider/sol': { provider: 'provider', model: 'sol', max_context_size: 1000 } },
      secondary_model: { default_model: 'provider/sol' },
    });
    expect(swap.body.code).toBe(0);
    expect(await diskToml()).toContain('[models."provider/sol"]');
    expect((await getConfig()).secondary_model).toEqual({ defaultModel: 'provider/sol' });
  });

  it('validates secondary_model against the effective configuration including the env model overlay', async () => {
    await boot(MODELS_TOML, {
      ...process.env,
      PYTHINKER_MODEL_NAME: 'env-model',
      PYTHINKER_API_KEY: 'sk-env',
      PYTHINKER_BASE_URL: 'https://env.example.test',
    });
    const cfg = await getConfig();
    expect(Object.keys(cfg.models ?? {})).toContain('__pythinker_env_model__');

    const envAlias = await post({ secondary_model: { default_model: '__pythinker_env_model__' } });
    expect(envAlias.body.code).toBe(0);
    expect((await getConfig()).secondary_model).toEqual({ defaultModel: '__pythinker_env_model__' });

    const both = await post({
      models: { 'provider/extra': { provider: 'provider', model: 'extra', max_context_size: 1000 } },
      secondary_model: {
        default_model: '__pythinker_env_model__',
        models: { '__pythinker_env_model__': '', 'provider/fast': '', 'provider/extra': '' },
      },
    });
    expect(both.body.code).toBe(0);
    expect((await getConfig()).secondary_model).toMatchObject({ defaultModel: '__pythinker_env_model__' });
  });

  it('rejects a malformed secondary_model body with VALIDATION_FAILED and writes nothing', async () => {
    await boot();
    const res = await post({ secondary_model: { default_model: 42, force: 'yes' } });
    expect(res.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(res.body.msg).toContain('secondary_model');
    expect((await getConfig()).secondary_model).toBeUndefined();

    const unknownField = await post({ secondary_model: { default_model: 'p/m', bogus: 1 } });
    expect(unknownField.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect((await getConfig()).secondary_model).toBeUndefined();
  });
});
