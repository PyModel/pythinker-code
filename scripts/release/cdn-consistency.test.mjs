import assert from 'node:assert/strict';
import test from 'node:test';

import { collectReleaseDownloadUrls, findUnreachableUrls } from './cdn-consistency.mjs';

const BASE = 'https://github.com/PyModel/pythinker-code/releases/download/%40pymodel%2Fpythinker-code%402.4.1';
const releaseAssetUrl = (name) => `${BASE}/${name}`;

void test('collects latest.json urls and every file the release manifest names', () => {
  const urls = collectReleaseDownloadUrls({
    latestJson: {
      version: '2.4.1',
      platforms: { 'darwin-arm64': { url: `${BASE}/pythinker-code-darwin-arm64`, sha256: 'a' } },
    },
    releaseManifest: {
      platforms: {
        'darwin-arm64': {
          filename: 'pythinker-code-darwin-arm64',
          compressed: { filename: 'pythinker-code-darwin-arm64.zst' },
        },
        'win32-x64': { filename: 'pythinker-code-win32-x64.exe', zstd: { file: 'pythinker-code-win32-x64.zst' } },
      },
    },
    releaseAssetUrl,
  });
  assert.deepEqual(urls, [
    `${BASE}/pythinker-code-darwin-arm64`,
    `${BASE}/pythinker-code-darwin-arm64.zst`,
    `${BASE}/pythinker-code-win32-x64.exe`,
    `${BASE}/pythinker-code-win32-x64.zst`,
  ]);
});

void test('collects nothing from manifests without platforms', () => {
  assert.deepEqual(collectReleaseDownloadUrls({ latestJson: {}, releaseManifest: {}, releaseAssetUrl }), []);
});

void test('reports a 404 at once and passes a 200', async () => {
  const calls = [];
  const unreachable = await findUnreachableUrls({
    fetchImpl: async (url, init) => {
      calls.push([url, init.method]);
      return new Response(null, { status: url.endsWith('.zst') ? 200 : 404 });
    },
    sleep: async () => {},
    urls: ['a.zst', 'a'],
  });
  assert.deepEqual(unreachable, [{ url: 'a', status: 404 }]);
  assert.deepEqual(calls, [
    ['a.zst', 'HEAD'],
    ['a', 'HEAD'],
  ]);
});

void test('retries transport errors and 5xx, then reports the last failure', async () => {
  let calls = 0;
  const sleeps = [];
  const unreachable = await findUnreachableUrls({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket hang up');
      return new Response(null, { status: 503 });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    urls: ['a'],
    attempts: 3,
    retryDelayMs: 10,
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 10]);
  assert.deepEqual(unreachable, [{ url: 'a', status: 503 }]);
});

void test('recovers when a retry succeeds', async () => {
  let calls = 0;
  const unreachable = await findUnreachableUrls({
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? 502 : 200 });
    },
    sleep: async () => {},
    urls: ['a'],
  });
  assert.deepEqual(unreachable, []);
  assert.equal(calls, 2);
});

void test('retries a rate-limited 429 instead of reporting it at once', async () => {
  let calls = 0;
  const unreachable = await findUnreachableUrls({
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: calls === 1 ? 429 : 200 });
    },
    sleep: async () => {},
    urls: ['a'],
  });
  assert.deepEqual(unreachable, []);
  assert.equal(calls, 2);
});
