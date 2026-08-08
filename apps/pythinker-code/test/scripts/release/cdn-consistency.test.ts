import { describe, expect, it } from 'vitest';

import {
  classifyCdnVersion,
  compareRelease,
  pollCdnUntilCaughtUp,
} from '../../../../../scripts/release/cdn-consistency.mjs';

const URL = 'https://cdn.example/latest.json';

/** Response stub shaped like the subset of `fetch` the poll actually reads. */
function manifest(version: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify({ version }),
  };
}

/**
 * Fake clock and sleep: `sleep` advances the clock instead of waiting, so a
 * ten-minute budget resolves instantly and the test asserts real elapsed logic.
 */
function fakeClock() {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

/** Serve one scripted outcome per attempt. */
function scriptedFetch(steps: readonly (() => unknown)[]) {
  let index = 0;
  return async () => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    return step?.();
  };
}

describe('compareRelease', () => {
  it('orders by major, then minor, then patch', () => {
    const parse = (value: string) => /^(\d+)\.(\d+)\.(\d+)$/u.exec(value) as RegExpExecArray;
    expect(compareRelease(parse('1.0.0'), parse('0.9.9'))).toBeGreaterThan(0);
    expect(compareRelease(parse('0.13.0'), parse('0.12.0'))).toBeGreaterThan(0);
    expect(compareRelease(parse('0.12.1'), parse('0.12.2'))).toBeLessThan(0);
    expect(compareRelease(parse('0.12.0'), parse('0.12.0'))).toBe(0);
  });
});

describe('classifyCdnVersion', () => {
  it('reports an equal version as a match', () => {
    expect(classifyCdnVersion('0.13.0', '0.13.0')).toBe('match');
  });

  it('reports an older CDN version as behind', () => {
    expect(classifyCdnVersion('0.12.0', '0.13.0')).toBe('behind');
    expect(classifyCdnVersion('0.13.0', '1.0.0')).toBe('behind');
  });

  it('reports a newer CDN version as ahead', () => {
    expect(classifyCdnVersion('0.14.0', '0.13.0')).toBe('ahead');
  });

  it('rejects anything that is not a stable release version', () => {
    expect(classifyCdnVersion('not-a-version', '0.13.0')).toBe('invalid');
    expect(classifyCdnVersion('0.13.0-beta.1', '0.13.0')).toBe('invalid');
    expect(classifyCdnVersion('', '0.13.0')).toBe('invalid');
    expect(classifyCdnVersion(undefined, '0.13.0')).toBe('invalid');
  });
});

describe('pollCdnUntilCaughtUp', () => {
  const base = { url: URL, npmLatest: '0.13.0', budgetMs: 600_000, intervalMs: 15_000 };

  it('resolves on the first attempt when the CDN already matches', async () => {
    const { now, sleep } = fakeClock();
    const result = await pollCdnUntilCaughtUp({
      ...base,
      now,
      sleep,
      fetchImpl: scriptedFetch([() => manifest('0.13.0')]),
    });

    expect(result).toMatchObject({ ok: true, reason: 'match', cdnVersion: '0.13.0', attempts: 1 });
  });

  it('keeps polling while the CDN is behind and succeeds once it catches up', async () => {
    const { now, sleep } = fakeClock();
    const result = await pollCdnUntilCaughtUp({
      ...base,
      now,
      sleep,
      fetchImpl: scriptedFetch([
        () => manifest('0.12.0'),
        () => manifest('0.12.0'),
        () => manifest('0.13.0'),
      ]),
    });

    expect(result).toMatchObject({ ok: true, reason: 'match', attempts: 3 });
  });

  it('treats an unreachable CDN as lag rather than a failure', async () => {
    const { now, sleep } = fakeClock();
    const result = await pollCdnUntilCaughtUp({
      ...base,
      now,
      sleep,
      fetchImpl: scriptedFetch([
        () => {
          throw new Error('ECONNREFUSED');
        },
        () => manifest('0.13.0', false, 502),
        () => ({ ok: true, status: 200, text: async () => 'not json' }),
        () => manifest('0.13.0'),
      ]),
    });

    expect(result).toMatchObject({ ok: true, reason: 'match', attempts: 4 });
  });

  it('fails immediately when the CDN is ahead of npm', async () => {
    const { now, sleep } = fakeClock();
    const result = await pollCdnUntilCaughtUp({
      ...base,
      now,
      sleep,
      fetchImpl: scriptedFetch([() => manifest('0.14.0')]),
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'ahead',
      cdnVersion: '0.14.0',
      attempts: 1,
    });
  });

  it('gives up with the last observed version once the budget expires', async () => {
    const { now, sleep } = fakeClock();
    const result = await pollCdnUntilCaughtUp({
      ...base,
      budgetMs: 45_000,
      now,
      sleep,
      fetchImpl: scriptedFetch([() => manifest('0.12.0')]),
    });

    expect(result).toMatchObject({ ok: false, reason: 'timeout', cdnVersion: '0.12.0' });
    expect(result.attempts).toBe(3);
  });

  it('reports a null version when the CDN was never readable', async () => {
    const { now, sleep } = fakeClock();
    const result = await pollCdnUntilCaughtUp({
      ...base,
      budgetMs: 15_000,
      now,
      sleep,
      fetchImpl: scriptedFetch([
        () => {
          throw new Error('ENOTFOUND');
        },
      ]),
    });

    expect(result).toMatchObject({ ok: false, reason: 'timeout', cdnVersion: null });
  });
});
