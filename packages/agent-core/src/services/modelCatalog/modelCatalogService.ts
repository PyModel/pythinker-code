import { Disposable, InstantiationType, registerSingleton } from '../../di';
import {
  resolveProviderApiKey,
  type PythinkerConfig,
  type ModelAlias,
  type ProviderConfig,
} from '../../config';
import type {
  ModelCatalogItem,
  ProviderCatalogItem,
  RefreshOAuthProviderModelsResponse,
  SetDefaultModelResponse,
} from '@pythoughts/protocol';
import {
  PYTHINKER_CODE_PLATFORM_ID,
  PYTHINKER_CODE_PROVIDER_NAME,
  applyManagedPythinkerCodeConfig,
  fetchManagedPythinkerCodeModels,
  resolvePythinkerCodeRuntimeAuth,
  type ManagedPythinkerConfigShape,
} from '@pythoughts/pythinker-code-oauth';

import { createManagedAuthFacade, type ServicesAuthFacade } from '../auth/managedAuth';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IEnvironmentService } from '../environment/environment';
import {
  IModelCatalogService,
  ModelNotFoundError,
  ProviderNotFoundError,
  toProtocolModel,
  toProtocolProvider,
} from './modelCatalog';

export class ModelCatalogService
  extends Disposable
  implements IModelCatalogService {
  readonly _serviceBrand: undefined;

  private _authFacade: ServicesAuthFacade;

  constructor(
    @IEnvironmentService env: IEnvironmentService,
    @ICoreProcessService private readonly core: ICoreProcessService,
  ) {
    super();
    this._authFacade = createManagedAuthFacade(env);
  }

  static _createForTest(
    env: IEnvironmentService,
    core: ICoreProcessService,
    authFacade: ServicesAuthFacade,
  ): ModelCatalogService {
    const service = new ModelCatalogService(env, core);
    service._authFacade = authFacade;
    return service;
  }

  async listModels(): Promise<readonly ModelCatalogItem[]> {
    const config = await this._readConfig();
    return Object.entries(config.models ?? {}).map(([modelId, alias]) =>
      toProtocolModel(modelId, alias),
    );
  }

  async listProviders(): Promise<readonly ProviderCatalogItem[]> {
    const config = await this._readConfig();
    const out: ProviderCatalogItem[] = [];
    for (const [providerId, provider] of Object.entries(config.providers ?? {})) {
      out.push(await this._provider(config, providerId, provider));
    }
    return out;
  }

  async getProvider(providerId: string): Promise<ProviderCatalogItem> {
    const config = await this._readConfig();
    const provider = config.providers?.[providerId];
    if (provider === undefined) {
      throw new ProviderNotFoundError(providerId);
    }
    return this._provider(config, providerId, provider);
  }

  async setDefaultModel(modelId: string): Promise<SetDefaultModelResponse> {
    const config = await this._readConfig();
    const alias = config.models?.[modelId];
    if (alias === undefined) {
      throw new ModelNotFoundError(modelId);
    }

    const updated = await this.core.rpc.setPythinkerConfig({ defaultModel: modelId });
    const updatedAlias = updated.models?.[modelId] ?? alias;
    return {
      default_model: modelId,
      model: toProtocolModel(modelId, updatedAlias),
    };
  }

  async refreshOAuthProviderModels(): Promise<RefreshOAuthProviderModelsResponse> {
    let config = await this._readConfig();
    const changed: RefreshOAuthProviderModelsResponse['changed'] = [];
    const unchanged: string[] = [];
    const failed: RefreshOAuthProviderModelsResponse['failed'] = [];
    const provider = config.providers?.[PYTHINKER_CODE_PROVIDER_NAME];
    if (provider?.type !== 'pythinker' || provider.oauth === undefined) {
      return { changed, unchanged, failed };
    }

    try {
      const auth = resolvePythinkerCodeRuntimeAuth({
        configuredBaseUrl: provider.baseUrl,
        configuredOAuthRef: provider.oauth,
      });
      const tokenProvider = this._authFacade.resolveOAuthTokenProvider(
        PYTHINKER_CODE_PROVIDER_NAME,
        auth.oauthRef,
      );
      if (tokenProvider === undefined) {
        throw new Error('OAuth token provider is not configured.');
      }
      const token = await tokenProvider.getAccessToken();
      const models = await fetchManagedPythinkerCodeModels({
        accessToken: token,
        baseUrl: auth.baseUrl,
      });
      if (models.length === 0) return { changed, unchanged, failed };

      const next = structuredClone(config);
      applyManagedPythinkerCodeConfig(next as unknown as ManagedPythinkerConfigShape, {
        models,
        baseUrl: auth.baseUrl,
        oauthKey: auth.oauthRef.key,
        oauthHost: auth.oauthRef.oauthHost,
        preserveDefaultModel: true,
      });
      const refreshedAliasKeys = providerRefreshAliasKeys(
        config,
        next,
        PYTHINKER_CODE_PROVIDER_NAME,
        `${PYTHINKER_CODE_PLATFORM_ID}/`,
      );
      restoreProviderAliases(
        next,
        preserveUserProviderAliases(config, PYTHINKER_CODE_PROVIDER_NAME, refreshedAliasKeys),
      );
      restoreDefaultSelection(next, config.defaultModel, config.defaultThinking);
      clampDanglingDefault(next);

      if (providerModelsEqual(config, next, PYTHINKER_CODE_PROVIDER_NAME, refreshedAliasKeys)) {
        unchanged.push(PYTHINKER_CODE_PROVIDER_NAME);
      } else {
        const { added, removed } = computeChanges(
          collectModelIdsForAliases(config, refreshedAliasKeys),
          collectModelIdsForAliases(next, refreshedAliasKeys),
        );
        await this.core.rpc.removePythinkerProvider({ providerId: PYTHINKER_CODE_PROVIDER_NAME });
        await this.core.rpc.setPythinkerConfig({
          providers: next.providers,
          models: next.models,
          defaultModel: next.defaultModel,
          defaultThinking: next.defaultThinking,
        });
        changed.push({
          provider_id: PYTHINKER_CODE_PROVIDER_NAME,
          provider_name: 'Pythinker Code',
          added,
          removed,
        });
      }
    } catch (error) {
      failed.push({
        provider: PYTHINKER_CODE_PROVIDER_NAME,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return { changed, unchanged, failed };
  }

  private async _readConfig(): Promise<PythinkerConfig> {
    return this.core.rpc.getPythinkerConfig({ reload: true });
  }

  private async _provider(
    config: PythinkerConfig,
    providerId: string,
    provider: ProviderConfig,
  ): Promise<ProviderCatalogItem> {
    const hasApiKey = resolveProviderApiKey(provider) !== undefined;
    const hasOAuthToken = await this._hasCachedToken(providerId, provider);
    return toProtocolProvider(providerId, provider, config, {
      hasApiKey,
      hasOAuthToken,
    });
  }

  private async _hasCachedToken(
    providerId: string,
    provider: ProviderConfig,
  ): Promise<boolean> {
    if (provider.oauth === undefined) return false;
    try {
      const token = await this._authFacade.getCachedAccessToken(
        providerId,
        provider.oauth,
      );
      return nonEmpty(token) !== undefined;
    } catch {
      return false;
    }
  }
}

function collectModelIdsForAliases(config: PythinkerConfig, aliasKeys: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  for (const aliasKey of aliasKeys) {
    const alias = config.models?.[aliasKey];
    if (alias !== undefined && alias.model.length > 0) ids.add(alias.model);
  }
  return ids;
}

function providerAliasKeys(config: PythinkerConfig, providerId: string): Set<string> {
  const keys = new Set<string>();
  for (const [alias, model] of Object.entries(config.models ?? {})) {
    if (model.provider === providerId) keys.add(alias);
  }
  return keys;
}

function generatedProviderAliasKeys(
  config: PythinkerConfig,
  providerId: string,
  aliasPrefix: string,
): Set<string> {
  const keys = new Set<string>();
  for (const [alias, model] of Object.entries(config.models ?? {})) {
    if (model.provider === providerId && alias.startsWith(aliasPrefix)) keys.add(alias);
  }
  return keys;
}

function computeChanges(oldIds: Set<string>, newIds: Set<string>): { added: number; removed: number } {
  let added = 0;
  for (const id of newIds) {
    if (!oldIds.has(id)) added++;
  }
  let removed = 0;
  for (const id of oldIds) {
    if (!newIds.has(id)) removed++;
  }
  return { added, removed };
}

function providerModelsEqual(
  config: PythinkerConfig,
  nextConfig: PythinkerConfig,
  providerId: string,
  aliasKeys: ReadonlySet<string>,
): boolean {
  return (
    providerModelSnapshot(config, providerId, aliasKeys) ===
    providerModelSnapshot(nextConfig, providerId, aliasKeys)
  );
}

function providerModelSnapshot(
  config: PythinkerConfig,
  providerId: string,
  aliasKeys: ReadonlySet<string>,
): string {
  const snapshots: Array<{ alias: string; model: ModelAlias }> = [];
  for (const alias of aliasKeys) {
    const model = config.models?.[alias];
    if (model === undefined || model.provider !== providerId) continue;
    snapshots.push({
      alias,
      model: {
        ...model,
        capabilities: model.capabilities === undefined ? undefined : model.capabilities.toSorted(),
      },
    });
  }
  snapshots.sort((a, b) => a.alias.localeCompare(b.alias));
  return JSON.stringify(snapshots);
}

function providerRefreshAliasKeys(
  config: PythinkerConfig,
  nextConfig: PythinkerConfig,
  providerId: string,
  aliasPrefix: string,
): Set<string> {
  const keys = generatedProviderAliasKeys(config, providerId, aliasPrefix);
  for (const key of providerAliasKeys(nextConfig, providerId)) keys.add(key);
  return keys;
}

function preserveUserProviderAliases(
  config: PythinkerConfig,
  providerId: string,
  refreshedAliasKeys: ReadonlySet<string>,
): Record<string, ModelAlias> {
  const preserved: Record<string, ModelAlias> = {};
  for (const [alias, model] of Object.entries(config.models ?? {})) {
    if (model.provider !== providerId || refreshedAliasKeys.has(alias)) continue;
    preserved[alias] = structuredClone(model);
  }
  return preserved;
}

function restoreProviderAliases(config: PythinkerConfig, aliases: Record<string, ModelAlias>): void {
  if (Object.keys(aliases).length === 0) return;
  config.models = {
    ...config.models,
    ...aliases,
  };
}

function restoreDefaultSelection(
  config: PythinkerConfig,
  defaultModel: string | undefined,
  defaultThinking: boolean | undefined,
): void {
  if (defaultModel === undefined || config.models?.[defaultModel] === undefined) return;
  config.defaultModel = defaultModel;
  const capabilities = config.models[defaultModel]?.capabilities ?? [];
  config.defaultThinking = capabilities.includes('always_thinking') ? true : defaultThinking;
}

function clampDanglingDefault(config: PythinkerConfig): void {
  if (config.defaultModel !== undefined && config.models?.[config.defaultModel] === undefined) {
    config.defaultModel = undefined;
    config.defaultThinking = undefined;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

registerSingleton(IModelCatalogService, ModelCatalogService, InstantiationType.Delayed);
