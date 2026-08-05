import { homedir } from 'node:os';
import { join } from 'node:path';

import { PYTHINKER_CODE_FLOW_CONFIG } from './constants';
import { OAuthUnauthorizedError } from './errors';
import { assertPythinkerHostIdentity, createPythinkerDeviceHeaders, type PythinkerHostIdentity } from './identity';
import {
  fetchSubmitFeedback,
  pythinkerCodeFeedbackUrl,
  type FetchSubmitFeedbackResult,
  type SubmitFeedbackBody,
} from './managed-feedback';
import {
  PYTHINKER_CODE_OAUTH_KEY,
  PYTHINKER_CODE_PROVIDER_NAME,
  provisionManagedPythinkerCodeConfig,
  resolvePythinkerCodeOAuthKey,
  type ManagedPythinkerCodeProvisionResult,
  type ManagedPythinkerConfigAdapter,
} from './managed-pythinker-code';
import {
  fetchManagedUsage,
  pythinkerCodeUsageUrl,
  type FetchManagedUsageError,
  type ParsedManagedUsage,
} from './managed-usage';
import { OAuthManager, type LoginOptions, type OAuthManagerOptions } from './oauth-manager';
import { FileTokenStorage, type TokenStorage } from './storage';
import type { OAuthFlowConfig } from './types';

export interface BearerTokenProvider {
  getAccessToken(options?: { readonly force?: boolean | undefined }): Promise<string>;
}

export interface AuthProviderStatus {
  readonly providerName: string;
  readonly hasToken: boolean;
}

export interface AuthStatus {
  readonly providers: readonly AuthProviderStatus[];
}

export interface PythinkerOAuthToolkitOptions<TConfig = unknown> {
  readonly identity?: PythinkerHostIdentity | undefined;
  readonly homeDir?: string | undefined;
  readonly credentialsDir?: string | undefined;
  readonly storage?: TokenStorage | undefined;
  readonly flowConfig?: OAuthFlowConfig | undefined;
  readonly configAdapter?: ManagedPythinkerConfigAdapter<TConfig> | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly now?: OAuthManagerOptions['now'];
  readonly sleep?: OAuthManagerOptions['sleep'];
  readonly deviceCodeTimeoutMs?: number | undefined;
  readonly refreshThreshold?: OAuthManagerOptions['refreshThreshold'];
  readonly onRefresh?: OAuthManagerOptions['onRefresh'];
}

export interface PythinkerOAuthLoginOptions extends LoginOptions {
  readonly provisionConfig?: boolean | undefined;
  readonly baseUrl?: string | undefined;
  readonly oauthRef?: PythinkerOAuthTokenRef | undefined;
  readonly oauthHost?: string | undefined;
}

export interface PythinkerOAuthTokenRef {
  readonly key?: string | undefined;
  readonly oauthHost?: string | undefined;
}

export interface PythinkerOAuthLoginResult {
  readonly providerName: string;
  readonly ok: true;
  readonly provision?: ManagedPythinkerCodeProvisionResult | undefined;
}

export interface PythinkerOAuthLogoutResult {
  readonly providerName: string;
  readonly ok: true;
}

export type AuthManagedUsageResult =
  | {
      readonly kind: 'ok';
      readonly summary: ParsedManagedUsage['summary'];
      readonly limits: ParsedManagedUsage['limits'];
    }
  | FetchManagedUsageError;

export class PythinkerOAuthToolkit<TConfig = unknown> {
  private readonly homeDir: string;
  private readonly identity: PythinkerHostIdentity | undefined;
  private readonly storage: TokenStorage;
  private readonly flowConfig: OAuthFlowConfig;
  private readonly configAdapter: ManagedPythinkerConfigAdapter<TConfig> | undefined;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly managerOptions: Pick<
    OAuthManagerOptions,
    'now' | 'sleep' | 'deviceCodeTimeoutMs' | 'refreshThreshold' | 'onRefresh'
  >;
  private readonly managers = new Map<string, OAuthManager>();

  constructor(options: PythinkerOAuthToolkitOptions<TConfig>) {
    this.identity =
      options.identity === undefined ? undefined : assertPythinkerHostIdentity(options.identity);
    this.homeDir = options.homeDir ?? defaultPythinkerHome();
    const credentialsDir = options.credentialsDir ?? join(this.homeDir, 'credentials');
    this.storage = options.storage ?? new FileTokenStorage(credentialsDir);
    this.flowConfig = options.flowConfig ?? PYTHINKER_CODE_FLOW_CONFIG;
    this.configAdapter = options.configAdapter;
    this.fetchImpl = options.fetchImpl;
    this.managerOptions = {
      now: options.now,
      sleep: options.sleep,
      deviceCodeTimeoutMs: options.deviceCodeTimeoutMs,
      refreshThreshold: options.refreshThreshold,
      onRefresh: options.onRefresh,
    };
  }

  async status(
    providerName?: string | undefined,
    oauthRef?: PythinkerOAuthTokenRef | undefined,
  ): Promise<AuthStatus> {
    const name = providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
    const oauthHost = this.oauthHostFor(oauthRef);
    const oauthKey = oauthRef?.key ?? this.defaultOAuthKey(undefined, oauthHost);
    return {
      providers: [
        {
          providerName: name,
          hasToken: await this.managerFor(name, oauthKey, oauthHost).hasToken(),
        },
      ],
    };
  }

  async login(
    providerName?: string | undefined,
    options: PythinkerOAuthLoginOptions = {},
  ): Promise<PythinkerOAuthLoginResult> {
    const name = providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
    const oauthHost = this.oauthHostFor(options.oauthRef, options.oauthHost);
    const oauthKey = options.oauthRef?.key ?? this.defaultOAuthKey(options.baseUrl, oauthHost);
    const manager = this.managerFor(name, oauthKey, oauthHost);
    const hadToken = await manager.hasToken();
    let usedDeviceLogin = false;
    const loginWithDevice = async (): Promise<string> => {
      usedDeviceLogin = true;
      return (
        await manager.login({
          signal: options.signal,
          onDeviceCode: options.onDeviceCode,
        })
      ).accessToken;
    };
    let accessToken: string;
    if (hadToken) {
      try {
        accessToken = await manager.ensureFresh();
      } catch (error) {
        if (!(error instanceof OAuthUnauthorizedError)) throw error;
        accessToken = await loginWithDevice();
      }
    } else {
      accessToken = await loginWithDevice();
    }

    const shouldProvision = options.provisionConfig ?? this.configAdapter !== undefined;
    const configAdapter = this.configAdapter;
    let provision: ManagedPythinkerCodeProvisionResult | undefined;
    if (shouldProvision && configAdapter !== undefined) {
      const provisionWithToken = (token: string): Promise<ManagedPythinkerCodeProvisionResult> =>
        provisionManagedPythinkerCodeConfig({
          accessToken: token,
          adapter: configAdapter,
          baseUrl: options.baseUrl,
          oauthKey,
          oauthHost,
          preserveDefaultModel: true,
          fetchImpl: this.fetchImpl,
        });
      try {
        provision = await provisionWithToken(accessToken);
      } catch (error) {
        if (!(error instanceof OAuthUnauthorizedError) || !hadToken || usedDeviceLogin) {
          throw error;
        }
        let retryToken: string;
        try {
          retryToken = await manager.ensureFresh({ force: true });
        } catch (refreshError) {
          if (!(refreshError instanceof OAuthUnauthorizedError)) throw refreshError;
          retryToken = await loginWithDevice();
        }
        try {
          provision = await provisionWithToken(retryToken);
        } catch (retryError) {
          if (!(retryError instanceof OAuthUnauthorizedError) || usedDeviceLogin) {
            throw retryError;
          }
          provision = await provisionWithToken(await loginWithDevice());
        }
      }
    }

    return { providerName: name, ok: true, provision };
  }

  async logout(
    providerName?: string | undefined,
    oauthRef?: PythinkerOAuthTokenRef | undefined,
  ): Promise<PythinkerOAuthLogoutResult> {
    const name = providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
    const oauthHost = this.oauthHostFor(oauthRef);
    const oauthKey = oauthRef?.key ?? this.defaultOAuthKey(undefined, oauthHost);
    await this.managerFor(name, oauthKey, oauthHost).logout();
    if (this.configAdapter?.remove !== undefined && name === PYTHINKER_CODE_PROVIDER_NAME) {
      const config = await this.configAdapter.read();
      this.configAdapter.remove(config);
      await this.configAdapter.write(config);
    }
    return { providerName: name, ok: true };
  }

  async ensureFresh(
    providerName?: string | undefined,
    options: {
      readonly force?: boolean | undefined;
      readonly oauthRef?: PythinkerOAuthTokenRef | undefined;
    } = {},
  ): Promise<string> {
    const name = providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
    const oauthHost = this.oauthHostFor(options.oauthRef);
    const oauthKey = options.oauthRef?.key ?? this.defaultOAuthKey(undefined, oauthHost);
    return this.managerFor(name, oauthKey, oauthHost).ensureFresh(options);
  }

  async getCachedAccessToken(
    providerName?: string,
    oauthRef?: PythinkerOAuthTokenRef,
  ): Promise<string | undefined> {
    const name = providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
    const oauthHost = this.oauthHostFor(oauthRef);
    const oauthKey = oauthRef?.key ?? this.defaultOAuthKey(undefined, oauthHost);
    return this.managerFor(name, oauthKey, oauthHost).getCachedAccessToken();
  }

  tokenProvider(
    providerName?: string | undefined,
    oauthRef?: PythinkerOAuthTokenRef | undefined,
  ): BearerTokenProvider {
    const name = providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
    const oauthHost = this.oauthHostFor(oauthRef);
    const oauthKey = oauthRef?.key ?? this.defaultOAuthKey(undefined, oauthHost);
    return {
      getAccessToken: (options) => this.managerFor(name, oauthKey, oauthHost).ensureFresh(options),
    };
  }

  async getManagedUsage(
    providerName?: string | undefined,
    options: {
      readonly oauthRef?: PythinkerOAuthTokenRef | undefined;
      readonly baseUrl?: string | undefined;
    } = {},
  ): Promise<AuthManagedUsageResult> {
    const name = providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
    try {
      const accessToken = await this.ensureFresh(name, {
        oauthRef: options.oauthRef ?? this.defaultOAuthRef(options.baseUrl),
      });
      const result = await fetchManagedUsage(managedUsageUrl(options.baseUrl), accessToken);
      if (result.kind === 'error') return result;
      return {
        kind: 'ok',
        summary: result.parsed.summary,
        limits: result.parsed.limits,
      };
    } catch (error) {
      return {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async submitFeedback(
    body: SubmitFeedbackBody,
    providerName?: string | undefined,
    options: {
      readonly oauthRef?: PythinkerOAuthTokenRef | undefined;
      readonly baseUrl?: string | undefined;
    } = {},
  ): Promise<FetchSubmitFeedbackResult> {
    const name = providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
    try {
      const accessToken = await this.ensureFresh(name, {
        oauthRef: options.oauthRef ?? this.defaultOAuthRef(options.baseUrl),
      });
      return await fetchSubmitFeedback(managedFeedbackUrl(options.baseUrl), accessToken, body);
    } catch (error) {
      return {
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  managerFor(
    providerName: string,
    oauthKey = PYTHINKER_CODE_OAUTH_KEY,
    oauthHost?: string | undefined,
  ): OAuthManager {
    const storageName = resolvePythinkerTokenStorageName({ providerName, oauthKey });
    const effectiveOAuthHost = oauthHost ?? this.flowConfig.oauthHost;
    const managerKey = `${storageName}\0${normalizeOAuthHost(effectiveOAuthHost)}`;
    let manager = this.managers.get(managerKey);
    if (manager !== undefined) return manager;

    const identity = this.identity;
    manager = new OAuthManager({
      config: {
        ...this.flowConfig,
        oauthHost: effectiveOAuthHost,
        name: storageName,
      },
      storage: this.storage,
      configDir: this.homeDir,
      deviceHeaders:
        identity === undefined
          ? undefined
          : () =>
              createPythinkerDeviceHeaders({
                homeDir: this.homeDir,
                version: identity.version,
              }),
      ...this.managerOptions,
    });
    this.managers.set(managerKey, manager);
    return manager;
  }

  private defaultOAuthKey(
    baseUrl?: string | undefined,
    oauthHost?: string | undefined,
  ): string {
    return resolvePythinkerCodeOAuthKey({
      oauthHost: oauthHost ?? this.flowConfig.oauthHost,
      baseUrl,
    });
  }

  private defaultOAuthRef(baseUrl?: string | undefined): PythinkerOAuthTokenRef {
    return {
      key: this.defaultOAuthKey(baseUrl, this.flowConfig.oauthHost),
      oauthHost: this.flowConfig.oauthHost,
    };
  }

  private oauthHostFor(
    oauthRef?: PythinkerOAuthTokenRef | undefined,
    oauthHost?: string | undefined,
  ): string {
    return oauthRef?.oauthHost ?? oauthHost ?? this.flowConfig.oauthHost;
  }
}

export function resolvePythinkerTokenStorageName(input: {
  readonly providerName?: string | undefined;
  readonly oauthKey?: string | undefined;
}): string {
  const providerName = input.providerName ?? PYTHINKER_CODE_PROVIDER_NAME;
  if (providerName !== PYTHINKER_CODE_PROVIDER_NAME) {
    throw new Error(`No OAuth manager configured for provider "${providerName}".`);
  }

  const key = input.oauthKey ?? PYTHINKER_CODE_OAUTH_KEY;
  if (key === 'pythinker-code' || key === PYTHINKER_CODE_OAUTH_KEY) return 'pythinker-code';

  const prefix = 'oauth/';
  if (key.startsWith(prefix) && key.slice(prefix.length).length > 0) {
    return key.slice(prefix.length);
  }

  if (!key.includes('/') && !key.startsWith('.')) return key;
  throw new Error(`Invalid Pythinker OAuth token key: "${key}".`);
}

function defaultPythinkerHome(): string {
  const override = process.env['PYTHINKER_CODE_HOME'];
  if (override !== undefined && override.length > 0) return override;
  return join(homedir(), '.pythinker-code');
}

function managedUsageUrl(baseUrl: string | undefined): string {
  if (baseUrl === undefined) return pythinkerCodeUsageUrl();
  return `${baseUrl.replace(/\/+$/, '')}/usages`;
}

function managedFeedbackUrl(baseUrl: string | undefined): string {
  if (baseUrl === undefined) return pythinkerCodeFeedbackUrl();
  return `${baseUrl.replace(/\/+$/, '')}/feedback`;
}

function normalizeOAuthHost(oauthHost: string): string {
  return oauthHost.trim().replace(/\/+$/, '');
}
