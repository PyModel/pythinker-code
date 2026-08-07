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

const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

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
  if (pinned) {
    // The override answers to the same shape rule as the registry path below.
    // A client rejects a manifest whose `version` is not semver, so an
    // unusable override has to stop the build instead of publishing a
    // latest.json that every installed client fails to parse.
    if (!RELEASE_VERSION.test(pinned)) {
      throw new Error(`PYTHINKER_CDN_VERSION is not a release version: ${pinned}`);
    }
    // Build time is the only timestamp available for a manual pin; the
    // registry path below requires npm's own and never stamps one.
    return { version: pinned, publishedAt: new Date().toISOString() };
  }
  const view = JSON.parse(
    execFileSync(
      'npm',
      ['view', packageName, 'dist-tags', 'time', '--json', '--registry=https://registry.npmjs.org'],
      { encoding: 'utf8', timeout: 60_000 },
    ),
  );
  const version = view['dist-tags']?.latest;
  if (typeof version !== 'string' || !RELEASE_VERSION.test(version)) {
    throw new Error(
      `npm dist-tag latest for ${packageName} is not a release version: ${String(version)}`,
    );
  }
  const publishedAt = view.time?.[version];
  // Stamping build time here is the bug this function documents: it would move
  // the rollout anchor on every unrelated site deploy. Unreadable registry
  // metadata is a failed read, and a failed read must fail the build.
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) {
    throw new Error(
      `npm has no usable publish time for ${packageName}@${version}: ${String(publishedAt)}`,
    );
  }
  return { version, publishedAt };
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
await writeFile(join(channelRoot, 'latest.json'), `${JSON.stringify({
  version,
  publishedAt,
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
