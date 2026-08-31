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

const desktopCommitCount = '4102';
const desktopNightlyVersion = '0.2.2-nightly.4102';

function desktopAssets(version, channel) {
  const prefix = channel === 'stable' ? 'latest' : channel;
  return [
    `${prefix}-mac.yml`,
    `${prefix}.yml`,
    `Pythinker-${version}-arm64.dmg`,
    `Pythinker-${version}-arm64-mac.zip`,
    `Pythinker-${version}-x64-Setup.exe`,
  ];
}

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

function fixtureFetch({
  cliAssets = expectedCliAssets,
  nightlyAssets = desktopAssets(desktopNightlyVersion, 'nightly'),
} = {}) {
  return async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'registry.npmjs.org') return json({ latest: '1.3.0' });
    if (url.hostname === 'code.pythinker.com') {
      return json({
        version: '1.3.0',
        platforms: Object.fromEntries(nativeTargets.map((target) => [target, {}])),
      });
    }
    if (url.hostname === 'api.github.com' && url.pathname.startsWith('/repos/PyModel/pythinker-code/releases/tags/')) {
      return json({
        tag_name: '@pymodel/pythinker-code@1.3.0',
        assets: cliAssets.map((name) => ({ name })),
      });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/PyModel/pythinker-desktop-releases/releases/latest') {
      return json({
        tag_name: 'v0.2.1',
        assets: desktopAssets('0.2.1', 'stable').map((name) => ({ name })),
      });
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/repos/PyModel/pythinker-desktop-releases/releases') {
      return json([
        {
          tag_name: `v${desktopNightlyVersion}`,
          draft: false,
          prerelease: true,
          assets: nightlyAssets.map((name) => ({ name })),
        },
        {
          tag_name: 'v0.2.2-beta.1',
          draft: false,
          prerelease: true,
          assets: desktopAssets('0.2.2-beta.1', 'beta').map((name) => ({ name })),
        },
      ]);
    }
    if (url.hostname === 'open-vsx.org') {
      return json({
        version: '0.9.5',
        downloads: Object.fromEntries(nativeTargets.map((target) => [target, `https://${target}`])),
      });
    }
    if (url.hostname === 'marketplace.visualstudio.com') {
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

void test('fixture routing rejects trusted hostnames outside the URL host', async () => {
  const response = await fixtureFetch()(
    'https://example.test/registry.npmjs.org/code.pythinker.com/open-vsx.org/marketplace.visualstudio.com',
  );

  assert.equal(response.status, 404);
});

void test('reports all live release lanes aligned', async (t) => {
  const rootDir = await fixtureRoot(t);
  const result = await collectReleaseStatus({
    rootDir,
    desktopCommitCount,
    fetchImpl: fixtureFetch(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows.every((row) => row.ok), true);
  assert.match(renderReleaseStatus(result), /\| npm CLI \| 1\.3\.0 \| 1\.3\.0 \| PASS \|/u);
  assert.match(renderReleaseStatus(result), /\| Desktop Nightly \| 0\.2\.2-nightly\.4102 \| 0\.2\.2-nightly\.4102 \| PASS \|/u);
});

void test('fails when a published CLI release is missing one required asset', async (t) => {
  const rootDir = await fixtureRoot(t);
  const result = await collectReleaseStatus({
    rootDir,
    desktopCommitCount,
    fetchImpl: fixtureFetch({ cliAssets: expectedCliAssets.filter((name) => name !== 'manifest.json') }),
  });

  assert.equal(result.ok, false);
  const cli = result.rows.find((row) => row.lane === 'npm CLI');
  assert.equal(cli?.ok, false);
  assert.match(cli?.details ?? '', /missing manifest\.json/u);
});

void test('fails when the current desktop Nightly release is incomplete', async (t) => {
  const rootDir = await fixtureRoot(t);
  const result = await collectReleaseStatus({
    rootDir,
    desktopCommitCount,
    fetchImpl: fixtureFetch({
      nightlyAssets: desktopAssets(desktopNightlyVersion, 'nightly')
        .filter((name) => name !== 'nightly-mac.yml'),
    }),
  });

  assert.equal(result.ok, false);
  const nightly = result.rows.find((row) => row.lane === 'Desktop Nightly');
  assert.equal(nightly?.ok, false);
  assert.match(nightly?.details ?? '', /missing nightly-mac\.yml/u);
});
