import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function findRepoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== parse(dir).root) {
    try {
      await access(join(dir, 'pnpm-workspace.yaml'));
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('Could not find repository root containing pnpm-workspace.yaml');
}

function parseArgs() {
  const args = process.argv.slice(2);
  let out;
  let skipRg = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--out') out = args[++index];
    else if (args[index] === '--skip-rg') skipRg = true;
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (!out) throw new Error('Usage: build-cdn.mjs --out <dir> [--skip-rg]');
  return { out, skipRg };
}

/**
 * Resolve the version this CDN advertises from a *published* release, never from
 * the working tree.
 *
 * `apps/pythinker-code/package.json` is bumped by the `ci: release packages`
 * merge and this site autodeploys on every push to main, so deriving the
 * manifest from it advertised the next version the moment that merge landed —
 * before the npm publish and the GitHub release assets existed, and permanently
 * when the publish never ran at all. Installed clients then polled GitHub for
 * assets that did not exist (~6 minutes per launch, every launch). The npm
 * dist-tag is the publish barrier, so it is the only safe source.
 *
 * `publishedAt` comes from npm's own publish timestamp: stamping build time made
 * every unrelated site deploy re-anchor the clients' rollout eligibility window.
 *
 * A registry read failure throws on purpose: a failed image build leaves the
 * previous container serving the last good manifest, which is the safe outcome.
 */
async function resolvePublishedRelease(packageName) {
  const pinned = process.env.PYTHINKER_CDN_VERSION?.trim();
  if (pinned) return { version: pinned, publishedAt: new Date().toISOString() };
  const view = JSON.parse(
    execFileSync(
      'npm',
      ['view', packageName, 'dist-tags', 'time', '--json', '--registry=https://registry.npmjs.org'],
      { encoding: 'utf8', timeout: 60_000 },
    ),
  );
  const version = view['dist-tags']?.latest;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `npm dist-tag latest for ${packageName} is not a release version: ${String(version)}`,
    );
  }
  const publishedAt = view.time?.[version];
  return {
    version,
    publishedAt: typeof publishedAt === 'string' ? publishedAt : new Date().toISOString(),
  };
}

const RELEASE_DOWNLOAD_BASE = 'https://github.com/Pythoughts-labs/pythinker-code/releases/download';

/**
 * Resolve the per-platform native artifacts for a published version.
 *
 * The release already carries a `manifest.json` asset written by
 * `apps/pythinker-code/scripts/native/produce-manifest.mjs`, so this only turns
 * `{ filename, checksum }` into `{ url, sha256 }`. Naming the artifact in
 * `latest.json` is what lets a client answer "is there anything to download for
 * my platform" from the manifest alone, instead of guessing an asset URL and
 * polling GitHub for six minutes when the guess is wrong.
 *
 * Returns null — never throws — when the release shipped no native manifest.
 * An npm-only release is legitimate, and a site build must not fail because of
 * it; clients that see no `platforms` key keep their previous behaviour.
 */
async function resolvePlatformArtifacts(version) {
  const base = `${RELEASE_DOWNLOAD_BASE}/%40pythoughts%2Fpythinker-code%40${version}`;
  let native;
  try {
    const response = await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    native = await response.json();
  } catch (error) {
    console.log(`no native manifest for ${version} (${error.message}); omitting platforms`);
    return null;
  }
  if (native?.version !== version) {
    console.log(`native manifest reports ${native?.version}, expected ${version}; omitting platforms`);
    return null;
  }
  const platforms = {};
  for (const [target, entry] of Object.entries(native.platforms ?? {})) {
    if (typeof entry?.filename !== 'string' || !/^[a-f0-9]{64}$/.test(entry?.checksum ?? '')) {
      throw new Error(`Malformed native manifest entry for ${target}`);
    }
    platforms[target] = { url: `${base}/${entry.filename}`, sha256: entry.checksum };
  }
  return Object.keys(platforms).length > 0 ? platforms : null;
}

async function copyPlugins(repoRoot, cdnRoot) {
  const source = join(repoRoot, 'plugins/cdn');
  const destination = join(cdnRoot, 'pythinker-code/plugins');
  await mkdir(destination, { recursive: true });
  await cp(join(source, 'marketplace.json'), join(destination, 'marketplace.json'));
  for (const channel of ['official', 'curated']) {
    const channelSource = join(source, channel);
    let entries;
    try {
      entries = await readdir(channelSource, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const channelDestination = join(destination, channel);
    await mkdir(channelDestination, { recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      await cp(join(channelSource, entry.name), join(channelDestination, entry.name));
    }
  }
}

async function downloadRipgrep(repoRoot, cdnRoot) {
  const locator = await readFile(
    join(repoRoot, 'packages/agent-core/src/tools/support/rg-locator.ts'),
    'utf8',
  );
  const pairs = [...locator.matchAll(/'(ripgrep-[^']+\.(?:tar\.gz|zip))':\s*'([a-f0-9]{64})'/g)]
    .map((match) => ({ filename: match[1], sha256: match[2] }));
  if (pairs.length !== 6) {
    throw new Error(`Expected 6 ripgrep archive checksums, found ${pairs.length}`);
  }
  const versions = new Set(pairs.map(({ filename }) => {
    const match = /^ripgrep-(\d+\.\d+\.\d+)-/.exec(filename);
    if (!match) throw new Error(`Could not parse ripgrep version from ${filename}`);
    return match[1];
  }));
  if (versions.size !== 1) throw new Error('Ripgrep archive versions do not match');
  const [version] = versions;
  const destination = join(cdnRoot, 'pythinker-code/rg');
  await mkdir(destination, { recursive: true });

  for (const { filename, sha256 } of pairs) {
    try {
      const response = await fetch(
        `https://github.com/BurntSushi/ripgrep/releases/download/${version}/${filename}`,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== sha256) throw new Error(`SHA-256 mismatch: expected ${sha256}, got ${actual}`);
      await writeFile(join(destination, filename), bytes);
    } catch (error) {
      throw new Error(`Failed to download ${filename}: ${error.message}`, { cause: error });
    }
  }
}

async function countFiles(dir) {
  let count = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? await countFiles(join(dir, entry.name)) : 1;
  }
  return count;
}

const { out, skipRg } = parseArgs();
const repoRoot = await findRepoRoot();
const packageJson = JSON.parse(
  await readFile(join(repoRoot, 'apps/pythinker-code/package.json'), 'utf8'),
);
const packageName = packageJson.name;
if (typeof packageName !== 'string' || packageName.trim() === '') {
  throw new Error('apps/pythinker-code/package.json has no name');
}
const { version, publishedAt } = await resolvePublishedRelease(packageName);

const siteDist = join(repoRoot, 'apps/site/dist');
await access(join(siteDist, 'index.html'));
const expectedLeaf = basename(out);
const outDir = resolve(repoRoot, out);
if (
  outDir === parse(outDir).root ||
  outDir === repoRoot ||
  expectedLeaf === '' ||
  basename(outDir) !== expectedLeaf
) {
  throw new Error(`Refusing unsafe output path: ${outDir}`);
}

await rm(outDir, { recursive: true, force: true });
await cp(siteDist, outDir, { recursive: true });
const channelRoot = join(outDir, 'pythinker-code');
await mkdir(channelRoot, { recursive: true });
await writeFile(join(channelRoot, 'latest'), `${version}\n`);
const platforms = await resolvePlatformArtifacts(version);
await writeFile(join(channelRoot, 'latest.json'), `${JSON.stringify({
  version,
  publishedAt,
  platforms: platforms ?? undefined,
  rollout: [],
}, null, 2)}\n`);
await cp(
  join(repoRoot, 'apps/pythinker-web/public/install.sh'),
  join(channelRoot, 'install.sh'),
);
await cp(
  join(repoRoot, 'apps/pythinker-web/public/install.ps1'),
  join(channelRoot, 'install.ps1'),
);
await copyPlugins(repoRoot, outDir);
if (!skipRg) await downloadRipgrep(repoRoot, outDir);

console.log(`version ${version}, ${await countFiles(outDir)} files, rg ${skipRg ? 'skipped' : 'included'}`);
