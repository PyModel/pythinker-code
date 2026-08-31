import { Disposable, InstantiationType, registerSingleton } from '../../di';
import type { PythinkerConfig, ModelAlias, ProviderConfig, ProviderType } from '../../config';
import type {
  ModelCatalogItem,
  ProviderCatalogItem,
  RefreshProviderModelsResponse,
  SetDefaultModelResponse,
} from '@pymodel/protocol';
import {
  refreshProviderModels,
  type PythinkerConfigShape,
  type RefreshProviderHost,
  type RefreshResult,
} from '@pymodel/pythinker-code-oauth';

import { OAuthTokenReader } from '../auth/oauthToken';
import { ICoreProcessService } from '../coreProcess/coreProcess';
import { IEnvironmentService } from '../environment/environment';
import { IEventService } from '../event/event';
import {
  IModelCatalogService,
  ModelNotFoundError,
  ProviderNotFoundError,
  toProtocolModel,
  toProtocolProvider,
  type RefreshProviderModelsOptions,
} from './modelCatalog';

export class ModelCatalogService
  extends Disposable
  implements IModelCatalogService {
  readonly _serviceBrand: undefined;

  private oauthTokens: Pick<OAuthTokenReader, 'getCachedAccessToken'>;

  /** Serializes refresh runs so a scheduled refresh and a manual one (or two
   *  manual ones with different options) never race on writing config.toml. */
  private _refreshChain: Promise<unknown> = Promise.resolve();

  constructor(
    @IEnvironmentService env: IEnvironmentService,
    @ICoreProcessService private readonly core: ICoreProcessService,
    @IEventService private readonly eventService: IEventService,
  ) {
    super();
    this.oauthTokens = new OAuthTokenReader(env.homeDir);
  }

  async listModels(): Promise<readonly ModelCatalogItem[]> {
    const config = await this._readConfig();
    return Object.entries(config.models ?? {}).map(([modelId, alias]) =>
      toProtocolModel(modelId, alias, this._providerTypeOf(config, alias)),
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
      model: toProtocolModel(
        modelId,
        updatedAlias,
        this._providerTypeOf(updated, updatedAlias),
      ),
    };
  }

  private _providerTypeOf(config: PythinkerConfig, alias: ModelAlias): ProviderType | undefined {
    const providerId = alias.provider ?? config.defaultProvider;
    return config.providers[providerId ?? '']?.type;
  }

  refreshProviderModels(
    options: RefreshProviderModelsOptions = {},
  ): Promise<RefreshProviderModelsResponse> {
    const run = this._refreshChain.then(() => this._doRefreshProviderModels(options));
    this._refreshChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async _doRefreshProviderModels(
    options: RefreshProviderModelsOptions,
  ): Promise<RefreshProviderModelsResponse> {
    if (options.providerId !== undefined) {
      const config = await this._readConfig();
      if (config.providers?.[options.providerId] === undefined) {
        throw new ProviderNotFoundError(options.providerId);
      }
    }

    const result = await refreshProviderModels(this._buildRefreshHost(), {
      providerId: options.providerId,
    });
    const response = mapRefreshResult(result);

    if (response.changed.length > 0) {
      this.eventService.publish({
        type: 'event.model_catalog.changed',
        agentId: 'main',
        sessionId: '__global__',
        changed: response.changed,
        unchanged: response.unchanged,
        failed: response.failed,
      });
    }

    return response;
  }

  private _buildRefreshHost(): RefreshProviderHost {
    return {
      getConfig: () => this._readConfig() as Promise<PythinkerConfigShape>,
      removeProvider: (providerId) =>
        this.core.rpc.removePythinkerProvider({ providerId }) as Promise<PythinkerConfigShape>,
      setConfig: (patch) =>
        this.core.rpc.setPythinkerConfig(patch as Record<string, unknown>) as Promise<PythinkerConfigShape>,
      userAgent: this.core.pythinkerRequestHeaders?.['User-Agent'],
    };
  }

  private async _readConfig(): Promise<PythinkerConfig> {
    return this.core.rpc.getPythinkerConfig({ reload: true });
  }

  private async _provider(
    config: PythinkerConfig,
    providerId: string,
    provider: ProviderConfig,
  ): Promise<ProviderCatalogItem> {
    const hasApiKey = hasConfiguredApiKey(provider);
    const hasOAuthToken = await this._hasCachedToken(provider);
    return toProtocolProvider(providerId, provider, config, {
      hasApiKey,
      hasOAuthToken,
    });
  }

  private async _hasCachedToken(provider: ProviderConfig): Promise<boolean> {
    if (provider.oauth === undefined) return false;
    try {
      const token = await this.oauthTokens.getCachedAccessToken(provider.oauth);
      return nonEmpty(token) !== undefined;
    } catch {
      return false;
    }
  }
}

function mapRefreshResult(result: RefreshResult): RefreshProviderModelsResponse {
  return {
    changed: result.changed.map((change) => ({
      provider_id: change.providerId,
      provider_name: change.providerName,
      added: change.added,
      removed: change.removed,
    })),
    unchanged: [...result.unchanged],
    failed: result.failed.map((failure) => ({
      provider: failure.provider,
      reason: failure.reason,
    })),
  };
}

function hasConfiguredApiKey(provider: ProviderConfig): boolean {
  if (nonEmpty(provider.apiKey) !== undefined) return true;
  switch (provider.type) {
    case 'anthropic':
      return nonEmpty(provider.env?.['ANTHROPIC_API_KEY']) !== undefined;
    case 'openai':
    case 'openai_responses':
      return nonEmpty(provider.env?.['OPENAI_API_KEY']) !== undefined;
    case 'pythinker':
      return nonEmpty(provider.env?.['PYTHINKER_API_KEY']) !== undefined;
    case 'google-genai':
      return nonEmpty(provider.env?.['GOOGLE_API_KEY']) !== undefined;
    case 'vertexai':
      return (
        nonEmpty(provider.env?.['VERTEXAI_API_KEY']) !== undefined ||
        nonEmpty(provider.env?.['GOOGLE_API_KEY']) !== undefined
      );
  }
  return false;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

registerSingleton(IModelCatalogService, ModelCatalogService, InstantiationType.Delayed);
