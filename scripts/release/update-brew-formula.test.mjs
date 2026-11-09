import assert from 'node:assert/strict';
import test from 'node:test';

import { BREW_TARGETS, downloadWhenAvailable, nativeTarballUrl, renderFormula } from './update-brew-formula.mjs';

const TARBALL_URL = nativeTarballUrl('2.0.0', 'darwin-arm64');
const BODY = Buffer.from('pythinker-tarball');

function response(status, body = BODY) {
  return new Response(body, { status });
}

function pollClock() {
  let now = 0;
  const sleeps = [];
  const sleep = async (ms) => {
    sleeps.push(ms);
    now += ms;
  };
  return {
    now: () => now,
    sleeps,
    sleep,
  };
}

function pollOptions(clock, fetchImpl) {
  return {
    url: TARBALL_URL,
    fetchImpl,
    sleep: (ms) => clock.sleep(ms),
    now: () => clock.now(),
    log: () => {},
    budgetMs: 45_000,
    intervalMs: 15_000,
  };
}

void test('returns the tarball when the first fetch is HTTP 200', async () => {
  const clock = pollClock();
  let fetches = 0;
  const result = await downloadWhenAvailable(
    pollOptions(clock, async () => {
      fetches += 1;
      return response(200);
    }),
  );

  assert.equal(fetches, 1);
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.body, BODY);
  assert.deepEqual(clock.sleeps, []);
});

void test('retries after HTTP 404 and returns the tarball once the release serves it', async () => {
  const clock = pollClock();
  const statuses = [404, 404, 200];
  const result = await downloadWhenAvailable(
    pollOptions(clock, async () => response(statuses.shift() ?? 500)),
  );

  assert.equal(result.attempts, 3);
  assert.deepEqual(result.body, BODY);
  assert.deepEqual(clock.sleeps, [15_000, 15_000]);
});

void test('retries an empty 200 body until a non-empty tarball arrives', async () => {
  const clock = pollClock();
  const bodies = [Buffer.alloc(0), BODY];
  const result = await downloadWhenAvailable(
    pollOptions(clock, async () => response(200, bodies.shift() ?? BODY)),
  );

  assert.equal(result.attempts, 2);
  assert.deepEqual(result.body, BODY);
  assert.deepEqual(clock.sleeps, [15_000]);
});

void test('throws after the budget when every fetch is HTTP 404', async () => {
  const clock = pollClock();
  let fetches = 0;
  await assert.rejects(
    () =>
      downloadWhenAvailable(
        pollOptions(clock, async () => {
          fetches += 1;
          return response(404);
        }),
      ),
    { message: `Failed to download ${TARBALL_URL}: HTTP 404 after 4 attempt(s)` },
  );
  assert.equal(fetches, 4);
  assert.deepEqual(clock.sleeps, [15_000, 15_000, 15_000]);
});

void test('sleeps the leftover budget then fetches again before giving up', async () => {
  const clock = pollClock();
  const statuses = [404, 404, 404, 200];
  const result = await downloadWhenAvailable({
    ...pollOptions(clock, async () => response(statuses.shift() ?? 500)),
    budgetMs: 40_000,
  });
  assert.equal(result.attempts, 4);
  assert.deepEqual(result.body, BODY);
  assert.deepEqual(clock.sleeps, [15_000, 15_000, 10_000]);
});

void test('nativeTarballUrl encodes the release tag', () => {
  assert.equal(
    nativeTarballUrl('2.5.0', 'linux-x64'),
    'https://github.com/PyModel/pythinker-code/releases/download/%40pymodel%2Fpythinker-code%402.5.0/pythinker-code-linux-x64.tar.gz',
  );
});

function allAssets(version) {
  const assets = {};
  for (const [index, target] of Object.values(BREW_TARGETS).entries()) {
    assets[target] = { url: nativeTarballUrl(version, target), sha256: String(index).repeat(64) };
  }
  return assets;
}

void test('renderFormula pins one native tarball per macOS and Linux CPU branch', () => {
  const formula = renderFormula({ version: '2.5.0', assets: allAssets('2.5.0') });
  assert.match(formula, /^  version "2\.5\.0"$/mu);
  assert.doesNotMatch(formula, /depends_on "node"/u);
  assert.match(formula, /bin\.install "pythinker"/u);
  assert.match(formula, /assert_equal version\.to_s, shell_output\("#\{bin\}\/pythinker --version"\)\.strip/u);
  const pairs = [...formula.matchAll(/url "([^"]+)"\n\s+sha256 "([a-f0-9]{64})"/gu)].map(([, url, sha]) => [url, sha]);
  assert.deepEqual(pairs, [
    [nativeTarballUrl('2.5.0', 'darwin-arm64'), '0'.repeat(64)],
    [nativeTarballUrl('2.5.0', 'darwin-x64'), '1'.repeat(64)],
    [nativeTarballUrl('2.5.0', 'linux-arm64'), '2'.repeat(64)],
    [nativeTarballUrl('2.5.0', 'linux-x64'), '3'.repeat(64)],
  ]);
  const macos = formula.slice(formula.indexOf('on_macos do'), formula.indexOf('on_linux do'));
  assert.ok(macos.indexOf('darwin-arm64') < macos.indexOf('else'));
  assert.ok(macos.indexOf('darwin-x64') > macos.indexOf('else'));
});

void test('renderFormula refuses a missing platform or a malformed checksum', () => {
  const assets = allAssets('2.5.0');
  delete assets['linux-arm64'];
  assert.throws(() => renderFormula({ version: '2.5.0', assets }), /missing Homebrew asset for linux-arm64/u);
  assert.throws(
    () => renderFormula({ version: '2.5.0', assets: { ...allAssets('2.5.0'), 'darwin-x64': { url: 'x', sha256: 'nope' } } }),
    /invalid sha256 for darwin-x64/u,
  );
});
