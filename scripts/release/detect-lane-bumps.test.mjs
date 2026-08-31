import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { detectLaneBumps } from './detect-lane-bumps.mjs';

const packagePaths = {
  cli: 'apps/pythinker-code/package.json',
  desktop: 'apps/desktop/package.json',
  extension: 'apps/vscode/package.json',
};

async function writePackage(root, path, version) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify({ version })}\n`);
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commit(root, message) {
  git(root, ['add', '.']);
  git(root, [
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'user.name=Release Test',
    '-c', 'user.email=release@example.test',
    'commit',
    '-m', message,
  ]);
  return git(root, ['rev-parse', 'HEAD']);
}

void test('detects a lane bump anywhere in the pushed commit range', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'release-lanes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);

  await Promise.all(Object.values(packagePaths).map((path) => writePackage(root, path, '1.0.0')));
  const before = commit(root, 'initial');

  await writePackage(root, packagePaths.extension, '1.1.0');
  commit(root, 'bump extension');
  await writeFile(join(root, 'README.md'), 'unrelated final commit\n');
  const after = commit(root, 'unrelated follow-up');

  const result = detectLaneBumps({ before, after, cwd: root });
  assert.deepEqual(result, {
    cli: { before: '1.0.0', after: '1.0.0', bumped: false },
    desktop: { before: '1.0.0', after: '1.0.0', bumped: false },
    extension: { before: '1.0.0', after: '1.1.0', bumped: true },
  });
});

void test('fails closed when the push boundary cannot be read', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'release-lanes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);
  await Promise.all(Object.values(packagePaths).map((path) => writePackage(root, path, '1.0.0')));
  const after = commit(root, 'initial');

  assert.throws(
    () => detectLaneBumps({ before: 'missing-ref', after, cwd: root }),
    /Cannot read release lane version/,
  );
});

void test('rejects a version that could inject a GitHub output line', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'release-lanes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);
  await Promise.all(Object.values(packagePaths).map((path) => writePackage(root, path, '1.0.0')));
  const before = commit(root, 'initial');
  await writePackage(root, packagePaths.extension, '1.1.0\nforged=true');
  const after = commit(root, 'invalid version');

  assert.throws(
    () => detectLaneBumps({ before, after, cwd: root }),
    /Cannot read release lane version/,
  );
});
