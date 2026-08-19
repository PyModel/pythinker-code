// Verify the built web bundle is present before packaging.
//
// This repo keeps the web UI source at apps/pythinker-web. The bundle is
// staged at apps/pythinker-code/dist-web by scripts/copy-web-assets.mjs after
// a web build. This check only asserts the staged bundle is in place, so a
// packaging run never silently ships a CLI without the web UI.

import { readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(appRoot, 'dist-web');

async function assertWebAssets() {
  try {
    const info = await stat(resolve(target, 'index.html'));
    if (!info.isFile()) {
      throw new Error('index.html is not a file');
    }
  } catch {
    throw new Error(
      `Web assets were not found at ${target}/index.html. Run ` +
        '`pnpm --filter @pymodel/pythinker-web run build` and then ' +
        '`node apps/pythinker-code/scripts/copy-web-assets.mjs`.',
    );
  }
}

await assertWebAssets();
const files = await readdir(target, { recursive: true });
console.log(`Web assets OK: ${target} (${files.length} entries)`);
