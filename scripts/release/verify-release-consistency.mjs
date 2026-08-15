import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { pollCdnUntilCaughtUp } from './cdn-consistency.mjs';

const PACKAGE_NAME = '@pymodel/pythinker-code';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const CDN_MANIFEST_URL = 'https://code.pythinker.com/pythinker-code/latest.json';

// The budget covers detecting a lost trigger and completing a fresh rebuild,
// while staying under the job timeout so this gate can report a stale CDN.
const CDN_POLL_BUDGET_MS = 900_000;
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

const webhook = process.env.DOKPLOY_CDN_DEPLOY_WEBHOOK;
let retrigger;
if (typeof webhook === 'string' && webhook.length > 0) {
  let isUsable;
  try {
    const url = new URL(webhook);
    isUsable = url.protocol === 'https:' && url.host.length > 0;
  } catch {
    isUsable = false;
  }
  if (isUsable) {
    retrigger = async () => {
      try {
        const response = await fetch(webhook, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-GitHub-Event': 'push',
          },
          body: '{"ref":"refs/heads/main"}',
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        console.log(`CDN rebuild request returned HTTP ${response.status}`);
      } catch (error) {
        const message = error instanceof Error ? error.message.replaceAll(webhook, '***') : 'unknown error';
        console.error(`CDN rebuild request failed: ${message}`);
        throw error;
      }
    };
  } else {
    console.error('warning: DOKPLOY_CDN_DEPLOY_WEBHOOK is not an https:// URL; CDN rebuild requests are disabled');
  }
}

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
  retrigger,
  retriggerEveryAttempts: 8,
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
      `${cdnPoll.attempts} attempt(s), ${cdnPoll.retriggers} rebuild request(s)) — ` +
      'every installed client polls this manifest, ' +
      'so the release stays invisible until the site rebuilds',
  );
}

console.log(
  `CDN matches npm (${cdnPoll.cdnVersion}) after ${cdnPoll.attempts} attempt(s), ` +
    `${cdnPoll.retriggers} rebuild request(s)`,
);

console.log(`consistency OK: latest=${distTags.latest} beta=${distTags.beta ?? '-'} dev=${distTags.dev ?? '-'}`);
