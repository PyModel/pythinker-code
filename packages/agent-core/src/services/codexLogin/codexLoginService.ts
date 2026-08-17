/**
 * `CodexLoginService` — implementation of `ICodexLoginService`.
 *
 * Composes the primitives in `@pymodel/pythinker-code-oauth` rather than
 * calling `runOpenAICodexOAuthFlow`: that helper waits for the loopback
 * callback for its whole timeout before offering manual paste, which a polling
 * client cannot use. Here the loopback wait runs in the background and paste
 * stays open the entire time.
 */

import { randomUUID } from 'node:crypto';

import {
  applyOpenAICodexOAuthConfig,
  buildOpenAICodexAuthorizeUrl,
  createOpenAICodexPkcePair,
  exchangeOpenAICodexAuthorizationCode,
  fetchOpenAICodexModels,
  OPENAI_CODEX_PROVIDER_ID,
  parseOpenAICodexAuthorizationInput,
  startOpenAICodexCallbackServer,
  type OpenAICodexCallbackServer,
  type OpenAICodexPkcePair,
  type PlatformConfigShape,
  type PlatformModelInfo,
} from '@pymodel/pythinker-code-oauth';
import type { CodexLoginStart, CodexLoginState, CodexLoginStatus } from '@pymodel/protocol';

import { Disposable, InstantiationType, registerSingleton } from '../../di';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import {
  CodexLoginInvalidCodeError,
  CodexLoginNotFoundError,
  ICodexLoginService,
} from './codexLogin';

/**
 * How long an attempt stays usable. The browser round trip includes a sign-in
 * and possibly a device check, and the user may have to copy the redirect URL
 * by hand, so this is far longer than the CLI's 120s loopback wait.
 */
const LOGIN_TTL_MS = 10 * 60 * 1000;

/** Seams the tests replace; production uses the real OAuth calls. */
export interface CodexLoginDeps {
  readonly createPkce: () => OpenAICodexPkcePair;
  readonly buildAuthorizeUrl: (pair: OpenAICodexPkcePair) => string;
  readonly startCallbackServer: (state: string) => Promise<OpenAICodexCallbackServer>;
  readonly exchangeCode: (
    code: string,
    verifier: string,
  ) => Promise<{ accessToken: string; refreshToken: string; accountId: string }>;
  readonly fetchModels: (input: {
    accessToken: string;
    accountId: string;
  }) => Promise<PlatformModelInfo[]>;
  readonly now: () => number;
}

// Every entry is wrapped rather than referenced directly: the module is loaded
// through `services/index.ts` by tests that mock the OAuth package, and reading
// a binding those mocks do not define throws at import time.
const defaultDeps: CodexLoginDeps = {
  createPkce: () => createOpenAICodexPkcePair(),
  buildAuthorizeUrl: (pair) => buildOpenAICodexAuthorizeUrl(pair),
  startCallbackServer: (state) => startOpenAICodexCallbackServer(state),
  exchangeCode: (code, verifier) => exchangeOpenAICodexAuthorizationCode(code, verifier),
  fetchModels: (input) => fetchOpenAICodexModels(input),
  now: () => Date.now(),
};

interface Attempt {
  readonly id: string;
  readonly pkce: OpenAICodexPkcePair;
  readonly callback: OpenAICodexCallbackServer;
  readonly expiresAtMs: number;
  state: CodexLoginState;
  defaultModel?: string;
  message?: string;
}

/**
 * The flow itself, free of the DI container so tests can hand it fakes.
 * `CodexLoginService` is the registered wrapper around it.
 */
export class CodexLoginFlow {
  private attempt: Attempt | undefined;

  constructor(
    private readonly core: ICoreProcessService,
    private readonly deps: CodexLoginDeps = defaultDeps,
  ) {}

  async start(): Promise<CodexLoginStart> {
    this._discard('cancelled');

    const pkce = this.deps.createPkce();
    const callback = await this.deps.startCallbackServer(pkce.state);
    const expiresAtMs = this.deps.now() + LOGIN_TTL_MS;
    const attempt: Attempt = {
      id: randomUUID(),
      pkce,
      callback,
      expiresAtMs,
      state: 'pending',
    };
    this.attempt = attempt;

    if (callback.loopback) {
      // Fire and forget: the client learns the outcome by polling `status`.
      // A rejection here is the abort/timeout path, which leaves the attempt
      // pending so the user can still paste the redirect URL.
      void callback
        .waitForCode({ timeoutMs: LOGIN_TTL_MS })
        .then(async (result) => {
          if (result === null) return;
          await this._complete(attempt, result.code);
        })
        .catch(() => undefined);
    }

    return {
      login_id: attempt.id,
      authorize_url: this.deps.buildAuthorizeUrl(pkce),
      loopback: callback.loopback,
      expires_at: new Date(expiresAtMs).toISOString(),
    };
  }

  status(loginId: string): CodexLoginStatus {
    const attempt = this._require(loginId);
    if (attempt.state === 'pending' && this.deps.now() >= attempt.expiresAtMs) {
      attempt.state = 'failed';
      attempt.message = 'OpenAI Codex login timed out. Start again.';
      attempt.callback.close();
    }
    return toStatus(attempt);
  }

  async submitCode(loginId: string, redirectUrl: string): Promise<CodexLoginStatus> {
    const attempt = this._require(loginId);
    const parsed = parseOpenAICodexAuthorizationInput(redirectUrl);
    if (parsed.state !== undefined && parsed.state !== attempt.pkce.state) {
      throw new CodexLoginInvalidCodeError(
        'The pasted URL belongs to a different login. Start again.',
      );
    }
    if (parsed.code === undefined || parsed.code.length === 0) {
      throw new CodexLoginInvalidCodeError('The pasted URL carries no authorization code.');
    }
    await this._complete(attempt, parsed.code);
    return toStatus(attempt);
  }

  cancel(loginId: string): CodexLoginStatus {
    const attempt = this._require(loginId);
    if (attempt.state === 'pending') {
      attempt.state = 'cancelled';
      attempt.callback.close();
    }
    return toStatus(attempt);
  }

  private _require(loginId: string): Attempt {
    const attempt = this.attempt;
    if (attempt === undefined || attempt.id !== loginId) {
      throw new CodexLoginNotFoundError(loginId);
    }
    return attempt;
  }

  /** Release a superseded attempt so it stops holding the callback port. */
  private _discard(state: CodexLoginState): void {
    const attempt = this.attempt;
    if (attempt === undefined) return;
    if (attempt.state === 'pending') {
      attempt.state = state;
      attempt.callback.close();
    }
    this.attempt = undefined;
  }

  private async _complete(attempt: Attempt, code: string): Promise<void> {
    if (attempt.state !== 'pending') return;
    attempt.callback.close();
    try {
      const tokens = await this.deps.exchangeCode(code, attempt.pkce.verifier);
      const models = await this.deps.fetchModels({
        accessToken: tokens.accessToken,
        accountId: tokens.accountId,
      });
      if (models.length === 0) {
        throw new Error('No models available for OpenAI Codex.');
      }
      const defaultModel = await this._writeConfig(tokens, models);
      attempt.state = 'completed';
      attempt.defaultModel = defaultModel;
    } catch (error) {
      attempt.state = 'failed';
      attempt.message = error instanceof Error ? error.message : String(error);
    }
  }

  private async _writeConfig(
    tokens: { accessToken: string; refreshToken: string; accountId: string },
    models: readonly PlatformModelInfo[],
  ): Promise<string> {
    // `setPythinkerConfig` merges, so a re-login would keep model aliases the
    // account no longer offers. Drop the provider first, exactly as the CLI
    // login does, then write the fresh set.
    const existing = await this.core.rpc.getPythinkerConfig({ reload: true });
    if (existing.providers?.[OPENAI_CODEX_PROVIDER_ID] !== undefined) {
      await this.core.rpc.removePythinkerProvider({ providerId: OPENAI_CODEX_PROVIDER_ID });
    }

    const config = await this.core.rpc.getPythinkerConfig({ reload: true });
    const shape = config as unknown as PlatformConfigShape;
    if (shape.providers === undefined) shape.providers = {};
    const result = applyOpenAICodexOAuthConfig(shape, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountId: tokens.accountId,
      models,
      selectedModel: pickDefaultModel(models),
      thinking: true,
    });

    // All five fields travel together: the patch is a deep merge, and leaving
    // `thinking` out drops the effort that `applyOpenAICodexOAuthConfig` just
    // picked.
    await this.core.rpc.setPythinkerConfig({
      providers: shape.providers,
      models: shape.models,
      defaultModel: shape.defaultModel,
      defaultThinking: shape.defaultThinking,
      thinking: shape.thinking,
    } as Parameters<typeof this.core.rpc.setPythinkerConfig>[0]);

    return result.defaultModel;
  }
}

/**
 * The CLI asks the user which model to use. The web login skips that question
 * and takes the account's Codex model, so the user lands in a working session;
 * the model picker changes it afterwards.
 */
export function pickDefaultModel(
  models: readonly PlatformModelInfo[],
): PlatformModelInfo {
  const codex = models.find((model) => model.id.includes('codex'));
  const first = models[0];
  if (first === undefined) {
    throw new Error('No models available for OpenAI Codex.');
  }
  return codex ?? first;
}

function toStatus(attempt: Attempt): CodexLoginStatus {
  return {
    login_id: attempt.id,
    state: attempt.state,
    default_model: attempt.defaultModel,
    message: attempt.message,
  };
}

export class CodexLoginService extends Disposable implements ICodexLoginService {
  readonly _serviceBrand: undefined;

  private readonly flow: CodexLoginFlow;

  constructor(@ICoreProcessService core: ICoreProcessService) {
    super();
    this.flow = new CodexLoginFlow(core);
  }

  start(): Promise<CodexLoginStart> {
    return this.flow.start();
  }

  status(loginId: string): CodexLoginStatus {
    return this.flow.status(loginId);
  }

  submitCode(loginId: string, redirectUrl: string): Promise<CodexLoginStatus> {
    return this.flow.submitCode(loginId, redirectUrl);
  }

  cancel(loginId: string): CodexLoginStatus {
    return this.flow.cancel(loginId);
  }
}

registerSingleton(ICodexLoginService, CodexLoginService, InstantiationType.Delayed);
