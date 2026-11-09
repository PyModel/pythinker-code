import { afterEach, describe, expect, it, vi } from 'vitest';

import { DaemonPythinkerWebApi } from '../src/api/daemon/client';

function okEnvelope(data: unknown): Response {
  return new Response(
    JSON.stringify({ code: 0, msg: 'ok', data, request_id: 'req_1' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function api(): DaemonPythinkerWebApi {
  return new DaemonPythinkerWebApi({
    serverHttpUrl: 'http://example.test:58627',
    clientId: 'web_test',
    clientName: 'pythinker-code-web',
    clientVersion: '0.1.1',
    clientUiMode: 'web',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('codex login client', () => {
  it('starts a login and maps the wire fields', async () => {
    const fetchMock = vi.fn(async () =>
      okEnvelope({
        login_id: 'login_1',
        authorize_url: 'https://auth.openai.com/oauth/authorize?client_id=app_test&state=s',
        loopback: false,
        expires_at: '2026-08-17T00:10:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const started = await api().startCodexLogin();
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/api/v1/auth/codex:start');
    expect(init.method).toBe('POST');
    expect(started).toEqual({
      loginId: 'login_1',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?client_id=app_test&state=s',
      loopback: false,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
  });

  it('polls the status and reports the selected model', async () => {
    const fetchMock = vi.fn(async () =>
      okEnvelope({
        login_id: 'login_1',
        state: 'completed',
        default_model: 'openai-codex/gpt-5-codex',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await api().getCodexLoginStatus('login_1');
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/v1/auth/codex/login_1');
    expect(status).toEqual({
      loginId: 'login_1',
      state: 'completed',
      defaultModel: 'openai-codex/gpt-5-codex',
      message: undefined,
    });
  });

  it('sends the pasted redirect URL under the action suffix', async () => {
    const fetchMock = vi.fn(async () =>
      okEnvelope({ login_id: 'login_1', state: 'completed', default_model: 'openai-codex/gpt-5' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await api().submitCodexLoginRedirect(
      'login_1',
      'http://localhost:1455/auth/callback?code=abc&state=s',
    );
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toContain('/api/v1/auth/codex/login_1:submit_code');
    expect(JSON.parse(init.body as string)).toEqual({
      redirect_url: 'http://localhost:1455/auth/callback?code=abc&state=s',
    });
  });

  it('cancels a login', async () => {
    const fetchMock = vi.fn(async () =>
      okEnvelope({ login_id: 'login_1', state: 'cancelled' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const status = await api().cancelCodexLogin('login_1');
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/v1/auth/codex/login_1:cancel');
    expect(status.state).toBe('cancelled');
  });
});
