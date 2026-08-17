import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CodexLoginNotFoundError, ICodexLoginService } from '@pymodel/agent-core';
import type { CodexLoginStart, CodexLoginStatus } from '@pymodel/protocol';

import { IRestGateway, startServer, type RunningServer, type ServerStartOptions } from '../src';

let tmpDir: string;
let lockPath: string;
let bridgeHome: string;
let server: RunningServer | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pythinker-server-codex-login-test-'));
  lockPath = join(tmpDir, 'lock');
  bridgeHome = mkdtempSync(join(tmpdir(), 'pythinker-server-codex-login-home-'));
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

async function bootDaemon(
  serviceOverrides?: ServerStartOptions['serviceOverrides'],
): Promise<RunningServer> {
  server = await startServer({
    host: '127.0.0.1',
    port: 0,
    lockPath,
    logger: pino({ level: 'silent' }),
    coreProcessOptions: { homeDir: bridgeHome },
    serviceOverrides,
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

function envelopeOf<T>(body: unknown): { code: number; data: T | null } {
  return body as { code: number; data: T | null };
}

/** Stands in for the OAuth round trip; no browser, no network. */
function fakeLoginService(): { service: ICodexLoginService; submitted: string[] } {
  const submitted: string[] = [];
  const start: CodexLoginStart = {
    login_id: 'login-1',
    authorize_url: 'https://auth.openai.com/oauth/authorize?client_id=app_test&state=s',
    loopback: true,
    expires_at: new Date(1_700_000_000_000).toISOString(),
  };
  let state: CodexLoginStatus = { login_id: 'login-1', state: 'pending' };
  const service: ICodexLoginService = {
    _serviceBrand: undefined,
    start: async () => start,
    status: (loginId: string) => {
      if (loginId !== 'login-1') throw new CodexLoginNotFoundError(loginId);
      return state;
    },
    submitCode: async (loginId: string, redirectUrl: string) => {
      if (loginId !== 'login-1') throw new CodexLoginNotFoundError(loginId);
      submitted.push(redirectUrl);
      state = { login_id: 'login-1', state: 'completed', default_model: 'openai-codex/gpt-5-codex' };
      return state;
    },
    cancel: (loginId: string) => {
      if (loginId !== 'login-1') throw new CodexLoginNotFoundError(loginId);
      state = { login_id: 'login-1', state: 'cancelled' };
      return state;
    },
  };
  return { service, submitted };
}

describe('codex login routes', () => {
  it('starts a login and hands back the authorize URL', async () => {
    const { service } = fakeLoginService();
    const r = await bootDaemon([[ICodexLoginService, service]]);

    const res = await appOf(r).inject({ method: 'POST', url: '/api/v1/auth/codex:start' });
    expect(res.statusCode).toBe(200);
    const env = envelopeOf<CodexLoginStart>(res.json());
    expect(env.code).toBe(0);
    expect(env.data?.authorize_url).toContain('auth.openai.com');
    expect(env.data?.loopback).toBe(true);
    // The reply must never carry a token or the PKCE verifier.
    expect(JSON.stringify(env.data)).not.toContain('verifier');
  });

  it('reports the state and completes from a pasted redirect URL', async () => {
    const { service, submitted } = fakeLoginService();
    const r = await bootDaemon([[ICodexLoginService, service]]);

    const pending = await appOf(r).inject({ method: 'GET', url: '/api/v1/auth/codex/login-1' });
    expect(envelopeOf<CodexLoginStatus>(pending.json()).data?.state).toBe('pending');

    const done = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/auth/codex/login-1:submit_code',
      payload: { redirect_url: 'http://localhost:1455/auth/callback?code=abc&state=s' },
    });
    const doneEnv = envelopeOf<CodexLoginStatus>(done.json());
    expect(doneEnv.code).toBe(0);
    expect(doneEnv.data?.state).toBe('completed');
    expect(doneEnv.data?.default_model).toBe('openai-codex/gpt-5-codex');
    expect(submitted).toEqual(['http://localhost:1455/auth/callback?code=abc&state=s']);
  });

  it('rejects a submit with no redirect URL and an unknown login id', async () => {
    const { service } = fakeLoginService();
    const r = await bootDaemon([[ICodexLoginService, service]]);

    const empty = await appOf(r).inject({
      method: 'POST',
      url: '/api/v1/auth/codex/login-1:submit_code',
      payload: {},
    });
    expect(envelopeOf<unknown>(empty.json()).code).toBe(40001);

    const missing = await appOf(r).inject({ method: 'GET', url: '/api/v1/auth/codex/nope' });
    expect(envelopeOf<unknown>(missing.json()).code).toBe(40416);
  });
});
