// Shared fingerprint of the web UI's build inputs.
//
// The committed bundle at apps/pythinker-code/dist-web is generated from
// apps/pythinker-web. Nothing in the type-check, lint, or test gates reads the
// bundle, so editing the web source and forgetting to rebuild ships a CLI whose
// embedded UI silently lags the source — a class of bug that reaches users and
// leaves no trace in CI. copy-web-assets.mjs stamps this fingerprint into the
// bundle; check-web-assets.mjs recomputes it and fails on a mismatch.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { globSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = resolve(appRoot, '../..');
export const webRoot = resolve(repoRoot, 'apps/pythinker-web');
export const bundleRoot = resolve(appRoot, 'dist-web');
export const MANIFEST_NAME = '.web-bundle-manifest.json';

// Everything the Vite build reads. `public/` is copied verbatim into the
// bundle, and the configs decide how the source is compiled, so a change to
// any of them makes the committed bundle stale.
const INPUT_GLOBS = [
  'src/**/*',
  'public/**/*',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'package.json',
];

/** Sorted list of build-input paths, relative to apps/pythinker-web. */
export function webInputFiles() {
  const seen = new Set();
  for (const pattern of INPUT_GLOBS) {
    for (const file of globSync(pattern, { cwd: webRoot })) {
      const normalized = file.split('\\').join('/');
      if (statSync(resolve(webRoot, normalized)).isFile()) seen.add(normalized);
    }
  }
  return [...seen].sort();
}

/**
 * Content hash over every build input. Path-and-content, so a rename with
 * identical bytes still changes the fingerprint.
 */
export async function computeWebInputHash() {
  const files = webInputFiles();
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(file);
    digest.update('\0');
    digest.update(await readFile(resolve(webRoot, file)));
    digest.update('\0');
  }
  return { hash: digest.digest('hex'), fileCount: files.length };
}
