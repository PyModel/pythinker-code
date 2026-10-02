/**
 * Pure CDN-versus-npm consistency logic for the release gate.
 *
 * The CDN manifest is built from npm's dist-tag, but the site rebuild is
 * triggered by the push that *starts* the release — several minutes before the
 * publish that moves the dist-tag. The first build therefore advertises the
 * previous version and nothing rebuilds it on its own, so the release stays
 * invisible to every installed client. The pipeline fires a redeploy after the
 * publish and then polls here until the manifest catches up.
 *
 * Everything is dependency-injected (fetch, sleep, clock) so the gate is unit
 * testable without a network or a real wait.
 */

/** Stable release semver. The CDN manifest never advertises a prerelease. */
const RELEASE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/**
 * Numeric major/minor/patch compare over two RELEASE_SEMVER matches.
 *
 * BigInt rather than Number: semver puts no ceiling on an identifier, and two
 * distinct versions past 2^53 would round to the same float and compare equal —
 * reporting a stale or impossible CDN as a match.
 */
export function compareRelease(left, right) {
  for (let index = 1; index <= 3; index += 1) {
    const a = BigInt(left[index]);
    const b = BigInt(right[index]);
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * Where the CDN sits relative to the npm dist-tag.
 *
 * 'ahead' means clients would be pointed at a release that does not exist;
 * 'behind' is ordinary deploy lag; 'invalid' means the manifest is unusable.
 */
export function classifyCdnVersion(cdnVersion, npmLatest) {
  const cdnMatch = typeof cdnVersion === 'string' ? cdnVersion.match(RELEASE_SEMVER) : null;
  const npmMatch = typeof npmLatest === 'string' ? npmLatest.match(RELEASE_SEMVER) : null;
  if (cdnMatch === null || npmMatch === null) return 'invalid';
  const diff = compareRelease(cdnMatch, npmMatch);
  if (diff === 0) return 'match';
  return diff > 0 ? 'ahead' : 'behind';
}

/**
 * Read the version the CDN manifest currently advertises.
 *
 * Throws on transport, status and parse failures alike; the caller treats all
 * three the same way, so they are deliberately not distinguished here.
 */
async function readCdnVersion(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = JSON.parse(await response.text());
  return typeof body.version === 'string' ? body.version : null;
}

/**
 * Poll the CDN manifest until it advertises `npmLatest`.
 *
 * A fetch failure, a non-ok status and an unparseable manifest are all treated
 * exactly like 'behind': mid-deploy the origin is legitimately unreachable or
 * half-written, and both that and plain lag resolve by waiting, so only the
 * budget decides. 'ahead' returns at once — more waiting cannot fix a manifest
 * that names a release npm does not have.
 *
 * A periodic re-trigger heals a lost deploy request. This poll is the only
 * pipeline stage that both knows the CDN is still behind and is still running.
 */
export async function pollCdnUntilCaughtUp(options) {
  const { fetchImpl, sleep, now, url, npmLatest, budgetMs, intervalMs, retrigger, retriggerEveryAttempts } = options;
  const deadline = now() + budgetMs;
  let cdnVersion = null;
  let attempts = 0;
  let retriggers = 0;

  for (;;) {
    attempts += 1;
    let classification = 'unreachable';
    try {
      const observed = await readCdnVersion(fetchImpl, url);
      if (observed !== null) {
        cdnVersion = observed;
        classification = classifyCdnVersion(observed, npmLatest);
      }
    } catch {
      // Deliberately swallowed: an unreachable CDN is lag, not a gate failure.
    }

    if (classification === 'match') return { ok: true, reason: 'match', cdnVersion, attempts, retriggers };
    if (classification === 'ahead') return { ok: false, reason: 'ahead', cdnVersion, attempts, retriggers };

    // Stop before a sleep that would run past the budget rather than after it.
    if (now() + intervalMs >= deadline) {
      return { ok: false, reason: 'timeout', cdnVersion, attempts, retriggers };
    }
    if (
      typeof retrigger === 'function' &&
      Number.isInteger(retriggerEveryAttempts) &&
      retriggerEveryAttempts > 0 &&
      attempts % retriggerEveryAttempts === 0
    ) {
      retriggers += 1;
      try {
        await retrigger();
      } catch {
        // Deliberately swallowed: a failed trigger is lag, not a gate failure.
      }
    }
    await sleep(intervalMs);
  }
}

/**
 * Every download URL a client can be sent to for `version`: each
 * `platforms[*].url` in the CDN `latest.json`, plus every file the release
 * `manifest.json` names, resolved against the release asset base.
 *
 * A matching version string proves nothing about these: 2.3.0 through 2.4.1
 * shipped with the CDN in sync while every bare-binary URL returned 404.
 */
export function collectReleaseDownloadUrls({ latestJson, releaseManifest, releaseAssetUrl }) {
  const urls = new Set();
  for (const entry of Object.values(latestJson?.platforms ?? {})) {
    if (typeof entry?.url === 'string') urls.add(entry.url);
  }
  for (const entry of Object.values(releaseManifest?.platforms ?? {})) {
    for (const name of [entry?.filename, entry?.compressed?.filename, entry?.zstd?.file]) {
      if (typeof name === 'string') urls.add(releaseAssetUrl(name));
    }
  }
  return [...urls].sort((left, right) => left.localeCompare(right));
}

/**
 * HEAD each URL and return the ones that do not answer 2xx. A transport error,
 * 5xx, 403 or 429 (GitHub rate limiting) is retried `attempts` times in total;
 * any other 4xx is final at once.
 */
export async function findUnreachableUrls({ fetchImpl, sleep, urls, attempts = 3, retryDelayMs = 5_000 }) {
  const unreachable = [];
  for (const url of urls) {
    let status = 'unreachable';
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(url, { method: 'HEAD' });
        status = response.status;
        if (response.ok || (status >= 400 && status < 500 && status !== 403 && status !== 429)) break;
      } catch (error) {
        status = error instanceof Error ? error.message : 'unreachable';
      }
      if (attempt < attempts) await sleep(retryDelayMs);
    }
    if (typeof status !== 'number' || status < 200 || status >= 300) unreachable.push({ url, status });
  }
  return unreachable;
}
