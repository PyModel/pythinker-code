/**
 * `CatalogService` — implementation of `ICatalogService`.
 */

import { Disposable, InstantiationType, registerSingleton } from '../../di';
import type { AgentProfile, Plugin } from '@pymodel/protocol';

import { ICoreProcessService } from '../coreProcess/coreProcess';
import { ICatalogService, toProtocolAgentProfile, toProtocolPlugin } from './catalog';

export class CatalogService extends Disposable implements ICatalogService {
  readonly _serviceBrand: undefined;

  constructor(@ICoreProcessService private readonly core: ICoreProcessService) {
    super();
  }

  async listPlugins(): Promise<readonly Plugin[]> {
    const summaries = await this.core.rpc.listPlugins({});
    return summaries.map(toProtocolPlugin);
  }

  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    await this.core.rpc.setPluginEnabled({ id: pluginId, enabled });
  }

  async listAgentProfiles(workDir: string): Promise<readonly AgentProfile[]> {
    const catalog = await this.core.rpc.listAgentProfiles({ workDir });
    return catalog.profiles.map(toProtocolAgentProfile);
  }
}

registerSingleton(ICatalogService, CatalogService, InstantiationType.Delayed);
