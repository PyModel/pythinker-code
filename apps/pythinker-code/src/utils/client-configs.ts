import { join } from 'node:path';

import { ClientConfigClient } from '@pymodel/pythinker-code-product/client-configs/node';

import { getCacheDir } from '#/utils/paths';
import { currentPythinkerRegion } from '#/utils/region';

export const clientConfigs = new ClientConfigClient({
  region: currentPythinkerRegion,
  baseUrlOverride: () => process.env['CUSTOM_API_BASE_URL'],
  cacheDir: () => join(getCacheDir(), 'client-configs'),
});
