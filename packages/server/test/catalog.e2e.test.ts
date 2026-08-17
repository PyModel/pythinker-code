import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pino } from 'pino';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ICatalogService } from '@pymodel/agent-core';
import { ErrorCode } from '@pymodel/protocol';
import type { AgentProfile, Plugin } from '@pymodel/protocol';

import { IRestGateway, startServer, type RunningServer } from '../src';

let tmpDir: string;
let lockPath: string;
let bridgeHome: string;
let server: RunningServer | undefined;

const plugin: Plugin = {
  id: 'acme',
  display_name: 'Acme',
  version: '1.0.0',
  enabled: true,
  source: 'user',
  state: 'loaded',
  skill_count: 2,
  mcp_server_count: 0,
  has_errors: false,
};

const profile: AgentProfile = {
  name: 'reviewer',
  description: 'Reviews a diff',
  source: 'project',
  tools: ['read'],
};

function makeCatalog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _serviceBrand: undefined,
    listPlugins: vi.fn(async () => [plugin] as readonly Plugin[]),
    setPluginEnabled: vi.fn(async () => {}),
    listAgentProfiles: vi.fn(async () => [profile] as readonly AgentProfile[]),
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pythinker-server-catalog-test-'));
  lockPath = join(tmpDir, 'lock');
  bridgeHome = mkdtempSync(join(tmpdir(), 'pythinker-server-catalog-home-'));
});

afterEach(async () => {
  try {
    await server?.close();
  } catch {
    // ignore
  }
  server = undefined;
  rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(bridgeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function bootDaemon(catalog: unknown): Promise<RunningServer> {
  server = await startServer({
    host: '127.0.0.1',
    port: 0,
    lockPath,
    logger: pino({ level: 'silent' }),
    coreProcessOptions: { homeDir: bridgeHome },
    serviceOverrides: [[ICatalogService, catalog]],
  });
  return server;
}

function appOf(r: RunningServer): {
  inject: (req: unknown) => Promise<{ statusCode: number; json: () => unknown }>;
} {
  return r.services.invokeFunction((a) => {
    const gw = a.get(IRestGateway);
    return gw.app as unknown as {
      inject: (req: unknown) => Promise<{ statusCode: number; json: () => unknown }>;
    };
  });
}

const envelopeSchema = z.object({
  code: z.number(),
  msg: z.string(),
  data: z.unknown(),
  request_id: z.string().min(1),
});

/** Parses the uniform `{code, msg, data, request_id}` envelope every route returns. */
function envelopeOf<T>(body: unknown): {
  code: number;
  msg: string;
  data: T | null;
  request_id: string;
} {
  const envelope = envelopeSchema.parse(body);
  return { ...envelope, data: envelope.data as T | null };
}

describe('catalog routes', () => {
  it('lists installed plugins', async () => {
    const catalog = makeCatalog();
    const r = await bootDaemon(catalog);

    const res = await appOf(r).inject({ method: 'GET', url: '/api/v1/plugins' });

    expect(res.statusCode).toBe(200);
    const env = envelopeOf<{ plugins: Plugin[] }>(res.json());
    expect(env.code).toBe(0);
    expect(env.data?.plugins).toEqual([plugin]);
  });

  it('disables a plugin through the set-enabled action', async () => {
    const catalog = makeCatalog();
    const r = await bootDaemon(catalog);

    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/plugins/acme:set-enabled',
      payload: { enabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(envelopeOf<{ id: string; enabled: boolean }>(res.json()).data)
      .toEqual({ id: 'acme', enabled: false });
    expect(catalog.setPluginEnabled).toHaveBeenCalledWith('acme', false);
  });

  it('rejects the bare plugin path, which carries no action', async () => {
    const catalog = makeCatalog();
    const r = await bootDaemon(catalog);

    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/plugins/acme',
      payload: { enabled: false },
    });

    expect(envelopeOf<unknown>(res.json()).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(catalog.setPluginEnabled).not.toHaveBeenCalled();
  });

  it('rejects an unknown action suffix', async () => {
    const catalog = makeCatalog();
    const r = await bootDaemon(catalog);

    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/plugins/acme:remove',
      payload: { enabled: false },
    });

    expect(envelopeOf<unknown>(res.json()).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(catalog.setPluginEnabled).not.toHaveBeenCalled();
  });

  it('lists subagent profiles for a working directory', async () => {
    const catalog = makeCatalog();
    const r = await bootDaemon(catalog);

    const res = await appOf(r).inject({
      method: 'GET',
      url: '/api/v1/agent-profiles?work_dir=%2Fworkspace%2Fdemo',
    });

    expect(res.statusCode).toBe(200);
    expect(envelopeOf<{ profiles: AgentProfile[] }>(res.json()).data?.profiles).toEqual([profile]);
    expect(catalog.listAgentProfiles).toHaveBeenCalledWith('/workspace/demo');
  });

  it('rejects a subagent listing with no working directory', async () => {
    const catalog = makeCatalog();
    const r = await bootDaemon(catalog);

    const res = await appOf(r).inject({ method: 'GET', url: '/api/v1/agent-profiles' });

    expect(envelopeOf<unknown>(res.json()).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(catalog.listAgentProfiles).not.toHaveBeenCalled();
  });
});
