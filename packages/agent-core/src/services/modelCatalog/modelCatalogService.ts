import { Disposable, InstantiationType, registerSingleton } from '../../di';
import {
  resolveProviderApiKey,
  type PythinkerConfig,
  type ProviderConfig,
} from '../../config';
import type {
  ModelCatalogItem,
  ProviderCatalogItem,
  SetDefaultModelResponse,
} from '@pymodel/protocol';
import { ICoreProcessService } from '../coreProcess/coreProcess';
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

  constructor(@ICoreProcessService private readonly core: ICoreProcessService) {
    super();
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

  async removeProvider(providerId: string): Promise<void> {
    const config = await this._readConfig();
    if (config.providers?.[providerId] === undefined) {
      throw new ProviderNotFoundError(providerId);
    }
    await this.core.rpc.removePythinkerProvider({ providerId });
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


  private async _readConfig(): Promise<PythinkerConfig> {
    return this.core.rpc.getPythinkerConfig({ reload: true });
  }

  private async _provider(
    config: PythinkerConfig,
    providerId: string,
    provider: ProviderConfig,
  ): Promise<ProviderCatalogItem> {
    const hasApiKey = resolveProviderApiKey(provider) !== undefined;
    return toProtocolProvider(providerId, provider, config, {
      hasApiKey,
      hasOAuthToken: false,
    });
  }

}













registerSingleton(IModelCatalogService, ModelCatalogService, InstantiationType.Delayed);
