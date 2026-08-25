#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

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

export function detectLaneBumps({ before, after, cwd = process.cwd() }) {
  if (typeof before !== 'string' || before === '' || typeof after !== 'string' || after === '') {
    throw new Error('Both before and after Git revisions are required.');
  }

  return Object.fromEntries(Object.entries(lanes).map(([name, path]) => {
    const beforeVersion = readVersion(before, path, cwd);
    const afterVersion = readVersion(after, path, cwd);
    return [name, {
      before: beforeVersion,
      after: afterVersion,
      bumped: beforeVersion !== afterVersion,
    }];
  }));
}

function writeOutputs(result, outputPath) {
  const lines = [
    `cli_version_bumped=${String(result.cli.bumped)}`,
    `cli_version=${result.cli.after}`,
    `desktop_version_bumped=${String(result.desktop.bumped)}`,
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
