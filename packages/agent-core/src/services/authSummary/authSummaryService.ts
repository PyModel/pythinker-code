/**
 * `AuthSummaryService` — implementation of `IAuthSummaryService`.
 */

import { Disposable, InstantiationType, registerSingleton } from '../../di';
import { resolveProviderApiKey, type PythinkerConfig } from '../../config';
import type { AuthSummary } from '@pythoughts/protocol';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import {
  IAuthSummaryService,
  AuthProvisioningRequiredError,
  AuthTokenMissingError,
  AuthModelNotResolvedError,
} from './authSummary';

export class AuthSummaryService extends Disposable implements IAuthSummaryService {
  readonly _serviceBrand: undefined;

  constructor(@ICoreProcessService private readonly core: ICoreProcessService) {
    super();
  }

  async get(): Promise<AuthSummary> {
    const config = await this._readConfig();
    const providers = config.providers ?? {};
    const providers_count = Object.keys(providers).length;
    const default_model = nonEmpty(config.defaultModel);

    let ready = providers_count >= 1 && default_model !== null;

    if (ready && default_model !== null) {
      const alias = config.models?.[default_model];
      const providerName = alias?.provider ?? config.defaultProvider;
      const provider = providerName === undefined ? undefined : providers[providerName];
      if (provider?.apiKeyEnvVar !== undefined && resolveProviderApiKey(provider) === undefined) {
        ready = false;
      }
    }

    return { ready, providers_count, default_model };
  }

  async ensureReady(modelOverride?: string): Promise<void> {
    const config = await this._readConfig();
    const providers = config.providers ?? {};
    if (Object.keys(providers).length === 0) {
      throw new AuthProvisioningRequiredError();
    }

    const modelId = modelOverride ?? config.defaultModel;
    if (modelId === undefined || modelId === '') {
      throw new AuthModelNotResolvedError(undefined);
    }

    const alias = config.models?.[modelId];
    if (alias === undefined) {
      throw new AuthModelNotResolvedError(modelId);
    }

    const providerName = alias.provider ?? config.defaultProvider;
    if (providerName === undefined || providerName === '') {
      throw new AuthModelNotResolvedError(modelId);
    }

    const providerConfig = providers[providerName];
    if (providerConfig === undefined) {
      throw new AuthModelNotResolvedError(modelId, providerName);
    }

    if (resolveProviderApiKey(providerConfig) !== undefined) return;

    throw new AuthTokenMissingError(providerName);
  }

  override dispose(): void {
    if (this._store.isDisposed) return;
    super.dispose();
  }

  /* ----------------------------- internals ---------------------------- */

  private async _readConfig(): Promise<PythinkerConfig> {
    // `reload: true` forces PythinkerCore to re-read `config.toml` from disk
    // before returning. Critical for the auth probe path: a login writes to
    // disk via `writeConfigFile`, but PythinkerCore's `this.config` only
    // refreshes when something explicitly asks for `reload`. Without this
    // flag, `GET /v1/auth` would stay `ready:false` for the entire daemon
    // lifetime after first login.
    return this.core.rpc.getPythinkerConfig({ reload: true });
  }
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Self-register under the global singleton registry. All ctor deps are
// `@I…`-injected (@ICoreProcessService); `staticArguments = []`.
// `supportsDelayedInstantiation = false` preserves current reverse-dispose
// semantics.
registerSingleton(IAuthSummaryService, AuthSummaryService, InstantiationType.Delayed);
