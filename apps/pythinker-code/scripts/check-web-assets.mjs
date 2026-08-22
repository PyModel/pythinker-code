// Verify the committed web bundle is present AND current.
//
// This repo keeps the web UI source at apps/pythinker-web. The bundle is
// staged at apps/pythinker-code/dist-web by scripts/copy-web-assets.mjs after
// a web build. Presence alone is not enough: no other gate reads the bundle,
// so editing the web source without rebuilding ships a CLI whose embedded UI
// lags its own source, with nothing red to show for it. Compare the source
// fingerprint recorded at copy time against the current source.

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANIFEST_NAME, computeWebInputHash } from './web-bundle-manifest.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(appRoot, 'dist-web');

const REBUILD = 'Run `pnpm run build:web` to rebuild and restage it.';

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

async function assertWebAssetsCurrent() {
  const manifestPath = resolve(target, MANIFEST_NAME);
  let recorded;
  try {
    recorded = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error(
      `The staged web bundle has no ${MANIFEST_NAME}, so it cannot be checked ` +
        `against apps/pythinker-web. ${REBUILD}`,
    );
  }
  const { hash, fileCount } = await computeWebInputHash();
  if (recorded.sourceHash !== hash) {
    throw new Error(
      'The committed web bundle is stale: apps/pythinker-web has changed since ' +
        `it was built (bundle ${String(recorded.sourceHash).slice(0, 12)}, ` +
        `source ${hash.slice(0, 12)}; ${recorded.sourceFileCount} -> ${fileCount} files). ` +
        REBUILD,
    );
  }
  return hash;
}

await assertWebAssets();
const sourceHash = await assertWebAssetsCurrent();
const files = await readdir(target, { recursive: true });
console.log(`Web assets OK: ${target} (${files.length} entries, source ${sourceHash.slice(0, 12)})`);
