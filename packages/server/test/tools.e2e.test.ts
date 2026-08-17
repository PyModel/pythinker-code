/**
 * Tools + MCP end-to-end tests (W9.1 / Chain 7 / P1.7).
 *
 * Coverage:
 *   - GET  /api/v1/tools                              → envelope shape + tools[]
 *   - GET  /api/v1/mcp/servers                        → envelope shape + servers[]
 *   - POST /api/v1/mcp/servers/{id}:restart           → {restarting:true} on a real
 *                                                   server / 40408 on unknown
 *   - POST /api/v1/mcp/servers/foo:bogus              → 40001 unsupported action
 *
 * **Bootstrap strategy**: spawn the real server and create one session so the
 * agent-core `getTools` / `listMcpServers` can dispatch (those calls live on
 * the SessionAPI). The HOME dir is a fresh tmpdir so plugin discovery is
 * sandboxed.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pino } from 'pino';
import {
  listMcpServersResponseSchema,
  listToolsResponseSchema,
} from '@pymodel/protocol';
import {
  McpServerAlreadyExistsError,
  McpServerNotFoundError,
  McpServerValidationError,
  type IInstantiationService,
  type IMcpService,
} from '@pymodel/agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IRestGateway, startServer, type RunningServer } from '../src';
import { registerToolsRoutes } from '../src/routes/tools';

let tmpDir: string;
let lockPath: string;
let bridgeHome: string;
let server: RunningServer | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pythinker-server-tools-test-'));
  lockPath = join(tmpDir, 'lock');
  bridgeHome = mkdtempSync(join(tmpdir(), 'pythinker-server-tools-home-'));
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

async function bootDaemon(): Promise<RunningServer> {
  server = await startServer({
    host: '127.0.0.1',
    port: 0,
    lockPath,
    logger: pino({ level: 'silent' }),
    coreProcessOptions: { homeDir: bridgeHome },
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

function envelopeOf<T>(body: unknown): {
  code: number;
  msg: string;
  data: T | null;
  request_id: string;
  details?: unknown;
} {
  return body as {
    code: number;
    msg: string;
    data: T | null;
    request_id: string;
    details?: unknown;
  };
}

async function createSession(r: RunningServer): Promise<string> {
  const res = await appOf(r).inject({
    method: 'POST',
    url: '/api/v1/sessions',
    payload: { metadata: { cwd: join(tmpDir, 'workspace') } },
  });
  const env = envelopeOf<{ id: string }>(res.json());
  if (env.code !== 0 || env.data === null) {
    throw new Error(`create session failed: ${JSON.stringify(env)}`);
  }
  return env.data.id;
}

describe('GET /api/v1/tools', () => {
  it('returns an envelope with {tools: ToolDescriptor[]} (empty list pre-session)', async () => {
    const r = await bootDaemon();
    const res = await appOf(r).inject({ method: 'GET', url: '/api/v1/tools' });
    expect(res.statusCode).toBe(200);
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(0);
    // Before any session exists, the global list is empty by design.
    const parsed = listToolsResponseSchema.parse(env.data);
    expect(parsed.tools).toEqual([]);
  });

  it('returns a populated list after a session exists (response data round-trips through schema)', async () => {
    const r = await bootDaemon();
    await createSession(r);
    const res = await appOf(r).inject({ method: 'GET', url: '/api/v1/tools' });
    expect(res.statusCode).toBe(200);
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(0);
    const parsed = listToolsResponseSchema.parse(env.data);
    // We don't assert a specific count (depends on plugin discovery in the
    // sandboxed home dir), only that the envelope shape is valid and every
    // descriptor parses.
    expect(Array.isArray(parsed.tools)).toBe(true);
  });

  it('accepts session_id query and returns the same shape', async () => {
    const r = await bootDaemon();
    const sid = await createSession(r);
    const res = await appOf(r).inject({
      method: 'GET',
      url: `/api/v1/tools?session_id=${sid}`,
    });
    expect(res.statusCode).toBe(200);
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(0);
    expect(listToolsResponseSchema.safeParse(env.data).success).toBe(true);
  });

  it('rejects empty session_id with 40001', async () => {
    const r = await bootDaemon();
    const res = await appOf(r).inject({
      method: 'GET',
      url: '/api/v1/tools?session_id=',
    });
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(40001);
  });
});

describe('GET /api/v1/mcp/servers', () => {
  it('returns an envelope with {servers: McpServer[]} (typically empty in sandboxed home)', async () => {
    const r = await bootDaemon();
    await createSession(r);
    const res = await appOf(r).inject({ method: 'GET', url: '/api/v1/mcp/servers' });
    expect(res.statusCode).toBe(200);
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(0);
    const parsed = listMcpServersResponseSchema.parse(env.data);
    expect(Array.isArray(parsed.servers)).toBe(true);
  });

  it('returns 200 with empty list even before any session is created', async () => {
    const r = await bootDaemon();
    const res = await appOf(r).inject({ method: 'GET', url: '/api/v1/mcp/servers' });
    expect(res.statusCode).toBe(200);
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(0);
    const parsed = listMcpServersResponseSchema.parse(env.data);
    expect(parsed.servers).toEqual([]);
  });
});

describe('MCP server mutations', () => {
  it('creates a user-global server entry', async () => {
    const r = await bootDaemon();
    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      payload: {
        mcp_server_id: 'local_server',
        config: { command: 'node', args: ['server.mjs'] },
      },
    });
    const env = envelopeOf<{ created: true }>(res.json());
    expect(env.code).toBe(0);
    expect(env.data).toEqual({ created: true });
    expect(JSON.parse(readFileSync(join(bridgeHome, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: {
        local_server: { transport: 'stdio', command: 'node', args: ['server.mjs'] },
      },
    });
  });

  it('rejects a duplicate user-global server id with validation.failed', async () => {
    writeFileSync(
      join(bridgeHome, 'mcp.json'),
      JSON.stringify({ mcpServers: { existing: { command: 'old' } } }),
      'utf8',
    );
    const r = await bootDaemon();
    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      payload: { mcp_server_id: 'existing', config: { command: 'new' } },
    });
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(40001);
    expect(env.msg).toContain('already exists');
  });

  it('replaces one user-global server and preserves its sibling', async () => {
    writeFileSync(
      join(bridgeHome, 'mcp.json'),
      JSON.stringify({
        metadata: { keep: true },
        mcpServers: { sibling: { command: 'sibling' }, target: { command: 'old' } },
      }),
      'utf8',
    );
    const r = await bootDaemon();
    const res = await appOf(r).inject({
      method: 'PUT',
      url: '/api/v1/mcp/servers/target',
      payload: { config: { command: 'new', args: ['--updated'] } },
    });
    const env = envelopeOf<{ updated: true }>(res.json());
    expect(env.code).toBe(0);
    expect(JSON.parse(readFileSync(join(bridgeHome, 'mcp.json'), 'utf8'))).toEqual({
      metadata: { keep: true },
      mcpServers: {
        sibling: { command: 'sibling' },
        target: { transport: 'stdio', command: 'new', args: ['--updated'] },
      },
    });
  });

  it('deletes a user-global server and returns 40408 for a missing id', async () => {
    const r = await bootDaemon();
    const missing = await appOf(r).inject({
      method: 'DELETE',
      url: '/api/v1/mcp/servers/missing',
    });
    expect(envelopeOf<unknown>(missing.json()).code).toBe(40408);

    const create = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      payload: { mcp_server_id: 'remove_me', config: { command: 'node' } },
    });
    expect(envelopeOf<unknown>(create.json()).code).toBe(0);
    const removed = await appOf(r).inject({
      method: 'DELETE',
      url: '/api/v1/mcp/servers/remove_me',
    });
    expect(envelopeOf<{ deleted: true }>(removed.json()).data).toEqual({ deleted: true });
  });

  it('returns the daemon validation message for a malformed definition', async () => {
    const r = await bootDaemon();
    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      payload: { mcp_server_id: 'bad', config: { url: 'not a url' } },
    });
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(40001);
    expect(env.msg).toContain('url');
  });
});

describe('MCP mutation route handlers', () => {
  it('maps create, update, and delete to the service and envelopes errors', async () => {
    type Handler = (
      req: { id: string; body: unknown; params: unknown },
      reply: { send(payload: unknown): unknown },
    ) => Promise<void> | void;
    const handlers = new Map<string, Handler>();
    const register = (method: string) => (
      path: string,
      _options: unknown,
      handler: Handler,
    ): void => {
      handlers.set(`${method} ${path}`, handler);
    };
    const app = {
      get: register('GET'),
      post: register('POST'),
      put: register('PUT'),
      delete: register('DELETE'),
    } as unknown as Parameters<typeof registerToolsRoutes>[0];
    const service = {
      _serviceBrand: undefined,
      list: vi.fn(async () => []),
      restart: vi.fn(async () => ({ restarting: true as const })),
      create: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const ix = {
      invokeFunction: (fn: (accessor: { get: () => IMcpService }) => unknown) =>
        fn({ get: () => service as unknown as IMcpService }),
    } as unknown as IInstantiationService;
    registerToolsRoutes(app, ix);

    async function invoke(
      method: string,
      path: string,
      request: { body?: unknown; params?: unknown },
    ): Promise<Record<string, unknown>> {
      const handler = handlers.get(`${method} ${path}`);
      if (handler === undefined) throw new Error(`${method} ${path} was not registered`);
      let payload: unknown;
      await handler(
        { id: 'request_1', body: request.body, params: request.params },
        { send: (value) => { payload = value; return value; } },
      );
      return payload as Record<string, unknown>;
    }

    expect(await invoke('POST', '/mcp/servers', {
      body: { mcp_server_id: 'local', config: { command: 'node', startup_timeout_ms: 100 } },
    })).toMatchObject({ code: 0, data: { created: true } });
    expect(service.create).toHaveBeenCalledWith('local', { command: 'node', startupTimeoutMs: 100 });

    expect(await invoke('PUT', '/mcp/servers/:mcp_server_id', {
      params: { mcp_server_id: 'local' },
      body: { config: { url: 'https://example.test/mcp' } },
    })).toMatchObject({ code: 0, data: { updated: true } });
    expect(service.update).toHaveBeenCalledWith('local', { url: 'https://example.test/mcp' });

    service.remove.mockRejectedValueOnce(new McpServerNotFoundError('missing'));
    expect(await invoke('DELETE', '/mcp/servers/:mcp_server_id', {
      params: { mcp_server_id: 'missing' },
    })).toMatchObject({ code: 40408, msg: 'mcp server missing does not exist' });

    service.create.mockRejectedValueOnce(new McpServerAlreadyExistsError('local'));
    expect(await invoke('POST', '/mcp/servers', {
      body: { mcp_server_id: 'local', config: { command: 'node' } },
    })).toMatchObject({ code: 40001, msg: 'mcp server local already exists' });

    service.create.mockRejectedValueOnce(new McpServerValidationError('url: Invalid URL'));
    expect(await invoke('POST', '/mcp/servers', {
      body: { mcp_server_id: 'bad', config: { url: 'not a url' } },
    })).toMatchObject({ code: 40001, msg: 'url: Invalid URL' });
  });
});

describe('POST /api/v1/mcp/servers/{id}:restart', () => {
  it('returns 40408 mcp.server_not_found for an unknown server id', async () => {
    const r = await bootDaemon();
    await createSession(r);
    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/mcp/servers/does-not-exist:restart',
      payload: {},
    });
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(40408);
    expect(env.msg).toMatch(/does not exist/);
  });

  it('returns 40408 even before any session is created (registrar unreachable)', async () => {
    const r = await bootDaemon();
    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/mcp/servers/x:restart',
      payload: {},
    });
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(40408);
  });

  it('rejects unsupported action with 40001', async () => {
    const r = await bootDaemon();
    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/mcp/servers/foo:bogus',
      payload: {},
    });
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(40001);
    expect(env.msg).toMatch(/unsupported action/);
  });

  it('rejects bare {id} (no action) with 40001 — :restart is the only allowed action', async () => {
    const r = await bootDaemon();
    const res = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/mcp/servers/foo',
      payload: {},
    });
    const env = envelopeOf<unknown>(res.json());
    expect(env.code).toBe(40001);
  });
});
