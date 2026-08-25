#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  desktopManifestName,
  desktopReleaseChannel,
  nightlyDesktopVersion,
} from '../../apps/desktop/scripts/desktop-release.mjs';

const cliPackageName = '@pymodel/pythinker-code';
const semver = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/u;

export const nativeTargets = Object.freeze([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
]);

export const expectedCliAssets = Object.freeze([
  'manifest.json',
  ...nativeTargets.flatMap((target) => [
    `pythinker-code-${target}.zip`,
    `pythinker-code-${target}.zip.sha256`,
  ]),
]);

const packagePaths = {
  cli: 'apps/pythinker-code/package.json',
  desktop: 'apps/desktop/package.json',
  extension: 'apps/vscode/package.json',
};

async function readVersion(rootDir, path) {
  const parsed = JSON.parse(await readFile(resolve(rootDir, path), 'utf8'));
  if (typeof parsed.version !== 'string' || semver.exec(parsed.version)?.[0] !== parsed.version) {
    throw new Error(`${path} has no valid release version.`);
  }
  return parsed.version;
}

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
  };
}

async function fetchJson(fetchImpl, url, label, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      'user-agent': 'pythinker-release-status',
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${label} returned invalid JSON.`, { cause: error });
  }
}

function validVersion(value) {
  return typeof value === 'string' && semver.exec(value)?.[0] === value ? value : undefined;
}

function settledValue(result, select) {
  if (result.status === 'rejected') return { error: messageOf(result.reason) };
  try {
    return select(result.value);
  } catch (error) {
    return { error: messageOf(error) };
  }
}

function messageOf(error) {
  return (error instanceof Error ? error.message : String(error)).replaceAll(/\s+/gu, ' ').trim();
}

function targetCoverage(values) {
  const present = new Set(values);
  const missing = nativeTargets.filter((target) => !present.has(target));
  return { present: nativeTargets.length - missing.length, missing };
}

function desktopRelease(value) {
  if (typeof value !== 'object' || value === null || value.draft === true) return undefined;
  const version = typeof value.tag_name === 'string' ? validVersion(value.tag_name.replace(/^v/u, '')) : undefined;
  if (version === undefined) return undefined;
  try {
    return {
      version,
      channel: desktopReleaseChannel(version),
      prerelease: value.prerelease === true,
      assets: Array.isArray(value.assets) ? value.assets.map((asset) => asset.name) : [],
    };
  } catch {
    return undefined;
  }
}

function desktopAssetCoverage(release, channel) {
  if (release === undefined) return { assets: 0, missing: ['release'] };
  const names = new Set(release.assets);
  const required = [
    desktopManifestName(channel, 'mac'),
    desktopManifestName(channel, 'win'),
  ];
  const missing = required.filter((name) => !names.has(name));
  if (![...names].some((name) => typeof name === 'string' && name.endsWith('-mac.zip'))) missing.push('macOS ZIP');
  if (![...names].some((name) => typeof name === 'string' && name.endsWith('.dmg'))) missing.push('macOS DMG');
  if (![...names].some((name) => typeof name === 'string' && name.endsWith('-Setup.exe'))) missing.push('Windows installer');
  return { assets: names.size, missing };
}

function desktopReleaseDetails(coverage) {
  return `release assets ${coverage.assets}${missingDetail(coverage.missing)}`;
}

function commitCount(rootDir, supplied) {
  if (supplied !== undefined) return String(supplied);
  try {
    return execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error('Cannot resolve the current main commit count.', { cause: error });
  }
}

function missingDetail(missing) {
  return missing.length === 0 ? '' : `; missing ${missing.join(', ')}`;
}

export async function collectReleaseStatus({
  rootDir = resolve(import.meta.dirname, '../..'),
  fetchImpl = globalThis.fetch,
  githubToken = process.env.GITHUB_TOKEN,
  desktopCommitCount,
} = {}) {
  const [cliVersion, desktopVersion, extensionVersion] = await Promise.all([
    readVersion(rootDir, packagePaths.cli),
    readVersion(rootDir, packagePaths.desktop),
    readVersion(rootDir, packagePaths.extension),
  ]);
  const cliTag = `${cliPackageName}@${cliVersion}`;
  const expectedDesktopNightly = nightlyDesktopVersion(desktopVersion, commitCount(rootDir, desktopCommitCount));
  const github = githubHeaders(githubToken);

  const [
    npmResult,
    cdnResult,
    cliReleaseResult,
    desktopStableResult,
    desktopReleasesResult,
    marketplaceResult,
    openVsxResult,
  ] =
    await Promise.allSettled([
      fetchJson(
        fetchImpl,
        'https://registry.npmjs.org/-/package/%40pymodel%2Fpythinker-code/dist-tags',
        'npm dist-tags',
      ),
      fetchJson(
        fetchImpl,
        'https://code.pythinker.com/pythinker-code/latest.json',
        'CDN manifest',
      ),
      fetchJson(
        fetchImpl,
        `https://api.github.com/repos/PyModel/pythinker-code/releases/tags/${encodeURIComponent(cliTag)}`,
        'CLI GitHub release',
        { headers: github },
      ),
      fetchJson(
        fetchImpl,
        'https://api.github.com/repos/PyModel/pythinker-desktop-releases/releases/latest',
        'desktop Stable GitHub release',
        { headers: github },
      ),
      fetchJson(
        fetchImpl,
        'https://api.github.com/repos/PyModel/pythinker-desktop-releases/releases?per_page=100',
        'desktop prerelease list',
        { headers: github },
      ),
      fetchJson(
        fetchImpl,
        'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
        'Visual Studio Marketplace',
        {
          method: 'POST',
          headers: {
            accept: 'application/json;api-version=7.2-preview.1',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            filters: [{ criteria: [{ filterType: 7, value: 'pymodel.pythinker' }] }],
            flags: 914,
          }),
        },
      ),
      fetchJson(
        fetchImpl,
        'https://open-vsx.org/api/PyModel/pythinker/latest',
        'Open VSX',
      ),
    ]);

  const npm = settledValue(npmResult, (value) => ({ version: validVersion(value.latest) }));
  const cdn = settledValue(cdnResult, (value) => ({
    version: validVersion(value.version),
    coverage: targetCoverage(Object.keys(value.platforms ?? {})),
  }));
  const cliRelease = settledValue(cliReleaseResult, (value) => {
    const assets = Array.isArray(value.assets) ? value.assets.map((asset) => asset.name) : [];
    const missing = expectedCliAssets.filter((name) => !assets.includes(name));
    return { tag: value.tag_name, assets, missing };
  });
  const desktopStable = settledValue(desktopStableResult, (value) => {
    const release = desktopRelease(value);
    if (release === undefined) throw new Error('Stable desktop release is invalid.');
    return { release, coverage: desktopAssetCoverage(release, 'stable') };
  });
  const desktopReleases = settledValue(desktopReleasesResult, (value) => {
    if (!Array.isArray(value)) throw new Error('Desktop prerelease list is invalid.');
    return { releases: value.flatMap((entry) => {
      const release = desktopRelease(entry);
      return release === undefined ? [] : [release];
    }) };
  });
  const betaRelease = desktopReleases.releases?.find((release) => release.channel === 'beta');
  const nightlyRelease = desktopReleases.releases?.find((release) => release.version === expectedDesktopNightly);
  const latestNightly = desktopReleases.releases?.find((release) => release.channel === 'nightly');
  const betaCoverage = desktopAssetCoverage(betaRelease, 'beta');
  const nightlyCoverage = desktopAssetCoverage(nightlyRelease, 'nightly');
  const marketplace = settledValue(marketplaceResult, (value) => {
    const versions = value.results?.[0]?.extensions?.[0]?.versions;
    if (!Array.isArray(versions) || versions.length === 0) throw new Error('No extension versions found.');
    const version = validVersion(versions[0].version);
    const targets = versions
      .filter((entry) => entry.version === version)
      .map((entry) => entry.targetPlatform);
    return { version, coverage: targetCoverage(targets) };
  });
  const openVsx = settledValue(openVsxResult, (value) => ({
    version: validVersion(value.version),
    coverage: targetCoverage(Object.keys(value.downloads ?? {})),
  }));

  const cliMissing = cliRelease.missing ?? expectedCliAssets;
  const cliOk = npm.version === cliVersion
    && cliRelease.tag === cliTag
    && cliMissing.length === 0
    && npm.error === undefined
    && cliRelease.error === undefined;
  const rows = [
    {
      lane: 'npm CLI',
      expected: cliVersion,
      observed: npm.version ?? 'unavailable',
      ok: cliOk,
      details: npm.error ?? cliRelease.error
        ?? `GitHub assets ${(cliRelease.assets ?? []).length}/${expectedCliAssets.length}${missingDetail(cliMissing)}`,
    },
    {
      lane: 'CDN',
      expected: cliVersion,
      observed: cdn.version ?? 'unavailable',
      ok: cdn.version === cliVersion && cdn.coverage?.missing.length === 0 && cdn.error === undefined,
      details: cdn.error
        ?? `platforms ${cdn.coverage?.present ?? 0}/${nativeTargets.length}${missingDetail(cdn.coverage?.missing ?? nativeTargets)}`,
    },
    {
      lane: 'Desktop Stable',
      expected: desktopVersion,
      observed: desktopStable.release?.version ?? 'unavailable',
      ok: desktopStable.release?.version === desktopVersion
        && desktopStable.coverage?.missing.length === 0
        && desktopStable.error === undefined,
      details: desktopStable.error ?? desktopReleaseDetails(desktopStable.coverage ?? { assets: 0, missing: ['release'] }),
    },
    {
      lane: 'Desktop Beta',
      expected: 'optional',
      observed: betaRelease?.version ?? 'not published',
      ok: desktopReleases.error === undefined
        && (betaRelease === undefined || (betaRelease.prerelease && betaCoverage.missing.length === 0)),
      details: desktopReleases.error
        ?? (betaRelease === undefined ? 'no Beta release published' : desktopReleaseDetails(betaCoverage)),
    },
    {
      lane: 'Desktop Nightly',
      expected: expectedDesktopNightly,
      observed: nightlyRelease?.version ?? latestNightly?.version ?? 'not published',
      ok: desktopReleases.error === undefined
        && nightlyRelease?.prerelease === true
        && nightlyCoverage.missing.length === 0,
      details: desktopReleases.error
        ?? (nightlyRelease === undefined
          ? 'no Nightly release for the current main commit'
          : desktopReleaseDetails(nightlyCoverage)),
    },
    {
      lane: 'VS Marketplace',
      expected: extensionVersion,
      observed: marketplace.version ?? 'unavailable',
      ok: marketplace.version === extensionVersion
        && marketplace.coverage?.missing.length === 0
        && marketplace.error === undefined,
      details: marketplace.error
        ?? `targets ${marketplace.coverage?.present ?? 0}/${nativeTargets.length}${missingDetail(marketplace.coverage?.missing ?? nativeTargets)}`,
    },
    {
      lane: 'Open VSX',
      expected: extensionVersion,
      observed: openVsx.version ?? 'unavailable',
      ok: openVsx.version === extensionVersion
        && openVsx.coverage?.missing.length === 0
        && openVsx.error === undefined,
      details: openVsx.error
        ?? `targets ${openVsx.coverage?.present ?? 0}/${nativeTargets.length}${missingDetail(openVsx.coverage?.missing ?? nativeTargets)}`,
    },
  ];

  return {
    ok: rows.every((row) => row.ok),
    generatedAt: new Date().toISOString(),
    rows,
  };
}

function markdownCell(value) {
  return String(value).replaceAll('|', '\\|').replaceAll(/\r?\n/gu, ' ');
}

export function renderReleaseStatus(result) {
  return [
    '# Release lane status',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    '| Lane | Expected | Observed | Status | Details |',
    '|---|---:|---:|---|---|',
    ...result.rows.map((row) => [
      markdownCell(row.lane),
      markdownCell(row.expected),
      markdownCell(row.observed),
      row.ok ? 'PASS' : 'FAIL',
      markdownCell(row.details),
    ].join(' | ').replace(/^/u, '| ').replace(/$/u, ' |')),
    '',
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => !['--json', '--help', '-h'].includes(argument))) {
    throw new Error('Usage: node scripts/release/release-status.mjs [--json]');
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write('Usage: node scripts/release/release-status.mjs [--json]\n');
    return;
  }
  const result = await collectReleaseStatus();
  process.stdout.write(`${args.includes('--json') ? JSON.stringify(result, null, 2) : renderReleaseStatus(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] === import.meta.filename) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
