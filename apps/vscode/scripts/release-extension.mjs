#!/usr/bin/env node
// Tag and publish the VS Code extension in one pass:
// preflight -> bump -> commit -> build -> package+verify -> publish -> tag -> push.
//
//   pnpm --filter pythinker-code run release 0.8.3
//   pnpm --filter pythinker-code run release 0.8.3 --dry-run
//
// The Marketplace token is read from the macOS keychain, so it never reaches a
// shell history or a file. Store it once with:
//   security add-generic-password -s pythinker-vsce-pat -a "$USER" -w
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extensionRoot, isMainModule } from './vsix-targets.mjs';

const KEYCHAIN_SERVICE = 'pythinker-vsce-pat';
const OVSX_KEYCHAIN_SERVICE = 'pythinker-ovsx-pat';
const MANIFEST = join(extensionRoot, 'package.json');
const repoRoot = join(extensionRoot, '..', '..');

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', cwd: repoRoot, ...options });
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', cwd: repoRoot, ...options }).trim();
}

/** A secret in argv or the environment leaks into `ps` and shell history; the keychain does not. */
function keychainSecret(service) {
  try {
    return capture('security', ['find-generic-password', '-s', service, '-w'], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function parseArguments(argv) {
  let version = '';
  let dryRun = false;
  for (const argument of argv) {
    if (argument === '--dry-run') dryRun = true;
    else if (argument === '--') continue;
    else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
    else if (version) throw new Error('Pass exactly one version.');
    else version = argument;
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Usage: release <major.minor.patch> [--dry-run]');
  }
  return { version, dryRun };
}

function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

function isNewer(next, current) {
  const a = next.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** The Marketplace refuses a duplicate version, so catch it before anything is built. */
async function assertUnpublished(version) {
  const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.1-preview.1' },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: 'pythoughts.pythinker-code' }] }], flags: 914 }),
  });
  if (!response.ok) {
    console.warn(`Could not reach the Marketplace to check for ${version}; continuing.`);
    return;
  }
  const body = await response.json();
  const versions = body.results?.[0]?.extensions?.[0]?.versions ?? [];
  if (versions.some((entry) => entry.version === version)) {
    throw new Error(`${version} is already on the Marketplace. Versions cannot be reused — pick the next one.`);
  }
}

function assertCleanTree() {
  if (capture('git', ['status', '--porcelain'])) {
    throw new Error('Working tree is dirty. Commit or stash first so the tag matches what ships.');
  }
}

async function main() {
  const { version, dryRun } = parseArguments(process.argv.slice(2));
  const tag = `pythinker-code-vscode@${version}`;
  const manifest = readManifest();

  assertCleanTree();
  if (!isNewer(version, manifest.version)) {
    throw new Error(`${version} does not come after the current ${manifest.version}.`);
  }
  if (capture('git', ['tag', '--list', tag])) {
    throw new Error(`Tag ${tag} already exists.`);
  }
  await assertUnpublished(version);

  const vscePat = process.env.VSCE_PAT || keychainSecret(KEYCHAIN_SERVICE);
  if (!vscePat && !dryRun) {
    throw new Error(
      `No Marketplace token. Store one with: security add-generic-password -s ${KEYCHAIN_SERVICE} -a "$USER" -w`,
    );
  }

  console.log(`\n== ${manifest.version} -> ${version}${dryRun ? ' (dry run)' : ''} ==\n`);
  writeFileSync(MANIFEST, readFileSync(MANIFEST, 'utf8').replace(`"version": "${manifest.version}"`, `"version": "${version}"`));

  run('pnpm', ['build']);
  run('pnpm', ['--filter', 'pythinker-code', 'run', 'package:platform']);

  if (dryRun) {
    console.log(`\nDry run: built and verified ${version}. Nothing published, nothing tagged.`);
    console.log('Restore the manifest with: git checkout apps/vscode/package.json');
    return;
  }

  // Commit before publishing so the shipped bits always correspond to a commit,
  // and tag only once the Marketplace has actually accepted them.
  run('git', ['add', 'apps/vscode/package.json']);
  run('git', ['commit', '-m', `chore(vscode): release ${version}`]);

  run('pnpm', ['--filter', 'pythinker-code', 'run', 'publish:vsix'], { env: { ...process.env, VSCE_PAT: vscePat } });

  const ovsxPat = process.env.OVSX_PAT || keychainSecret(OVSX_KEYCHAIN_SERVICE);
  if (ovsxPat) {
    // Open VSX serves Cursor / VSCodium / Windsurf, but it must never undo a
    // successful Marketplace publish.
    try {
      run('pnpm', ['--filter', 'pythinker-code', 'run', 'publish:ovsx'], { env: { ...process.env, OVSX_PAT: ovsxPat } });
    } catch (error) {
      console.warn(`Open VSX publish failed, Marketplace is live: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.warn(`No Open VSX token (keychain service ${OVSX_KEYCHAIN_SERVICE}) — skipped.`);
  }

  run('git', ['tag', '-a', tag, '-m', `Pythinker Code VS Code extension ${version}`]);
  console.log(`\nPublished ${version} and tagged ${tag}.`);
  console.log(`Push it with: git push origin ${capture('git', ['rev-parse', '--abbrev-ref', 'HEAD'])} ${tag}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`\nRelease failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
