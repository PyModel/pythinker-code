import { describe, expect, it, vi } from 'vitest';

import { fetchUpdateManifest, manifestArtifactAvailability } from '#/cli/update/cdn';
import { PYTHINKER_CODE_CDN_LATEST_JSON_URL } from '#/constant/app';

type Route = { readonly status?: number; readonly body?: string } | Error;

/** URL-routed fetch mock: unrouted URLs return 404. */
function mockRoutedFetch(routes: Record<string, Route>): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const route = routes[String(input)];
    if (route === undefined) {
      return { ok: false, status: 404, text: async () => '' };
    }
    if (route instanceof Error) throw route;
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => route.body ?? '',
    };
  }) as unknown as typeof fetch;
}

const MANIFEST_BODY = JSON.stringify({
  schemaVersion: 1,
  version: '2.0.0',
  publishedAt: '2026-06-12T00:00:00.000Z',
  rollout: [
    { percent: 30, delaySeconds: 0 },
    { percent: 30, delaySeconds: 43_200 },
    { percent: 40, delaySeconds: 86_400 },
  ],
});

describe('fetchUpdateManifest', () => {
  it('parses latest.json and returns the manifest', async () => {
    const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: { body: MANIFEST_BODY } });
    await expect(fetchUpdateManifest(f)).resolves.toEqual({
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [
        { percent: 30, delaySeconds: 0 },
        { percent: 30, delaySeconds: 43_200 },
        { percent: 40, delaySeconds: 86_400 },
      ],
    });
    expect(f).toHaveBeenCalledWith(
      PYTHINKER_CODE_CDN_LATEST_JSON_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown manifest fields (lenient parsing)', async () => {
    const body = JSON.stringify({
      schemaVersion: 99,
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
      futureField: { nested: true },
    });
    const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: { body } });
    const result = await fetchUpdateManifest(f);
    expect(result).toEqual({
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
    });
  });

  it('defaults a missing rollout to an empty plan (fully rolled out)', async () => {
    const body = JSON.stringify({
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
    });
    const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: { body } });
    const result = await fetchUpdateManifest(f);
    expect(result.rollout).toEqual([]);
  });

  it('drops a platforms entry with an invalid sha256 but keeps the manifest', async () => {
    const body = JSON.stringify({
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      platforms: {
        'darwin-arm64': {
          url: 'https://github.com/PyModel/pythinker-code/releases/download/%40pythoughts%2Fpythinker-code%400.9.2/pythinker-code-darwin-arm64.zip',
          sha256: 'nope',
        },
      },
    });
    const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: { body } });
    const result = await fetchUpdateManifest(f);
    expect(result.version).toBe('2.0.0');
    expect(result.platforms).toBeUndefined();
    expect(manifestArtifactAvailability(result, 'darwin-arm64')).toBe('available');
  });

  it('drops a platforms entry with a non-URL url but keeps the manifest', async () => {
    const body = JSON.stringify({
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      platforms: {
        'darwin-arm64': { url: 'not-a-url', sha256: 'a'.repeat(64) },
      },
    });
    const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: { body } });
    const result = await fetchUpdateManifest(f);
    expect(result.version).toBe('2.0.0');
    expect(result.platforms).toBeUndefined();
    expect(manifestArtifactAvailability(result, 'darwin-arm64')).toBe('available');
  });

  it('carries a well-formed minRequiredVersion onto the parsed manifest', async () => {
    const body = JSON.stringify({
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
      minRequiredVersion: '1.5.0',
    });
    const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: { body } });
    const result = await fetchUpdateManifest(f);
    expect(result.version).toBe('2.0.0');
    expect(result.minRequiredVersion).toBe('1.5.0');
  });

  it('drops a malformed minRequiredVersion but keeps the manifest', async () => {
    const body = JSON.stringify({
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
      minRequiredVersion: 'nope',
    });
    const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: { body } });
    const result = await fetchUpdateManifest(f);
    expect(result.version).toBe('2.0.0');
    expect(result.minRequiredVersion).toBeUndefined();
  });

  it('carries a well-formed platforms record onto the parsed manifest', async () => {
    const body = JSON.stringify({
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
      platforms: {
        'darwin-arm64': {
          url: 'https://github.com/PyModel/pythinker-code/releases/download/%40pythoughts%2Fpythinker-code%400.9.2/pythinker-code-darwin-arm64.zip',
          sha256: 'a'.repeat(64),
        },
        'linux-x64': {
          url: 'https://github.com/PyModel/pythinker-code/releases/download/%40pythoughts%2Fpythinker-code%400.9.2/pythinker-code-linux-x64.zip',
          sha256: 'b'.repeat(64),
        },
      },
    });
    const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: { body } });
    const result = await fetchUpdateManifest(f);
    expect(result.version).toBe('2.0.0');
    expect(result.platforms).toEqual({
      'darwin-arm64': {
        url: 'https://github.com/PyModel/pythinker-code/releases/download/%40pythoughts%2Fpythinker-code%400.9.2/pythinker-code-darwin-arm64.zip',
        sha256: 'a'.repeat(64),
      },
      'linux-x64': {
        url: 'https://github.com/PyModel/pythinker-code/releases/download/%40pythoughts%2Fpythinker-code%400.9.2/pythinker-code-linux-x64.zip',
        sha256: 'b'.repeat(64),
      },
    });
  });

  // No fallback: the plain-text `/latest` carries no per-platform artifact data,
  // so reading it after a bad manifest would report an unverifiable target as
  // verified. Every one of these must reject and leave the cached answer alone.
  const rejectCases: ReadonlyArray<readonly [string, Route, RegExp]> = [
    ['latest.json is missing (HTTP 404)', { status: 404 }, /HTTP 404/u],
    ['latest.json fetch throws', new Error('network down'), /network down/u],
    ['body is not valid JSON', { body: 'not json {' }, /JSON/iu],
    [
      'version is not semver',
      { body: JSON.stringify({ version: 'nope', publishedAt: '2026-06-12T00:00:00.000Z' }) },
      /invalid semver/u,
    ],
    [
      'publishedAt is unparseable',
      { body: JSON.stringify({ version: '2.0.0', publishedAt: 'garbage' }) },
      /invalid timestamp/u,
    ],
    [
      'a batch percent is out of range',
      {
        body: JSON.stringify({
          version: '2.0.0',
          publishedAt: '2026-06-12T00:00:00.000Z',
          rollout: [{ percent: 150, delaySeconds: 0 }],
        }),
      },
      // Name the field: `/./` matched any non-empty message, so a JSON.parse
      // failure would have satisfied it just as well as the schema rejection.
      /percent/u,
    ],
    [
      'a batch delay is negative',
      {
        body: JSON.stringify({
          version: '2.0.0',
          publishedAt: '2026-06-12T00:00:00.000Z',
          rollout: [{ percent: 100, delaySeconds: -1 }],
        }),
      },
      /delaySeconds/u,
    ],
  ];

  for (const [name, route, message] of rejectCases) {
    it(`rejects when ${name}`, async () => {
      const f = mockRoutedFetch({ [PYTHINKER_CODE_CDN_LATEST_JSON_URL]: route });
      await expect(fetchUpdateManifest(f)).rejects.toThrow(message);
    });
  }

  it('rejects when latest.json hangs past the request timeout', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(async (_input: string | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          }, { once: true });
        });
      }) as unknown as typeof fetch;

      const result = fetchUpdateManifest(f);
      const expectation = expect(result).rejects.toThrow(/aborted/u);
      await vi.advanceTimersByTimeAsync(3_000);

      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('manifestArtifactAvailability', () => {
  it('treats a null manifest as available (unknown is not a denial)', () => {
    expect(manifestArtifactAvailability(null)).toBe('available');
  });

  it('treats a manifest without platforms as available', () => {
    const manifest = {
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
    };
    expect(manifestArtifactAvailability(manifest, 'darwin-arm64')).toBe('available');
  });

  it('is available when platforms has an own entry for the target', () => {
    const manifest = {
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
      platforms: {
        'darwin-arm64': {
          url: 'https://github.com/PyModel/pythinker-code/releases/download/%40pythoughts%2Fpythinker-code%400.9.2/pythinker-code-darwin-arm64.zip',
          sha256: 'a'.repeat(64),
        },
      },
    };
    expect(manifestArtifactAvailability(manifest, 'darwin-arm64')).toBe('available');
  });

  it('is unavailable when platforms omits the target', () => {
    const manifest = {
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
      platforms: {
        'darwin-arm64': {
          url: 'https://github.com/PyModel/pythinker-code/releases/download/%40pythoughts%2Fpythinker-code%400.9.2/pythinker-code-darwin-arm64.zip',
          sha256: 'a'.repeat(64),
        },
      },
    };
    expect(manifestArtifactAvailability(manifest, 'linux-x64')).toBe('unavailable');
  });

  it('is unavailable for an empty platforms object', () => {
    const manifest = {
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
      platforms: {},
    };
    expect(manifestArtifactAvailability(manifest, 'darwin-arm64')).toBe('unavailable');
  });

  it('defaults the target to the running platform', () => {
    const manifest = {
      version: '2.0.0',
      publishedAt: '2026-06-12T00:00:00.000Z',
      rollout: [],
      platforms: {
        [`${process.platform}-${process.arch}`]: {
          url: 'https://github.com/PyModel/pythinker-code/releases/download/%40pythoughts%2Fpythinker-code%400.9.2/pythinker-code-darwin-arm64.zip',
          sha256: 'a'.repeat(64),
        },
      },
    };
    expect(manifestArtifactAvailability(manifest)).toBe('available');
  });
});
