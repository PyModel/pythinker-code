import { registerHooks } from 'node:module';

import { load } from './raw-text-loader.mjs';

/**
 * Registers the `?raw` text loader. Pass to Node via `--import` (alongside
 * tsx) so source-executed code can import text files.
 */
registerHooks({ load });
