#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { compareSemverCore } from '../check-identity-freeze.mjs';

const semver = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/u;

const lanes = {
  cli: 'apps/pythinker-code/package.json',
  desktop: 'apps/desktop/package.json',
  extension: 'apps/vscode/package.json',
};

function readVersion(ref, path, cwd) {
  try {
    const source = execFileSync('git', ['show', `${ref}:${path}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const version = JSON.parse(source).version;
    if (typeof version !== 'string' || semver.exec(version)?.[0] !== version) throw new Error('invalid version');
    return version;
  } catch (error) {
    throw new Error(`Cannot read release lane version from ${ref}:${path}.`, { cause: error });
  }
}

// A release run that fails leaves the desktop version untagged, and the next
// push does not bump it again. The tag, not the push diff, shows if it shipped.
function hasTag(tag, cwd) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function detectLaneBumps({ before, after, cwd = process.cwd() }) {
  if (typeof before !== 'string' || before === '' || typeof after !== 'string' || after === '') {
    throw new Error('Both before and after Git revisions are required.');
  }

  const result = Object.fromEntries(Object.entries(lanes).map(([name, path]) => {
    const beforeVersion = readVersion(before, path, cwd);
    const afterVersion = readVersion(after, path, cwd);
    const order = compareSemverCore(afterVersion, beforeVersion);
    if (order !== null && order < 0) {
      throw new Error(
        `Release lane ${name} rewound ${beforeVersion} -> ${afterVersion}. Identity freeze: never copy a lower version onto a published line.`,
      );
    }
    return [name, {
      before: beforeVersion,
      after: afterVersion,
      bumped: beforeVersion !== afterVersion,
    }];
  }));
  result.desktop.pending = result.desktop.bumped || !hasTag(`desktop-v${result.desktop.after}`, cwd);
  return result;
}

function writeOutputs(result, outputPath) {
  const lines = [
    `cli_version_bumped=${String(result.cli.bumped)}`,
    `cli_version=${result.cli.after}`,
    `desktop_release_pending=${String(result.desktop.pending)}`,
    `desktop_version=${result.desktop.after}`,
    `extension_version_bumped=${String(result.extension.bumped)}`,
    `extension_version=${result.extension.after}`,
  ];
  if (outputPath !== undefined && outputPath !== '') appendFileSync(outputPath, `${lines.join('\n')}\n`);
  return lines;
}

function main() {
  const [before, after, ...rest] = process.argv.slice(2);
  if (before === undefined || after === undefined || rest.length > 0) {
    throw new Error('Usage: node scripts/release/detect-lane-bumps.mjs <before-sha> <after-sha>');
  }
  const result = detectLaneBumps({ before, after });
  for (const line of writeOutputs(result, process.env.GITHUB_OUTPUT)) process.stdout.write(`${line}\n`);
}

if (process.argv[1] === import.meta.filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
