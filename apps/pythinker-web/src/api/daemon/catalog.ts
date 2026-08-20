// apps/pythinker-web/src/api/daemon/catalog.ts
// Catalog provider REST operations kept separate from the legacy provider adapter.

import type { PythinkerApiConfig } from '../config';
import type {
  CatalogProviderApi,
  CatalogProviderImportInput,
} from '../types';
import { DaemonHttpClient } from './http';
import {
  toAppCatalogProvider,
  toCatalogProviderImportResult,
} from './mappers';
import type {
  WireImportCatalogProviderResult,
  WireListCatalogProvidersResult,
} from './wire';

export function createCatalogProviderApi(config: PythinkerApiConfig): CatalogProviderApi {
  const http = new DaemonHttpClient(config.serverHttpUrl, {
    clientId: config.clientId,
    clientName: config.clientName,
    clientVersion: config.clientVersion,
    clientUiMode: config.clientUiMode,
  });

  return {
    async listCatalogProviders() {
      const data = await http.get<WireListCatalogProvidersResult>('/catalog/providers');
      return data.items.map(toAppCatalogProvider);
    },

    async importCatalogProvider(input: CatalogProviderImportInput) {
      const body: Record<string, string> = { catalog_id: input.catalogId };
      if (input.apiKey !== undefined) body['api_key'] = input.apiKey;
      if (input.baseUrl !== undefined) body['base_url'] = input.baseUrl;
      if (input.id !== undefined) body['id'] = input.id;
      const data = await http.post<WireImportCatalogProviderResult>(
        '/providers:import_catalog',
        body,
      );
      return toCatalogProviderImportResult(data);
    },
  };
}
