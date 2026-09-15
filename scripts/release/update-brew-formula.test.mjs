import assert from 'node:assert/strict';
import test from 'node:test';

import { downloadNpmTarball } from './update-brew-formula.mjs';

const TARBALL_URL = 'https://registry.npmjs.org/@pymodel/pythinker-code/-/pythinker-code-2.0.0.tgz';
const BODY = Buffer.from('pythinker-tarball');

function response(status, body = BODY) {
  return new Response(body, { status });
}

function pollClock() {
  let now = 0;
  const sleeps = [];
  return {
    now: () => now,
    sleeps,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    log() {},
  };
}

void test('returns the tarball when the first fetch is HTTP 200', async () => {
  const clock = pollClock();
  let fetches = 0;
  const result = await downloadNpmTarball({
    url: TARBALL_URL,
    fetchImpl: async () => {
      fetches += 1;
      return response(200);
    },
    sleep: clock.sleep,
    now: clock.now,
    log: clock.log,
    budgetMs: 45_000,
    intervalMs: 15_000,
  });

  assert.equal(fetches, 1);
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.tarball, BODY);
  assert.deepEqual(clock.sleeps, []);
});

void test('retries after HTTP 404 and returns the tarball once npm serves it', async () => {
  const clock = pollClock();
  const statuses = [404, 404, 200];
  const result = await downloadNpmTarball({
    url: TARBALL_URL,
    fetchImpl: async () => response(statuses.shift() ?? 500),
    sleep: clock.sleep,
    now: clock.now,
    log: clock.log,
    budgetMs: 45_000,
    intervalMs: 15_000,
  });

  assert.equal(result.attempts, 3);
  assert.deepEqual(result.tarball, BODY);
  assert.deepEqual(clock.sleeps, [15_000, 15_000]);
});

void test('retries an empty 200 body until a non-empty tarball arrives', async () => {
  const clock = pollClock();
  const bodies = [Buffer.alloc(0), BODY];
  const result = await downloadNpmTarball({
    url: TARBALL_URL,
    fetchImpl: async () => response(200, bodies.shift() ?? BODY),
    sleep: clock.sleep,
    now: clock.now,
    log: clock.log,
    budgetMs: 45_000,
    intervalMs: 15_000,
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(result.tarball, BODY);
  assert.deepEqual(clock.sleeps, [15_000]);
});

void test('throws after the budget when every fetch is HTTP 404', async () => {
  const clock = pollClock();
  let fetches = 0;
  await assert.rejects(
    () =>
      downloadNpmTarball({
        url: TARBALL_URL,
        fetchImpl: async () => {
          fetches += 1;
          return response(404);
        },
        sleep: clock.sleep,
        now: clock.now,
        log: clock.log,
        budgetMs: 45_000,
        intervalMs: 15_000,
      }),
    { message: 'Failed to download npm tarball: HTTP 404 after 3 attempt(s)' },
  );
  assert.equal(fetches, 3);
  assert.deepEqual(clock.sleeps, [15_000, 15_000]);
});
