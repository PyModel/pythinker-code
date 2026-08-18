/**
 * Idempotent wrapper around `pnpm changeset publish` for the Release workflow.
 *
 * Problem: under npm Trusted Publishing, the changesets action exports a
 * placeholder NODE_AUTH_TOKEN. `changeset publish` performs its
 * "is this version already on npm?" read with that invalid token, the
 * registry rejects the read, changesets assumes "unpublished", republishes,
 * and npm fails the whole workflow with "cannot publish over previously
 * published versions". Every push without a pending changeset then fails
 * Release and takes native assets / docs / homebrew down with it.
 *
 * Fix: before delegating to changesets, check the registry ourselves with a
 * CLEAN environment (no auth token, no CI userconfig — public reads need
 * neither). If every publishable package's local version is already live,
 * exit 0 without publishing anything.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const changesetConfig = JSON.parse(readFileSync('.changeset/config.json', 'utf-8'));
const ignored = new Set(changesetConfig.ignore ?? []);

function* workspacePackageJsons() {
  for (const group of ['packages', 'apps']) {
    if (!existsSync(group)) continue;
    for (const entry of readdirSync(group, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const nested = join(group, entry.name);
      const p = join(nested, 'package.json');
      if (existsSync(p)) yield p;
      // one extra level (e.g. apps/vis/{web,server})
      for (const sub of readdirSync(nested, { withFileTypes: true })) {
        if (sub.isDirectory() && existsSync(join(nested, sub.name, 'package.json'))) {
          yield join(nested, sub.name, 'package.json');
        }
      }
    }
  }
}

const publishable = [];
for (const p of new Set(workspacePackageJsons())) {
  try {
    const pkg = JSON.parse(readFileSync(p, 'utf-8'));
    if (pkg.private === true || pkg.name === undefined || ignored.has(pkg.name)) continue;
    publishable.push({ name: pkg.name, version: pkg.version });
  } catch {
    // unreadable package.json — let changeset publish surface it
  }
}

// Public registry reads must not carry CI auth/userconfig: an invalid token
// turns a public read into a 401, which is the exact bug this script fixes.
const cleanEnv = { ...process.env };
delete cleanEnv['NODE_AUTH_TOKEN'];
delete cleanEnv['NPM_CONFIG_USERCONFIG'];
delete cleanEnv['npm_config_userconfig'];

function isPublished({ name, version }) {
  try {
    const out = execFileSync(
      'npm',
      ['view', `${name}@${version}`, 'version', '--registry=https://registry.npmjs.org'],
      { env: cleanEnv, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    return out === version;
  } catch {
    return false; // not found (or registry hiccup) -> let changeset publish decide
  }
}

const unpublished = publishable.filter((pkg) => !isPublished(pkg));

if (publishable.length > 0 && unpublished.length === 0) {
  console.log(
    `All publishable package versions already exist on npm (${publishable
      .map((p) => `${p.name}@${p.version}`)
      .join(', ')}) — nothing to publish, exiting 0.`,
  );
  process.exit(0);
}

console.log(
  `Unpublished: ${unpublished.map((p) => `${p.name}@${p.version}`).join(', ') || '(none detected — deferring to changesets)'}`,
);
const result = spawnSync('pnpm', ['changeset', 'publish'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
