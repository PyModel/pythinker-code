import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IConfigService } from '@pymodel/agent-core-v2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorCode } from '../src/protocol/error-codes';
import {
  subagentModelPolicyResponseSchema,
  type SubagentModelPolicyResponse,
} from '../src/protocol/rest-config';
import { type RunningServer, startServer } from '../src/start';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';
import { authedFetch } from './helpers/auth';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
}

const PATH = '/api/v1/config/subagent-model-policy';

const MODELS_TOML = [
  '[providers.acme]',
  'type = "openai"',
  'api_key = "sk-test"',
  'base_url = "https://acme.example.test"',
  '',
  '[models."acme/sol"]',
  'provider = "acme"',
  'model = "sol"',
  'max_context_size = 100000',
  '',
  '[models."acme/luna"]',
  'provider = "acme"',
  'model = "luna"',
  'max_context_size = 100000',
  '',
].join('\n');

describe('server-v2 /api/v1/config/subagent-model-policy', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;
  let base: string;

  beforeEach(async () => {
    vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_FLAG', '0');
    vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_SECONDARY_MODEL', undefined);
    home = await mkdtemp(join(tmpdir(), 'pythinker-server-v2-policy-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server !== undefined) {
      await server.close();
      server = undefined;
    }
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  async function boot(toml: string = MODELS_TOML): Promise<void> {
    await writeFile(join(home as string, 'config.toml'), toml, 'utf-8');
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  }

  async function call(
    method: 'GET' | 'PUT' | 'DELETE',
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; etag: string | null; body: Envelope<SubagentModelPolicyResponse | null> }> {
    const res = await authedFetch(server as RunningServer, base, PATH, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: res.status,
      etag: res.headers.get('etag'),
      body: (await res.json()) as Envelope<SubagentModelPolicyResponse | null>,
    };
  }

  async function disk(): Promise<string> {
    return readFile(join(home as string, 'config.toml'), 'utf-8');
  }

  it('GET on the absent section returns inherit with a strong ETag', async () => {
    await boot();
    const res = await call('GET');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    const data = subagentModelPolicyResponseSchema.parse(res.body.data);
    expect(data.policy).toEqual({ mode: 'inherit' });
    expect(data.effective.effective_policy).toEqual({ mode: 'inherit' });
    expect(data.effective.feature).toEqual({ enabled: false, source: 'default' });
    expect(res.etag).toMatch(/^"subagent-policy-v1:[0-9a-f]+"$/);
    expect(res.etag?.startsWith('W/')).toBe(false);
    expect(res.etag).toBe(`"${data.resource_version}"`);
  });

  it('PUT persists a canonical policy, echoes a new ETag, and rejects unknown models before writing', async () => {
    await boot();
    const before = (await call('GET')).etag;
    const bad = await call('PUT', { mode: 'default', default_model: 'acme/nope' });
    expect(bad.status).toBe(200);
    expect(bad.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(await disk()).not.toContain('secondary_model');

    const ok = await call('PUT', {
      mode: 'pool',
      default_model: 'acme/sol',
      models: { 'acme/sol': 'main', 'acme/luna': 'fast' },
      default_effort: 'low',
    });
    expect(ok.body.code).toBe(0);
    expect(ok.etag).not.toBe(before);
    const data = subagentModelPolicyResponseSchema.parse(ok.body.data);
    expect(data.policy).toEqual({
      mode: 'pool',
      default_model: 'acme/sol',
      models: { 'acme/sol': 'main', 'acme/luna': 'fast' },
      default_effort: 'low',
    });
    expect(await disk()).toContain('[secondary_model.models]');

    const poolDefaultOutside = await call('PUT', {
      mode: 'pool',
      default_model: 'acme/luna',
      models: { 'acme/sol': '' },
    });
    expect(poolDefaultOutside.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect((await call('GET')).etag).toBe(ok.etag);
  });

  it('If-Match with a stale ETag is rejected with 412 and leaves disk unchanged', async () => {
    await boot();
    const first = await call('PUT', { mode: 'default', default_model: 'acme/sol' });
    const stale = first.etag as string;
    const second = await call('PUT', { mode: 'default', default_model: 'acme/luna' }, { 'if-match': stale });
    expect(second.body.code).toBe(0);
    const conflict = await call('PUT', { mode: 'force', default_model: 'acme/sol' }, { 'if-match': stale });
    expect(conflict.status).toBe(412);
    expect(conflict.body.code).toBe(ErrorCode.CONFIG_VERSION_CONFLICT);
    expect(await disk()).toContain('default_model = "acme/luna"');
    expect(await disk()).not.toContain('force');

    const staleDelete = await call('DELETE', undefined, { 'if-match': stale });
    expect(staleDelete.status).toBe(412);
    expect(await disk()).toContain('default_model = "acme/luna"');
  });

  it('DELETE removes the section (no mode on disk) and a stale inherit ETag is rejected after another write', async () => {
    await boot();
    const inheritEtag = (await call('GET')).etag as string;
    await call('PUT', { mode: 'default', default_model: 'acme/sol' });
    const conflict = await call('PUT', { mode: 'inherit' }, { 'if-match': inheritEtag });
    expect(conflict.status).toBe(412);

    const current = (await call('GET')).etag as string;
    const removed = await call('DELETE', undefined, { 'if-match': current });
    expect(removed.body.code).toBe(0);
    expect(removed.body.data?.policy).toEqual({ mode: 'inherit' });
    expect(await disk()).not.toContain('secondary_model');
    expect(await disk()).not.toContain('mode =');
    expect((await call('GET')).etag).toBe(inheritEtag);
  });

  it('ETag is stable across key order and no-op writes, and changes on an external file edit', async () => {
    await boot();
    const a = await call('PUT', {
      mode: 'pool',
      default_model: 'acme/sol',
      models: { 'acme/sol': '', 'acme/luna': '' },
    });
    const b = await call('PUT', {
      models: { 'acme/luna': '', 'acme/sol': '' },
      default_model: 'acme/sol',
      mode: 'pool',
    });
    expect(b.etag).toBe(a.etag);
    const noop = await call('PUT', {
      mode: 'pool',
      default_model: 'acme/sol',
      models: { 'acme/sol': '', 'acme/luna': '' },
    }, { 'if-match': a.etag as string });
    expect(noop.etag).toBe(a.etag);

    const edited = (await disk()).replace('[secondary_model.models]', '[secondary_model.models]\n"acme/extra" = ""');
    await writeFile(join(home as string, 'config.toml'), edited, 'utf-8');
    await (server as RunningServer).core.accessor.get(IConfigService).reload();
    expect((await call('GET')).etag).not.toBe(a.etag);
  });

  it('legacy POST /config and canonical PUT produce identical persisted state', async () => {
    await boot();
    await call('PUT', { mode: 'force', default_model: 'acme/sol', default_effort: 'low' });
    const viaPut = await disk();
    expect(viaPut).toContain('[secondary_model]');
    const removed = await call('DELETE');
    expect(removed.body.code).toBe(0);
    expect(removed.body.data?.policy).toEqual({ mode: 'inherit' });
    expect(await disk()).not.toContain('secondary_model');
    const legacy = await authedFetch(server as RunningServer, base, '/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secondary_model: { default_model: 'acme/sol', force: true, default_effort: 'low' } }),
    });
    expect(((await legacy.json()) as Envelope<unknown>).code).toBe(0);
    expect(await disk()).toBe(viaPut);
    expect((await call('GET')).body.data?.policy).toEqual({
      mode: 'force',
      default_model: 'acme/sol',
      default_effort: 'low',
    });
  });

  it('reports the effective policy as inherit while the feature is disabled and the configured one otherwise', async () => {
    await boot();
    await call('PUT', { mode: 'force', default_model: 'acme/sol' });
    const disabled = subagentModelPolicyResponseSchema.parse((await call('GET')).body.data);
    expect(disabled.effective.configured_policy.mode).toBe('force');
    expect(disabled.effective.effective_policy).toEqual({ mode: 'inherit' });
    expect(disabled.effective.policy_source).toBe('default');

    await authedFetch(server as RunningServer, base, '/api/v1/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ experimental: { 'secondary-model': true } }),
    });
    const enabled = subagentModelPolicyResponseSchema.parse((await call('GET')).body.data);
    expect(enabled.effective.effective_policy.mode).toBe('force');
    expect(enabled.effective.feature).toEqual({ enabled: true, source: 'config' });
  });

  it('rejects a malformed body with VALIDATION_FAILED', async () => {
    await boot();
    const res = await call('PUT', { mode: 'pool', default_model: 'acme/sol' });
    expect(res.body.code).toBe(ErrorCode.VALIDATION_FAILED);
    const unknownMode = await call('PUT', { mode: 'sometimes' });
    expect(unknownMode.body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });
});
