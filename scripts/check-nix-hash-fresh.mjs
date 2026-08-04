#!/usr/bin/env node
// Cheap proxy for the Nix fetchPnpmDeps hash going stale.
//
// flake.nix pins a `hash = "sha256-..."` for pkgs.fetchPnpmDeps, computed
// from pnpm-lock.yaml. If the lockfile changes and nobody refreshes that
// hash, `nix build` fails in CI with a hash mismatch. Recomputing the real
// hash requires `nix`, which may not be installed locally, so this checks a
// proxy instead: did pnpm-lock.yaml change on this branch without flake.nix
// also changing? That's not proof the hash is stale (a flake.nix edit could
// be unrelated), but it's the cheap signal that catches the common case.
//
// ponytail: proxy check, not a real hash recompute — upgrade to `nix build
// --dry-run` locally if false positives/negatives become a problem.
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function resolveBaseRef() {
  try {
    const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (upstream) return upstream;
  } catch {
    // no upstream configured
  }
  try {
    git(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/HEAD']);
    return 'origin/HEAD';
  } catch {
    return null;
  }
}

const base = resolveBaseRef();
if (!base) {
  console.log('[nix-hash-freshness] no upstream/origin ref found, skipping (bootstrap push).');
  process.exit(0);
}

let changedFiles;
try {
  changedFiles = git(['diff', '--name-only', `${base}...HEAD`])
    .split('\n')
    .filter(Boolean);
} catch (err) {
  console.log(`[nix-hash-freshness] could not diff against ${base}, skipping. (${err.message})`);
  process.exit(0);
}

const lockChanged = changedFiles.includes('pnpm-lock.yaml');
const flakeChanged = changedFiles.includes('flake.nix');

if (!lockChanged || flakeChanged) {
  process.exit(0);
}

console.error(
  '❌ pnpm-lock.yaml changed on this branch but flake.nix did not.\n' +
    "   flake.nix pins a fetchPnpmDeps hash of pnpm-lock.yaml; CI's nix build will fail with a hash mismatch.\n" +
    '   Refresh it: run a nix build (e.g. `nix build .#pythinker-code`), take the sha256-... hash\n' +
    '   from the mismatch error, paste it into the `hash = "sha256-...";` line in flake.nix, commit, and re-push.',
);
process.exit(1);
