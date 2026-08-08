import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { pollCdnUntilCaughtUp } from './cdn-consistency.mjs';

const PACKAGE_NAME = '@pythoughts/pythinker-code';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const CDN_MANIFEST_URL = 'https://code.pythinker.com/pythinker-code/latest.json';

// A Dokploy rebuild serves the new manifest in roughly two minutes. The budget
// stays well under the job's own timeout-minutes so a stale CDN is reported
// here rather than killed by the runner.
const CDN_POLL_BUDGET_MS = 600_000;
const CDN_POLL_INTERVAL_MS = 15_000;

function fail(reason) {
  console.error(`consistency failed: ${reason}`);
  process.exit(1);
}

let localVersion;
let distTags;

try {
  localVersion = JSON.parse(readFileSync('apps/pythinker-code/package.json', 'utf8')).version;
} catch (error) {
  fail(`cannot read local version: ${error.message}`);
}

try {
  distTags = JSON.parse(execFileSync('npm', ['view', PACKAGE_NAME, 'dist-tags', '--json'], {
    encoding: 'utf8',
    timeout: 30_000,
  }));
} catch (error) {
  fail(`cannot read npm dist-tags: ${error.message}`);
}

const latestMatch = typeof distTags.latest === 'string' ? distTags.latest.match(SEMVER) : null;
if (!latestMatch || latestMatch[4]) fail(`latest is not stable semver: ${distTags.latest ?? '-'}`);
if (localVersion !== distTags.latest) fail(`local version ${localVersion ?? '-'} does not match latest ${distTags.latest}`);

if (distTags.beta) {
  const betaMatch = typeof distTags.beta === 'string' ? distTags.beta.match(SEMVER) : null;
  if (!betaMatch?.[4] || !distTags.beta.includes('-beta.')) fail(`beta is not a beta prerelease: ${distTags.beta}`);
}

if (distTags.dev && (typeof distTags.dev !== 'string' || !distTags.dev.includes('-dev-'))) {
  fail(`dev is not a dev snapshot: ${distTags.dev}`);
}

const releaseTag = `${PACKAGE_NAME}@${distTags.latest}`;
let gitTags;
try {
  gitTags = execFileSync('git', ['tag', '-l', releaseTag], { encoding: 'utf8' });
} catch (error) {
  fail(`cannot read git tags: ${error.message}`);
}
if (!gitTags.trim().split('\n').includes(releaseTag)) fail(`missing git tag ${releaseTag}`);

// The CDN manifest is what every installed client polls for updates. A version
// it advertises that npm does not have sends all of them into an install that
// cannot succeed; a version it never catches up to hides the release entirely.
// The pipeline triggers a rebuild before this job, so both are hard failures —
// waiting it out is the whole point of the poll.
const cdnPoll = await pollCdnUntilCaughtUp({
  fetchImpl: (url) => fetch(url, { signal: AbortSignal.timeout(15_000) }),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  now: () => Date.now(),
  url: CDN_MANIFEST_URL,
  npmLatest: distTags.latest,
  budgetMs: CDN_POLL_BUDGET_MS,
  intervalMs: CDN_POLL_INTERVAL_MS,
});

if (cdnPoll.reason === 'ahead') {
  fail(
    `CDN advertises ${cdnPoll.cdnVersion} but npm latest is ${distTags.latest} — ` +
      'clients would try to install a release that does not exist',
  );
}
if (!cdnPoll.ok) {
  fail(
    `CDN never caught up with npm within ${CDN_POLL_BUDGET_MS / 1000}s ` +
      `(cdn=${cdnPoll.cdnVersion ?? 'unreachable'} latest=${distTags.latest}, ` +
      `${cdnPoll.attempts} attempts) — every installed client polls this manifest, ` +
      'so the release stays invisible until the site rebuilds',
  );
}

console.log(`CDN matches npm (${cdnPoll.cdnVersion}) after ${cdnPoll.attempts} attempt(s)`);

console.log(`consistency OK: latest=${distTags.latest} beta=${distTags.beta ?? '-'} dev=${distTags.dev ?? '-'}`);
