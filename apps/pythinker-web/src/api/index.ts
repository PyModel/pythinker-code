// apps/pythinker-web/src/api/index.ts
// Singleton factory for the PythinkerWebApi daemon client.

import { readPythinkerApiConfig } from './config';
import type { PythinkerWebApi } from './types';
import { DaemonPythinkerWebApi } from './daemon/client';

let singleton: PythinkerWebApi | undefined;

export function getPythinkerWebApi(): PythinkerWebApi {
  singleton ??= new DaemonPythinkerWebApi(readPythinkerApiConfig());
  return singleton;
}
