import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PACKAGE_NAME = '@pythoughts/pythinker-code';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

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

console.log(`consistency OK: latest=${distTags.latest} beta=${distTags.beta ?? '-'} dev=${distTags.dev ?? '-'}`);
