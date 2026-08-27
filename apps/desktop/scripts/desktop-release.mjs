#!/usr/bin/env node

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const channels = new Set(['stable', 'beta', 'nightly']);
const events = new Set(['push', 'workflow_call', 'workflow_dispatch']);
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function desktopChannel(value) {
  if (typeof value !== 'string' || !channels.has(value)) {
    throw new Error('Desktop release channel must be stable, beta, or nightly.');
  }
  return value;
}

function parseDesktopVersion(value) {
  const match = typeof value === 'string' ? versionPattern.exec(value) : null;
  if (match === null) {
    throw new Error(`Invalid desktop release version: ${String(value)}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error(`Desktop release version is outside the safe integer range: ${value}`);
  }
  return { major, minor, patch, prerelease: match[4] };
}

function desktopVersion(value) {
  parseDesktopVersion(value);
  return value;
}

function versionChannel(version) {
  const prerelease = parseDesktopVersion(version).prerelease;
  if (prerelease === undefined) return 'stable';
  const channel = prerelease.split('.')[0];
  if (channel === 'beta' || channel === 'nightly') return channel;
  throw new Error(`Unsupported desktop release channel in ${version}.`);
}

export function desktopReleaseChannel(version) {
  return versionChannel(version);
}

function normalizedCommitCount(value) {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 1 || String(count) !== String(value)) {
    throw new Error(`Invalid main commit count: ${String(value)}`);
  }
  return count;
}

export function desktopManifestName(channel, platform) {
  const resolvedChannel = desktopChannel(channel);
  if (platform !== 'mac' && platform !== 'win') throw new Error(`Unsupported desktop platform: ${platform}`);
  const prefix = resolvedChannel === 'stable' ? 'latest' : resolvedChannel;
  return platform === 'mac' ? `${prefix}-mac.yml` : `${prefix}.yml`;
}

export function nightlyDesktopVersion(packageVersion, commitCount) {
  const parsed = parseDesktopVersion(packageVersion);
  const patch = parsed.prerelease === undefined ? parsed.patch + 1 : parsed.patch;
  if (!Number.isSafeInteger(patch)) throw new Error(`Cannot derive a Nightly version from ${packageVersion}.`);
  const next = `${parsed.major}.${parsed.minor}.${patch}`;
  return `${next}-nightly.${normalizedCommitCount(commitCount)}`;
}

function previewVersion(packageVersion, channel, commitCount) {
  if (channel === 'nightly') return nightlyDesktopVersion(packageVersion, commitCount);
  if (versionChannel(packageVersion) === channel) return packageVersion;
  const parsed = parseDesktopVersion(packageVersion);
  const patch = parsed.prerelease === undefined ? parsed.patch + 1 : parsed.patch;
  if (!Number.isSafeInteger(patch)) throw new Error(`Cannot derive a ${channel} version from ${packageVersion}.`);
  const next = `${parsed.major}.${parsed.minor}.${patch}`;
  if (channel === 'stable') return next;
  return `${next}-beta.${normalizedCommitCount(commitCount)}`;
}

export function resolveDesktopRelease(options) {
  if (typeof options !== 'object' || options === null) throw new Error('Desktop release options are required.');
  const eventName = options.eventName;
  if (typeof eventName !== 'string' || !events.has(eventName)) {
    throw new Error(`Unsupported desktop release event: ${String(eventName)}`);
  }
  const packageVersion = desktopVersion(options.packageVersion);
  let channel;
  let version;
  let publish;

  if (eventName === 'push') {
    channel = versionChannel(packageVersion);
    if (channel === 'nightly') {
      throw new Error('Nightly desktop releases must come from the scheduled workflow.');
    }
    version = packageVersion;
    publish = true;
    const expectedTag = `desktop-v${version}`;
    if (options.tagName !== expectedTag) {
      throw new Error(`Tag ${String(options.tagName)} does not match apps/desktop/package.json (${version}).`);
    }
  } else if (eventName === 'workflow_call') {
    if (options.publishNightly !== true) {
      throw new Error('Reusable desktop releases require explicit Nightly publishing permission.');
    }
    channel = 'nightly';
    version = nightlyDesktopVersion(packageVersion, options.commitCount);
    publish = true;
  } else {
    channel = desktopChannel(options.requestedChannel);
    version = previewVersion(packageVersion, channel, options.commitCount);
    publish = false;
  }

  return {
    channel,
    feedChannel: channel === 'stable' ? 'latest' : channel,
    macManifest: desktopManifestName(channel, 'mac'),
    prerelease: channel !== 'stable',
    publish,
    releaseTag: `v${version}`,
    version,
    winManifest: desktopManifestName(channel, 'win'),
  };
}

export function configureDesktopPackage(value, version, channel) {
  const resolvedVersion = desktopVersion(version);
  const resolvedChannel = desktopChannel(channel);
  if (versionChannel(resolvedVersion) !== resolvedChannel) {
    throw new Error(`Desktop version ${resolvedVersion} does not belong to the ${resolvedChannel} channel.`);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Desktop package metadata must be an object.');
  }
  const build = value.build;
  if (typeof build !== 'object' || build === null || Array.isArray(build)) {
    throw new Error('Desktop package build metadata must be an object.');
  }
  const publish = build.publish;
  if (!Array.isArray(publish) || publish.length === 0) {
    throw new Error('Desktop package must define a publish provider.');
  }
  const provider = publish[0];
  if (typeof provider !== 'object' || provider === null || Array.isArray(provider) || provider.provider !== 'github') {
    throw new Error('Desktop release publishing must use the GitHub provider.');
  }
  return {
    ...value,
    version: resolvedVersion,
    build: {
      ...build,
      publish: [
        {
          ...provider,
          channel: resolvedChannel === 'stable' ? 'latest' : resolvedChannel,
          releaseType: resolvedChannel === 'stable' ? 'release' : 'prerelease',
        },
        ...publish.slice(1),
      ],
    },
  };
}

const attributionPattern = /^\s*(?:\[[^\]]*\]\([^)]*\)\s*)+(?:Thanks\s+\[[^\]]*\]\([^)]*\)!\s*)?-\s*/u;

function changelogSection(changelog, version) {
  if (typeof changelog !== 'string') throw new Error('Desktop changelog must be a string.');
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => line.trim() === `## ${version}`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => line.startsWith('## '));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Users read the release body in the updater, so it carries the changelog
 * entries and nothing else. Changesets prefixes every entry with its PR link,
 * commit link, and a thanks line; those are noise in an update dialog.
 */
export function desktopReleaseNotes(options) {
  const version = desktopVersion(options?.version);
  const channel = desktopChannel(options?.channel);
  const sourceUrl = options?.sourceUrl;
  if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) {
    throw new Error('Desktop release notes require the source commit URL.');
  }
  const entries = [];
  for (const line of changelogSection(options?.changelog ?? '', version)) {
    if (!line.startsWith('- ')) continue;
    const text = line.slice(2).replace(attributionPattern, '').trim();
    if (text.length > 0) entries.push(`- ${text}`);
  }
  if (entries.length === 0) {
    if (channel === 'stable') {
      throw new Error(`apps/desktop/CHANGELOG.md has no entries for ${version}; a stable release must tell users what changed.`);
    }
    entries.push(`- Preview build of the ${channel} channel.`);
  }
  return `${entries.join('\n')}\n\n---\n\nBuilt from ${sourceUrl}.\n`;
}

function writeOutputs(result) {
  const lines = [
    `version=${result.version}`,
    `tag=${result.releaseTag}`,
    `channel=${result.channel}`,
    `feed_channel=${result.feedChannel}`,
    `mac_manifest=${result.macManifest}`,
    `win_manifest=${result.winManifest}`,
    `publish=${String(result.publish)}`,
    `prerelease=${String(result.prerelease)}`,
  ];
  const output = process.env.GITHUB_OUTPUT;
  if (output === undefined || output === '') {
    for (const line of lines) process.stdout.write(`${line}\n`);
  } else {
    appendFileSync(output, `${lines.join('\n')}\n`);
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'resolve' && args.length === 6) {
    const [eventName, packageVersion, requestedChannel, tagName, commitCount, publishNightlyValue] = args;
    if (!['', 'false', 'true'].includes(publishNightlyValue)) {
      throw new Error(`Invalid Nightly publishing permission: ${publishNightlyValue}`);
    }
    writeOutputs(resolveDesktopRelease({
      eventName,
      packageVersion,
      publishNightly: publishNightlyValue === 'true',
      requestedChannel: requestedChannel === '' ? undefined : requestedChannel,
      tagName: tagName === '' ? undefined : tagName,
      commitCount,
    }));
    return;
  }
  if (command === 'notes' && args.length === 4) {
    const [changelogPath, version, channel, sourceUrl] = args;
    process.stdout.write(desktopReleaseNotes({
      changelog: readFileSync(resolve(changelogPath), 'utf8'),
      version,
      channel,
      sourceUrl,
    }));
    return;
  }
  if (command === 'configure' && args.length === 3) {
    const [path, version, channel] = args;
    const packagePath = resolve(path);
    const configured = configureDesktopPackage(JSON.parse(readFileSync(packagePath, 'utf8')), version, channel);
    writeFileSync(packagePath, `${JSON.stringify(configured, null, 2)}\n`, 'utf8');
    return;
  }
  throw new Error('Usage: desktop-release.mjs resolve <event> <package-version> <channel> <tag> <commit-count> <publish-nightly> | notes <changelog> <version> <channel> <source-url> | configure <package-json> <version> <channel>');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
