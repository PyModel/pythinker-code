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

async function copyPlugins(repoRoot, cdnRoot) {
  const source = join(repoRoot, 'plugins/cdn');
  const destination = join(cdnRoot, 'pythinker-code/plugins');
  await mkdir(destination, { recursive: true });
  await cp(join(source, 'marketplace.json'), join(destination, 'marketplace.json'));
  for (const channel of ['official', 'curated']) {
    const channelDestination = join(destination, channel);
    await mkdir(channelDestination, { recursive: true });
    for (const entry of await readdir(join(source, channel), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      await cp(join(source, channel, entry.name), join(channelDestination, entry.name));
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
const version = packageJson.version;
if (typeof version !== 'string' || version.trim() === '') {
  throw new Error('apps/pythinker-code/package.json has no version');
}

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
  publishedAt: new Date().toISOString(),
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
