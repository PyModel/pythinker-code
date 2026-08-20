import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CodexLoginNotFoundError,
  ICodexLoginService,
  type CodexLoginStart,
  type CodexLoginStatus,
} from '@pymodel/agent-core-v2';

import { startServer, type RunningServer } from '../src';
import { authHeaders } from './helpers/auth';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';

function fakeService(): ICodexLoginService {
  const start: CodexLoginStart = {
    login_id: 'login-1',
    authorize_url: 'https://auth.openai.com/oauth/authorize?state=state-1',
    loopback: true,
    expires_at: new Date(1_700_000_000_000).toISOString(),
  };
  let status: CodexLoginStatus = { login_id: 'login-1', state: 'pending' };
  const requireLogin = (loginId: string): void => {
    if (loginId !== start.login_id) throw new CodexLoginNotFoundError(loginId);
  };
  return {
    _serviceBrand: undefined,
    start: async () => start,
    status: (loginId) => {
      requireLogin(loginId);
      return status;
    },
    submitCode: async (loginId) => {
      requireLogin(loginId);
      status = {
        login_id: loginId,
        state: 'completed',
        default_model: 'openai-codex/gpt-5-codex',
      };
      return status;
    },
    cancel: (loginId) => {
      requireLogin(loginId);
      status = { login_id: loginId, state: 'cancelled' };
      return status;
    },
  };
}

describe('Codex login routes', () => {
  let server: RunningServer | undefined;
  let home: string | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
    home = undefined;
  });

  async function boot(): Promise<RunningServer> {
    home = mkdtempSync(join(tmpdir(), 'pythinker-codex-route-'));
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
      seeds: [[ICodexLoginService, fakeService()]],
    });
    return server;
  }

  it('matches the web start, poll, submit, and cancel contract', async () => {
    const running = await boot();
    const headers = authHeaders(running);

    const start = await running.app.inject({
      method: 'POST',
      url: '/api/v1/auth/codex:start',
      headers,
    });
    expect(start.json()).toMatchObject({
      code: 0,
      data: { login_id: 'login-1', loopback: true },
    });
    expect(JSON.stringify(start.json())).not.toContain('token');

    const pending = await running.app.inject({
      method: 'GET',
      url: '/api/v1/auth/codex/login-1',
      headers,
    });
    expect(pending.json()).toMatchObject({ code: 0, data: { state: 'pending' } });

    const completed = await running.app.inject({
      method: 'POST',
      url: '/api/v1/auth/codex/login-1:submit_code',
      headers,
      payload: { redirect_url: 'http://localhost:1455/auth/callback?code=code-1' },
    });
    expect(completed.json()).toMatchObject({
      code: 0,
      data: { state: 'completed', default_model: 'openai-codex/gpt-5-codex' },
    });

    const cancelled = await running.app.inject({
      method: 'POST',
      url: '/api/v1/auth/codex/login-1:cancel',
      headers,
      payload: {},
    });
    expect(cancelled.json()).toMatchObject({ code: 0, data: { state: 'cancelled' } });
  });

  it('maps invalid input and unknown login ids to stable wire codes', async () => {
    const running = await boot();
    const headers = authHeaders(running);

    const invalid = await running.app.inject({
      method: 'POST',
      url: '/api/v1/auth/codex/login-1:submit_code',
      headers,
      payload: {},
    });
    expect(invalid.json()).toMatchObject({ code: 40001 });

    const oversized = await running.app.inject({
      method: 'POST',
      url: '/api/v1/auth/codex/login-1:submit_code',
      headers,
      payload: { redirect_url: 'x'.repeat(16_385) },
    });
    expect(oversized.json()).toMatchObject({ code: 40001 });

    const missing = await running.app.inject({
      method: 'GET',
      url: '/api/v1/auth/codex/missing',
      headers,
    });
    expect(missing.json()).toMatchObject({ code: 40421 });
  });
});
