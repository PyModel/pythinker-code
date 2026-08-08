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

/** Numeric major/minor/patch compare over two RELEASE_SEMVER matches. */
export function compareRelease(left, right) {
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index]);
    if (diff !== 0) return diff;
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
 */
export async function pollCdnUntilCaughtUp(options) {
  const { fetchImpl, sleep, now, url, npmLatest, budgetMs, intervalMs } = options;
  const deadline = now() + budgetMs;
  let cdnVersion = null;
  let attempts = 0;

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

    if (classification === 'match') return { ok: true, reason: 'match', cdnVersion, attempts };
    if (classification === 'ahead') return { ok: false, reason: 'ahead', cdnVersion, attempts };

    // Stop before a sleep that would run past the budget rather than after it.
    if (now() + intervalMs >= deadline) {
      return { ok: false, reason: 'timeout', cdnVersion, attempts };
    }
    await sleep(intervalMs);
  }
}
