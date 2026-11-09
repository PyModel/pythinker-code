// apps/pythinker-web/src/api/index.ts
// Singleton factory for the PythinkerWebApi daemon client.

import { readPythinkerApiConfig } from './config';
import type { CatalogProviderApi, PythinkerWebApi } from './types';
import { DaemonPythinkerWebApi } from './daemon/client';
import { createCatalogProviderApi } from './daemon/catalog';

type WebApi = PythinkerWebApi & CatalogProviderApi;

let singleton: WebApi | undefined;

export function getPythinkerWebApi(): WebApi {
  if (singleton === undefined) {
    const config = readPythinkerApiConfig();
    singleton = Object.assign(new DaemonPythinkerWebApi(config), createCatalogProviderApi(config));
  }
  return singleton;
}
