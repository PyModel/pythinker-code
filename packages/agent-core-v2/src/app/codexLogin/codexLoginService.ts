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
  type OpenAICodexConfigShape,
  type OpenAICodexModelInfo,
  type OpenAICodexPkcePair,
  type OpenAICodexTokenBundle,
} from '@pymodel/pythinker-code-oauth';

import { Disposable } from '#/_base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { type ILogger, ILogService } from '#/_base/log/log';
import { IConfigService } from '#/app/config/config';
import {
  DEFAULT_MODEL_SECTION,
  MODELS_SECTION,
  PROVIDERS_SECTION,
  THINKING_SECTION,
} from '#/app/kosongConfig/configSection';
import { LifecycleScope } from '#/app/scopes';

import {
  CodexLoginInvalidCodeError,
  CodexLoginNotFoundError,
  ICodexLoginService,
} from './codexLogin';
import type {
  CodexLoginStart,
  CodexLoginState,
  CodexLoginStatus,
} from './codexLoginProtocol';

const LOGIN_TTL_MS = 10 * 60 * 1000;

export interface CodexLoginDeps {
  readonly createPkce: () => OpenAICodexPkcePair;
  readonly buildAuthorizeUrl: (pair: OpenAICodexPkcePair) => string;
  readonly startCallbackServer: (state: string) => Promise<OpenAICodexCallbackServer>;
  readonly exchangeCode: (code: string, verifier: string) => Promise<OpenAICodexTokenBundle>;
  readonly fetchModels: (input: Readonly<{
    accessToken: string;
    accountId: string;
  }>) => Promise<OpenAICodexModelInfo[]>;
  readonly now: () => number;
}

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
  committing?: boolean;
}

export class CodexLoginFlow {
  private attempt: Attempt | undefined;
  private disposed = false;

  constructor(
    private readonly config: IConfigService,
    private readonly deps: CodexLoginDeps = defaultDeps,
    private readonly log?: Pick<ILogger, 'error'>,
  ) {}

  async start(): Promise<CodexLoginStart> {
    if (this.disposed) throw new Error('OpenAI Codex login flow is disposed.');
    if (this.attempt?.committing === true && this.attempt.completion !== undefined) {
      await this.attempt.completion;
    }
    if (this.disposed) throw new Error('OpenAI Codex login flow is disposed.');
    this.discard('cancelled');

    const pkce = this.deps.createPkce();
    const callback = await this.deps.startCallbackServer(pkce.state);
    if (this.disposed) {
      callback.cancelWait();
      callback.close();
      throw new Error('OpenAI Codex login flow is disposed.');
    }
    if (this.attempt !== undefined) this.discard('cancelled');

    const expiresAtMs = this.deps.now() + LOGIN_TTL_MS;
    const attempt: Attempt = {
      id: randomUUID(),
      pkce,
      callback,
      expiresAtMs,
      state: 'pending',
    };
    this.attempt = attempt;
    attempt.expiryTimer = setTimeout(() => this.expire(attempt), LOGIN_TTL_MS);
    attempt.expiryTimer.unref();

    if (callback.loopback) {
      void callback
        .waitForCode({ timeoutMs: LOGIN_TTL_MS })
        .then((result) => {
          if (result === null) {
            if (
              attempt.state === 'pending' &&
              attempt.completion === undefined &&
              this.deps.now() >= attempt.expiresAtMs
            ) {
              this.expire(attempt);
            }
            return;
          }
          return this.complete(attempt, result.code);
        })
        .catch(() => {
          if (
            attempt.state === 'pending' &&
            attempt.completion === undefined &&
            this.deps.now() >= attempt.expiresAtMs
          ) {
            this.expire(attempt);
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
    const attempt = this.require(loginId);
    if (
      attempt.state === 'pending' &&
      attempt.committing !== true &&
      this.deps.now() >= attempt.expiresAtMs
    ) {
      this.expire(attempt);
    }
    return toStatus(attempt);
  }

  async submitCode(loginId: string, redirectUrl: string): Promise<CodexLoginStatus> {
    const attempt = this.require(loginId);
    if (attempt.state !== 'pending') {
      if (attempt.completion !== undefined) await attempt.completion;
      return toStatus(attempt);
    }
    if (this.deps.now() >= attempt.expiresAtMs) {
      this.expire(attempt);
      return toStatus(attempt);
    }
    if (attempt.completion !== undefined) {
      await attempt.completion;
      return toStatus(attempt);
    }

    const parsed = parseOpenAICodexAuthorizationInput(redirectUrl);
    if (parsed.state !== undefined && parsed.state !== attempt.pkce.state) {
      throw new CodexLoginInvalidCodeError(
        'The pasted URL belongs to a different login. Start again.',
      );
    }
    if (parsed.code === undefined || parsed.code.length === 0) {
      throw new CodexLoginInvalidCodeError(
        'The pasted URL carries no authorization code.',
      );
    }
    await this.complete(attempt, parsed.code);
    return toStatus(attempt);
  }

  cancel(loginId: string): CodexLoginStatus {
    const attempt = this.require(loginId);
    if (attempt.state === 'pending' && attempt.committing !== true) {
      attempt.state = 'cancelled';
      this.cleanup(attempt);
    }
    return toStatus(attempt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.discard('cancelled');
  }

  private require(loginId: string): Attempt {
    if (this.attempt === undefined || this.attempt.id !== loginId) {
      throw new CodexLoginNotFoundError(loginId);
    }
    return this.attempt;
  }

  private discard(state: CodexLoginState): void {
    if (this.attempt === undefined) return;
    if (this.attempt.state === 'pending' && this.attempt.committing !== true) {
      this.attempt.state = state;
      this.cleanup(this.attempt);
    }
    this.attempt = undefined;
  }

  private expire(attempt: Attempt): void {
    if (attempt.state !== 'pending' || attempt.committing === true) return;
    attempt.state = 'failed';
    attempt.message = 'OpenAI Codex login timed out. Start again.';
    this.cleanup(attempt);
  }

  private cleanup(attempt: Attempt): void {
    if (attempt.expiryTimer !== undefined) {
      clearTimeout(attempt.expiryTimer);
      attempt.expiryTimer = undefined;
    }
    this.closeCallback(attempt);
  }

  private closeCallback(attempt: Attempt): void {
    if (attempt.callbackCleaned === true) return;
    attempt.callback.cancelWait();
    attempt.callback.close();
    attempt.callbackCleaned = true;
  }

  private active(attempt: Attempt): boolean {
    if (attempt.state !== 'pending') return false;
    if (this.deps.now() >= attempt.expiresAtMs) {
      this.expire(attempt);
      return false;
    }
    return true;
  }

  private complete(attempt: Attempt, code: string): Promise<void> {
    if (attempt.completion !== undefined) return attempt.completion;
    if (!this.active(attempt)) return Promise.resolve();
    attempt.completion = this.completeOnce(attempt, code);
    return attempt.completion;
  }

  private async completeOnce(attempt: Attempt, code: string): Promise<void> {
    this.closeCallback(attempt);
    try {
      const tokens = await this.deps.exchangeCode(code, attempt.pkce.verifier);
      if (!this.active(attempt)) return;
      const models = await this.deps.fetchModels({
        accessToken: tokens.accessToken,
        accountId: tokens.accountId,
      });
      if (!this.active(attempt)) return;
      const selectedModel = pickDefaultModel(models);
      await this.config.reload();
      if (!this.active(attempt)) return;
      const config = this.readConfig();
      const result = applyOpenAICodexOAuthConfig(config, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accountId: tokens.accountId,
        models,
        selectedModel,
        thinking: true,
      });
      if (!this.active(attempt)) return;
      attempt.committing = true;
      await this.config.replaceSections({
        [PROVIDERS_SECTION]: config.providers,
        [MODELS_SECTION]: config.models,
        [DEFAULT_MODEL_SECTION]: config.defaultModel,
        [THINKING_SECTION]: config.thinking,
      });
      attempt.committing = false;
      attempt.state = 'completed';
      attempt.defaultModel = result.defaultModel;
      this.cleanup(attempt);
    } catch (error) {
      attempt.committing = false;
      if (attempt.state !== 'pending') return;
      if (this.deps.now() >= attempt.expiresAtMs) {
        this.expire(attempt);
        return;
      }
      this.log?.error('OpenAI Codex login failed', {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      attempt.state = 'failed';
      attempt.message = 'OpenAI Codex login failed. Try again.';
      this.cleanup(attempt);
    }
  }

  private readConfig(): OpenAICodexConfigShape {
    return {
      providers: structuredClone(this.config.get(PROVIDERS_SECTION)),
      models: structuredClone(this.config.get(MODELS_SECTION)),
      defaultModel: this.config.get(DEFAULT_MODEL_SECTION),
      thinking: structuredClone(this.config.get(THINKING_SECTION)),
    } as OpenAICodexConfigShape;
  }
}

export function pickDefaultModel(
  models: readonly OpenAICodexModelInfo[],
): OpenAICodexModelInfo {
  const first = models[0];
  if (first === undefined) throw new Error('No models available for OpenAI Codex.');
  return models.find((model) => model.id.includes('codex')) ?? first;
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
  declare readonly _serviceBrand: undefined;

  private readonly flow: CodexLoginFlow;

  constructor(
    @IConfigService config: IConfigService,
    @ILogService log: ILogService,
  ) {
    super();
    this.flow = new CodexLoginFlow(config, defaultDeps, log);
    this._register({ dispose: () => this.flow.dispose() });
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

registerScopedService(
  LifecycleScope.App,
  ICodexLoginService,
  CodexLoginService,
  ScopeActivation.OnScopeCreated,
  'codexLogin',
);
