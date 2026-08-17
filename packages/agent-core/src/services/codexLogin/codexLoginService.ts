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
import { ILogService } from '../logger/logger';
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
  readonly fetchModels: (input: Readonly<{
    accessToken: string;
    accountId: string;
  }>) => Promise<PlatformModelInfo[]>;
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
  expiryTimer?: NodeJS.Timeout;
  completion?: Promise<void>;
  callbackCleaned?: boolean;
}

/**
 * The flow itself, free of the DI container so tests can hand it fakes.
 * `CodexLoginService` is the registered wrapper around it.
 */
export class CodexLoginFlow {
  private attempt: Attempt | undefined;
  private disposed = false;

  constructor(
    private readonly core: ICoreProcessService,
    private readonly deps: CodexLoginDeps = defaultDeps,
    private readonly logger?: Pick<ILogService, 'error'>,
  ) {}

  async start(): Promise<CodexLoginStart> {
    if (this.disposed) throw new Error('OpenAI Codex login flow is disposed.');
    this._discard('cancelled');

    const pkce = this.deps.createPkce();
    const callback = await this.deps.startCallbackServer(pkce.state);
    if (this.disposed) {
      callback.cancelWait();
      callback.close();
      throw new Error('OpenAI Codex login flow is disposed.');
    }
    if (this.attempt !== undefined) this._discard('cancelled');
    const expiresAtMs = this.deps.now() + LOGIN_TTL_MS;
    const attempt: Attempt = {
      id: randomUUID(),
      pkce,
      callback,
      expiresAtMs,
      state: 'pending',
    };
    this.attempt = attempt;
    attempt.expiryTimer = setTimeout(() => {
      this._expire(attempt);
    }, LOGIN_TTL_MS);
    attempt.expiryTimer.unref();

    if (callback.loopback) {
      // Fire and forget: the client learns the outcome by polling `status`.
      void callback
        .waitForCode({ timeoutMs: LOGIN_TTL_MS })
        .then((result) => {
          if (result === null) {
            if (attempt.state === 'pending' && attempt.completion === undefined) {
              this._expire(attempt);
            }
            return;
          }
          return this._complete(attempt, result.code);
        })
        .catch(() => {
          if (
            attempt.state === 'pending' &&
            attempt.completion === undefined &&
            this.deps.now() >= attempt.expiresAtMs
          ) {
            this._expire(attempt);
          }
        });
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
      this._expire(attempt);
    }
    return toStatus(attempt);
  }

  async submitCode(loginId: string, redirectUrl: string): Promise<CodexLoginStatus> {
    const attempt = this._require(loginId);
    if (attempt.state !== 'pending') {
      const completion = attempt.completion;
      if (completion !== undefined) await completion;
      return toStatus(attempt);
    }
    if (this.deps.now() >= attempt.expiresAtMs) {
      this._expire(attempt);
      return toStatus(attempt);
    }
    const completion = attempt.completion;
    if (completion !== undefined) {
      await completion;
      return toStatus(attempt);
    }

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
      this._cleanup(attempt);
    }
    return toStatus(attempt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this._discard('cancelled');
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
      this._cleanup(attempt);
    }
    this.attempt = undefined;
  }

  private _expire(attempt: Attempt): void {
    if (attempt.state !== 'pending') return;
    attempt.state = 'failed';
    attempt.message = 'OpenAI Codex login timed out. Start again.';
    this._cleanup(attempt);
  }

  private _cleanup(attempt: Attempt): void {
    if (attempt.expiryTimer !== undefined) {
      clearTimeout(attempt.expiryTimer);
      attempt.expiryTimer = undefined;
    }
    this._closeCallback(attempt);
  }

  private _closeCallback(attempt: Attempt): void {
    if (attempt.callbackCleaned === true) return;
    attempt.callback.cancelWait();
    attempt.callback.close();
    attempt.callbackCleaned = true;
  }

  private _isActive(attempt: Attempt): boolean {
    if (attempt.state !== 'pending') return false;
    if (this.deps.now() >= attempt.expiresAtMs) {
      this._expire(attempt);
      return false;
    }
    return true;
  }

  private _complete(attempt: Attempt, code: string): Promise<void> {
    const completion = attempt.completion;
    if (completion !== undefined) return completion;
    if (!this._isActive(attempt)) return Promise.resolve();

    const next = this._completeOnce(attempt, code);
    attempt.completion = next;
    return next;
  }

  private async _completeOnce(attempt: Attempt, code: string): Promise<void> {
    this._closeCallback(attempt);
    try {
      const tokens = await this.deps.exchangeCode(code, attempt.pkce.verifier);
      if (!this._isActive(attempt)) return;
      const models = await this.deps.fetchModels({
        accessToken: tokens.accessToken,
        accountId: tokens.accountId,
      });
      if (!this._isActive(attempt)) return;
      if (models.length === 0) {
        throw new Error('No models available for OpenAI Codex.');
      }
      const defaultModel = await this._writeConfig(attempt, tokens, models);
      if (defaultModel === undefined || !this._isActive(attempt)) return;
      attempt.state = 'completed';
      attempt.defaultModel = defaultModel;
      this._cleanup(attempt);
    } catch (error) {
      if (attempt.state !== 'pending') return;
      if (this.deps.now() >= attempt.expiresAtMs) {
        this._expire(attempt);
        return;
      }
      this.logger?.error({ err: error }, 'OpenAI Codex login failed');
      attempt.state = 'failed';
      attempt.message = 'OpenAI Codex login failed. Try again.';
      this._cleanup(attempt);
    }
  }

  private async _writeConfig(
    attempt: Attempt,
    tokens: Readonly<{ accessToken: string; refreshToken: string; accountId: string }>,
    models: readonly PlatformModelInfo[],
  ): Promise<string | undefined> {
    const config = await this.core.rpc.getPythinkerConfig({ reload: true });
    if (!this._isActive(attempt)) return undefined;

    // Bridge the core PythinkerConfig shape to the OAuth package PlatformConfigShape.
    const shape = {
      ...config,
      providers: { ...config.providers },
      models: config.models === undefined ? undefined : { ...config.models },
    } as unknown as PlatformConfigShape;
    shape.providers ??= {};
    const result = applyOpenAICodexOAuthConfig(shape, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accountId: tokens.accountId,
      models,
      selectedModel: pickDefaultModel(models),
      thinking: true,
    });

    if (!this._isActive(attempt)) return undefined;
    // All five fields travel together: the patch is a deep merge, and leaving
    // `thinking` out drops the effort that `applyOpenAICodexOAuthConfig` just
    // picked.
    // Bridge the OAuth config patch back to the core RPC PythinkerConfigPatch shape.
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

  constructor(
    @ICoreProcessService core: ICoreProcessService,
    @ILogService logger: ILogService,
  ) {
    super();
    this.flow = this._register(new CodexLoginFlow(core, defaultDeps, logger));
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
