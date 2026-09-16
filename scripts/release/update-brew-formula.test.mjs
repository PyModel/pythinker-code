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
  const result = await downloadNpmTarball(
    pollOptions(clock, async () => {
      fetches += 1;
      return response(200);
    }),
  );

  assert.equal(fetches, 1);
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.tarball, BODY);
  assert.deepEqual(clock.sleeps, []);
});

void test('retries after HTTP 404 and returns the tarball once npm serves it', async () => {
  const clock = pollClock();
  const statuses = [404, 404, 200];
  const result = await downloadNpmTarball(
    pollOptions(clock, async () => response(statuses.shift() ?? 500)),
  );

  assert.equal(result.attempts, 3);
  assert.deepEqual(result.tarball, BODY);
  assert.deepEqual(clock.sleeps, [15_000, 15_000]);
});

void test('retries an empty 200 body until a non-empty tarball arrives', async () => {
  const clock = pollClock();
  const bodies = [Buffer.alloc(0), BODY];
  const result = await downloadNpmTarball(
    pollOptions(clock, async () => response(200, bodies.shift() ?? BODY)),
  );

  assert.equal(result.attempts, 2);
  assert.deepEqual(result.tarball, BODY);
  assert.deepEqual(clock.sleeps, [15_000]);
});

void test('throws after the budget when every fetch is HTTP 404', async () => {
  const clock = pollClock();
  let fetches = 0;
  await assert.rejects(
    () =>
      downloadNpmTarball(
        pollOptions(clock, async () => {
          fetches += 1;
          return response(404);
        }),
      ),
    { message: 'Failed to download npm tarball: HTTP 404 after 4 attempt(s)' },
  );
  assert.equal(fetches, 4);
  assert.deepEqual(clock.sleeps, [15_000, 15_000, 15_000]);
});

void test('sleeps the leftover budget then fetches again before giving up', async () => {
  const clock = pollClock();
  const statuses = [404, 404, 404, 200];
  const result = await downloadNpmTarball({
    ...pollOptions(clock, async () => response(statuses.shift() ?? 500)),
    budgetMs: 40_000,
  });
  assert.equal(result.attempts, 4);
  assert.deepEqual(result.tarball, BODY);
  assert.deepEqual(clock.sleeps, [15_000, 15_000, 10_000]);
});
