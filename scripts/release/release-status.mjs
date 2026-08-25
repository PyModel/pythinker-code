#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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

function missingDetail(missing) {
  return missing.length === 0 ? '' : `; missing ${missing.join(', ')}`;
}

export async function collectReleaseStatus({
  rootDir = resolve(import.meta.dirname, '../..'),
  fetchImpl = globalThis.fetch,
  githubToken = process.env.GITHUB_TOKEN,
} = {}) {
  const [cliVersion, desktopVersion, extensionVersion] = await Promise.all([
    readVersion(rootDir, packagePaths.cli),
    readVersion(rootDir, packagePaths.desktop),
    readVersion(rootDir, packagePaths.extension),
  ]);
  const cliTag = `${cliPackageName}@${cliVersion}`;
  const github = githubHeaders(githubToken);

  const [npmResult, cdnResult, cliReleaseResult, desktopResult, marketplaceResult, openVsxResult] =
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
        'desktop GitHub release',
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
  const desktop = settledValue(desktopResult, (value) => ({
    version: typeof value.tag_name === 'string' ? validVersion(value.tag_name.replace(/^v/u, '')) : undefined,
    assets: Array.isArray(value.assets) ? value.assets.length : 0,
  }));
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
      lane: 'Desktop',
      expected: desktopVersion,
      observed: desktop.version ?? 'unavailable',
      ok: desktop.version === desktopVersion && desktop.error === undefined,
      details: desktop.error ?? `release assets ${desktop.assets}`,
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
