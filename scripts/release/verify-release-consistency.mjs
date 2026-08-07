import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PACKAGE_NAME = '@pythoughts/pythinker-code';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const CDN_MANIFEST_URL = 'https://code.pythinker.com/pythinker-code/latest.json';

function fail(reason) {
  console.error(`consistency failed: ${reason}`);
  process.exit(1);
}

/** Numeric major/minor/patch compare over two SEMVER regex matches. */
function compareRelease(left, right) {
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(left[index]) - Number(right[index]);
    if (diff !== 0) return diff;
  }
  return 0;
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

// The CDN manifest is what every installed client polls for updates, so a
// version it advertises that npm does not have sends all of them into an install
// that cannot succeed. Ahead of npm is a hard failure; behind is deploy lag,
// since the site rebuilds on the next push to main.
let cdnVersion;
try {
  const response = await fetch(CDN_MANIFEST_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  cdnVersion = JSON.parse(await response.text()).version;
} catch (error) {
  console.warn(`warning: cannot read the CDN manifest (${error.message}) — CDN check skipped`);
}

if (typeof cdnVersion === 'string' && cdnVersion !== distTags.latest) {
  const cdnMatch = cdnVersion.match(SEMVER);
  if (!cdnMatch) fail(`CDN manifest version is not semver: ${cdnVersion}`);
  if (compareRelease(cdnMatch, latestMatch) > 0) {
    fail(
      `CDN advertises ${cdnVersion} but npm latest is ${distTags.latest} — ` +
        'clients would try to install a release that does not exist',
    );
  }
  console.log(
    `CDN is behind npm (cdn=${cdnVersion} latest=${distTags.latest}); it catches up on the next push to main`,
  );
}

console.log(`consistency OK: latest=${distTags.latest} beta=${distTags.beta ?? '-'} dev=${distTags.dev ?? '-'}`);
