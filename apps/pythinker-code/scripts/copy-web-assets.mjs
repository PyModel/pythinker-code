import { cp, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANIFEST_NAME, computeWebInputHash } from './web-bundle-manifest.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const source = resolve(repoRoot, 'apps/pythinker-web/dist');
const target = resolve(appRoot, 'dist-web');

async function assertBuiltWeb() {
  try {
    const info = await stat(resolve(source, 'index.html'));
    if (!info.isFile()) {
      throw new Error('index.html is not a file');
    }
  } catch {
    throw new Error(
      `Pythinker web build output was not found at ${source}. Run \`pnpm --filter @pymodel/pythinker-web run build\` first.`,
    );
  }
}

await assertBuiltWeb();
// Fingerprint the source that produced this bundle, so check-web-assets.mjs
// can tell a stale committed bundle from a current one.
const { hash, fileCount } = await computeWebInputHash();
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
await writeFile(
  resolve(target, MANIFEST_NAME),
  `${JSON.stringify({ sourceHash: hash, sourceFileCount: fileCount }, null, 2)}\n`,
);

console.log(`Copied Pythinker web assets to ${target} (source ${hash.slice(0, 12)}, ${fileCount} files)`);
