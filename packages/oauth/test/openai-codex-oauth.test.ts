import { createHash } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { describe, expect, it, vi } from 'vitest';

import {
  applyOpenAICodexOAuthConfig,
  buildOpenAICodexAuthorizeUrl,
  createOpenAICodexPkcePair,
  extractOpenAICodexAccountId,
  fetchOpenAICodexModels,
  OPENAI_CODEX_AUTH_INPUT_MAX_LENGTH,
  parseOpenAICodexAuthorizationInput,
  startOpenAICodexCallbackServer,
  type OpenAICodexConfigShape,
} from '../src/openai-codex-oauth';
import { renderOpenAICodexOAuthSuccessPage } from '../src/oauth-pages';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

const CODEX_MODELS_RESPONSE = {
  models: [
    {
      slug: 'gpt-5.4-codex',
      display_name: 'GPT-5.4 Codex',
      context_window: 272_000,
      supported_in_api: true,
      visibility: 'list',
      supported_reasoning_levels: [
        { effort: 'low' },
        { effort: 'medium' },
        { effort: 'high' },
        { effort: 'xhigh' },
        { effort: 'max' },
        { effort: 'ultra' },
        { effort: 'none' },
      ],
      input_modalities: ['text', 'image'],
      supports_parallel_tool_calls: true,
      service_tiers: [
        { id: 'priority', name: 'Fast', description: '1.5x speed, increased usage' },
      ],
    },
    {
      slug: 'gpt-5.2-codex',
      display_name: 'GPT-5.2 Codex',
      context_window: 256_000,
      supported_in_api: true,
      visibility: 'list',
      supported_reasoning_levels: [
        { effort: 'low' },
        { effort: 'medium' },
        { effort: 'high' },
        { effort: 'xhigh' },
      ],
      input_modalities: ['text', 'image'],
      supports_parallel_tool_calls: true,
      service_tiers: [],
    },
  ],
} as const;

describe('openai-codex-oauth', () => {
  it('builds an authorize URL with Codex CLI OAuth parameters', () => {
    const pair = createOpenAICodexPkcePair();
    const url = new URL(buildOpenAICodexAuthorizeUrl(pair));
    expect(url.origin).toBe('https://auth.openai.com');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(pair.state);
    expect(url.searchParams.get('scope')).toBe(
      'openid profile email offline_access api.connectors.read api.connectors.invoke',
    );
    expect(url.searchParams.get('id_token_add_organizations')).toBe('true');
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
    expect(url.searchParams.get('originator')).toBe('codex_cli_rs');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
  });

  it('uses base64url state and PKCE challenge derived from the verifier', () => {
    const pair = createOpenAICodexPkcePair();
    const expectedChallenge = createHash('sha256').update(pair.verifier).digest('base64url');
    expect(pair.challenge).toBe(expectedChallenge);
    expect(pair.state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('parses authorization codes from redirect URLs', () => {
    expect(
      parseOpenAICodexAuthorizationInput(
        'http://localhost:1455/auth/callback?code=abc123&state=deadbeef',
      ),
    ).toEqual({ code: 'abc123', state: 'deadbeef' });
  });

  it('rejects oversized authorization input', () => {
    expect(() =>
      parseOpenAICodexAuthorizationInput(
        'x'.repeat(OPENAI_CODEX_AUTH_INPUT_MAX_LENGTH + 1),
      ),
    ).toThrow('authorization input is too long');
  });

  it('extracts chatgpt account id from access token claims', () => {
    const token = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' },
    });
    expect(extractOpenAICodexAccountId(token)).toBe('acct-123');
  });

  it('renders a branded Codex OAuth success page', () => {
    const html = renderOpenAICodexOAuthSuccessPage();
    expect(html).toContain('OpenAI Codex sign-in complete');
    expect(html).toContain('You can close this tab and return to Pythinker Code.');
    expect(html).toContain('Pythinker Code');
    expect(html).toContain('<svg');
  });

  it('fetches models from the Codex backend /models endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => CODEX_MODELS_RESPONSE,
      text: async () => '',
    }));
    const models = await fetchOpenAICodexModels({
      accessToken: 'access-token',
      accountId: 'acct-123',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(models).toHaveLength(2);
    expect(models[0]?.id).toBe('gpt-5.4-codex');
    // `ultra` is advertised by /models but rejected by /responses
    // ("Invalid value: 'ultra'. Supported values are: ..."), so offering it
    // would only ever produce a failed turn.
    expect(models[0]?.supportedReasoningEfforts).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(models[0]?.supportsFastMode).toBe(true);
    expect(models[1]?.supportsFastMode).toBe(false);
    expect(models[1]?.supportedReasoningEfforts).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/models?client_version=0.145.0',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer access-token',
          'chatgpt-account-id': 'acct-123',
          originator: 'codex_cli_rs',
        }),
      }),
    );
  });

  it('omits internal review models while keeping an entitled Spark model', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          {
            slug: 'codex-auto-review',
            display_name: 'GPT-5.6-Terra',
            context_window: 272_000,
            visibility: 'list',
          },
          {
            slug: 'internal-hidden-model',
            display_name: 'Internal hidden model',
            context_window: 272_000,
            visibility: 'hide',
          },
          {
            slug: 'gpt-5.3-codex-spark',
            display_name: 'GPT-5.3-Codex-Spark',
            context_window: 128_000,
            visibility: 'list',
            input_modalities: ['text'],
          },
        ],
      }),
      text: async () => '',
    }));

    const models = await fetchOpenAICodexModels({
      accessToken: 'access-token',
      accountId: 'acct-123',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(models).toEqual([
      expect.objectContaining({
        id: 'gpt-5.3-codex-spark',
        displayName: 'GPT-5.3-Codex-Spark',
        supportsImageIn: false,
      }),
    ]);
  });

  it('writes an openai_responses provider with models fetched from the API', () => {
    const accessToken = makeJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' },
    });
    const config = {
      providers: {},
    } as OpenAICodexConfigShape;
    const models = CODEX_MODELS_RESPONSE.models.map((model) => ({
      id: model.slug,
      contextLength: model.context_window,
      supportsReasoning: true,
      supportedReasoningEfforts: model.supported_reasoning_levels
        .map((level) => level.effort)
        .filter((effort) => effort !== 'none'),
      supportsImageIn: true,
      supportsVideoIn: false,
      supportsToolUse: true,
      supportsThinkingType: 'both' as const,
      supportsFastMode: model.service_tiers.some((tier) => tier.id === 'priority'),
      displayName: model.display_name,
    }));
    const result = applyOpenAICodexOAuthConfig(config, {
      accessToken,
      refreshToken: 'refresh-123',
      accountId: 'acct-123',
      models,
      selectedModel: models[0]!,
      thinking: true,
    });
    expect(result.defaultModel).toBe('openai-codex/gpt-5.4-codex');
    expect(config.providers['openai-codex']).toMatchObject({
      type: 'openai_responses',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      apiKey: accessToken,
      customHeaders: {
        'chatgpt-account-id': 'acct-123',
        originator: 'codex_cli_rs',
        'OpenAI-Beta': 'responses=experimental',
      },
    });
    expect(config.models?.['openai-codex/gpt-5.4-codex']).toMatchObject({
      provider: 'openai-codex',
      model: 'gpt-5.4-codex',
      supportEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      capabilities: expect.arrayContaining(['fast_mode']),
    });
    expect(config.models?.['openai-codex/gpt-5.2-codex']).toBeDefined();
    expect(config.thinking).toEqual({ enabled: true, effort: 'max' });
  });

  it('uses the selected model highest supported effort when max is unavailable', () => {
    const config: OpenAICodexConfigShape = {
      providers: {},
      thinking: { mode: 'auto', effort: 'low' },
    };
    const models = [
      {
        id: 'gpt-5.4-mini',
        contextLength: 128_000,
        supportsReasoning: true,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        supportsImageIn: true,
        supportsVideoIn: false,
      },
    ] as const;

    applyOpenAICodexOAuthConfig(config, {
      accessToken: 'access-token',
      accountId: 'acct-123',
      models,
      selectedModel: models[0],
    });

    expect(config.models?.['openai-codex/gpt-5.4-mini']).toMatchObject({
      supportEfforts: ['low', 'medium', 'high', 'xhigh'],
    });
    expect(config.thinking).toEqual({ mode: 'auto', enabled: true, effort: 'xhigh' });
  });
});

describe('startOpenAICodexCallbackServer', () => {
  /** Resolves true once nothing is listening on the callback port. */
  async function portFreedWithin(port: number, deadlineMs: number): Promise<boolean> {
    const started = Date.now();
    for (;;) {
      const free = await new Promise<boolean>((resolve) => {
        const probe = createNetServer();
        probe.once('error', () => {
          resolve(false);
        });
        probe.listen(port, '127.0.0.1', () => {
          probe.close(() => {
            resolve(true);
          });
        });
      });
      if (free) return true;
      if (Date.now() - started > deadlineMs) return false;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    }
  }

  it('tears the wait down when it is aborted before it starts', async () => {
    const server = await startOpenAICodexCallbackServer('state-abc');
    // Fake timers only count what is scheduled while they are installed, so
    // install them after the (real, I/O-bound) bind and before the wait.
    vi.useFakeTimers();
    try {
      // An already-aborted signal takes the early-return branch, which never
      // registers the completion handler every other exit relies on. Left to
      // it, both the two-minute timeout and the listening server outlive the
      // cancelled login and pin the host event loop.
      await expect(
        server.waitForCode({
          signal: AbortSignal.abort(new Error('login cancelled')),
          timeoutMs: 120_000,
        }),
      ).rejects.toThrow('login cancelled');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    // Probed before this test closes anything: the abort path has to release
    // the port on its own, the way every other exit from the wait does.
    const freed = await portFreedWithin(1455, 1_000);
    server.close();
    expect(freed).toBe(true);
  });
});
