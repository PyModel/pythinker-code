import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  collectReleaseStatus,
  expectedCliAssets,
  nativeTargets,
  renderReleaseStatus,
} from './release-status.mjs';

async function writePackage(root, path, version) {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify({ version })}\n`);
}

async function fixtureRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'release-status-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writePackage(root, 'apps/pythinker-code/package.json', '1.3.0');
  await writePackage(root, 'apps/desktop/package.json', '0.2.1');
  await writePackage(root, 'apps/vscode/package.json', '0.9.5');
  return root;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fixtureFetch({ cliAssets = expectedCliAssets } = {}) {
  return async (input) => {
    const url = String(input);
    if (url.includes('registry.npmjs.org')) return json({ latest: '1.3.0' });
    if (url.includes('code.pythinker.com')) {
      return json({
        version: '1.3.0',
        platforms: Object.fromEntries(nativeTargets.map((target) => [target, {}])),
      });
    }
    if (url.includes('/pythinker-code/releases/tags/')) {
      return json({
        tag_name: '@pymodel/pythinker-code@1.3.0',
        assets: cliAssets.map((name) => ({ name })),
      });
    }
    if (url.endsWith('/pythinker-desktop-releases/releases/latest')) {
      return json({ tag_name: 'v0.2.1', assets: [{ name: 'latest.yml' }] });
    }
    if (url.includes('open-vsx.org')) {
      return json({
        version: '0.9.5',
        downloads: Object.fromEntries(nativeTargets.map((target) => [target, `https://${target}`])),
      });
    }
    if (url.includes('marketplace.visualstudio.com')) {
      return json({
        results: [{
          extensions: [{
            versions: nativeTargets.map((target) => ({ version: '0.9.5', targetPlatform: target })),
          }],
        }],
      });
    }
    return json({ message: `Unexpected URL: ${url}` }, 404);
  };
}

void test('reports all live release lanes aligned', async (t) => {
  const rootDir = await fixtureRoot(t);
  const result = await collectReleaseStatus({ rootDir, fetchImpl: fixtureFetch() });

  assert.equal(result.ok, true);
  assert.equal(result.rows.every((row) => row.ok), true);
  assert.match(renderReleaseStatus(result), /\| npm CLI \| 1\.3\.0 \| 1\.3\.0 \| PASS \|/u);
});

void test('fails when a published CLI release is missing one required asset', async (t) => {
  const rootDir = await fixtureRoot(t);
  const result = await collectReleaseStatus({
    rootDir,
    fetchImpl: fixtureFetch({ cliAssets: expectedCliAssets.filter((name) => name !== 'manifest.json') }),
  });

  assert.equal(result.ok, false);
  const cli = result.rows.find((row) => row.lane === 'npm CLI');
  assert.equal(cli?.ok, false);
  assert.match(cli?.details ?? '', /missing manifest\.json/u);
});
