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
import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = resolve(appRoot, '../..');
export const webRoot = resolve(repoRoot, 'apps/pythinker-web');
export const bundleRoot = resolve(appRoot, 'dist-web');
export const MANIFEST_NAME = '.web-bundle-manifest.json';

// Everything the Vite build reads out of a package. `public/` is copied
// verbatim into the bundle, and the configs decide how the source is compiled,
// so a change to any of them makes the committed bundle stale.
const INPUT_GLOBS = [
  'src/**/*',
  'public/**/*',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'package.json',
];

// The web app compiles workspace dependencies from source (they publish
// `./src/index.ts` directly), so their files are build inputs too. Hashing only
// apps/pythinker-web would let a change in one of them alter the bundle while
// the fingerprint stayed put. The lockfile is included because a dependency
// resolution change alters the bundle without touching any tracked source.
const EXTRA_INPUTS = ['pnpm-lock.yaml'];

/** Workspace package roots the web app depends on, transitively. */
function workspaceDependencyRoots() {
  const roots = [];
  const pending = [webRoot];
  const seen = new Set([webRoot]);
  while (pending.length > 0) {
    const root = pending.pop();
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== 'string' || !range.startsWith('workspace:')) continue;
      const dir = name.replace(/^@[^/]+\//u, '');
      for (const candidate of [resolve(repoRoot, 'packages', dir), resolve(repoRoot, 'apps', dir)]) {
        if (seen.has(candidate) || !existsSync(resolve(candidate, 'package.json'))) continue;
        seen.add(candidate);
        roots.push(candidate);
        pending.push(candidate);
        break;
      }
    }
  }
  return roots.sort();
}

/** Sorted list of build-input paths, relative to the repo root. */
export function webInputFiles() {
  const seen = new Set();
  for (const root of [webRoot, ...workspaceDependencyRoots()]) {
    for (const pattern of INPUT_GLOBS) {
      for (const file of globSync(pattern, { cwd: root })) {
        const full = resolve(root, file);
        if (!statSync(full).isFile()) continue;
        seen.add(relative(repoRoot, full).split('\\').join('/'));
      }
    }
  }
  for (const file of EXTRA_INPUTS) {
    if (existsSync(resolve(repoRoot, file))) seen.add(file);
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
    digest.update(await readFile(resolve(repoRoot, file)));
    digest.update('\0');
  }
  return { hash: digest.digest('hex'), fileCount: files.length };
}
