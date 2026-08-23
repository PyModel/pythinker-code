#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const artifactRoot = resolve(repositoryRoot, process.argv[2] ?? '.tmp/security-artifacts');
const webRoot = resolve(repositoryRoot, 'apps/pythinker-code/dist-web');
const textExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.map', '.mjs', '.txt', '.yaml', '.yml']);
const vulnerableCode = [
  /@license DOMPurify 3\.2\.7\b/,
  /@license DOMPurify 3\.4\.7\b/,
  /\.version\s*=\s*["']3\.2\.7["']/,
  /\.version\s*=\s*["']3\.4\.7["']/,
];
const safeCode = [/@license DOMPurify 3\.4\.14\b/, /\.version\s*=\s*["']3\.4\.14["']/];

function compareVersions(left, right) {
  const parse = (value) => value.split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}

async function walkFiles(root) {
  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) queue.push(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

async function findFiles(root, suffix) {
  return (await walkFiles(root)).filter((file) => file.endsWith(suffix));
}

async function assertTextArtifactsSafe(label, root, requireSafeDomPurify = false) {
  let safeDomPurify = 0;
  for (const file of await walkFiles(root)) {
    if (!textExtensions.has(extname(file))) continue;
    if ((await stat(file)).size > 64 * 1024 * 1024) continue;
    const content = await readFile(file, 'utf8');
    const vulnerable = vulnerableCode.find((pattern) => pattern.test(content));
    if (vulnerable) {
      throw new Error(`${label} contains vulnerable DOMPurify code in ${relative(repositoryRoot, file)}.`);
    }
    if (safeCode.some((pattern) => pattern.test(content))) safeDomPurify += 1;
  }
  if (requireSafeDomPurify && safeDomPurify === 0) {
    throw new Error(`${label} does not contain the required DOMPurify 3.4.14 implementation.`);
  }
  process.stdout.write(
    `${label}: vulnerable code absent${requireSafeDomPurify ? '; DOMPurify 3.4.14 present' : ''}.\n`,
  );
}

async function treeDigest(root) {
  const hash = createHash('sha256');
  for (const file of await walkFiles(root)) {
    hash.update(relative(root, file));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function assertWebCopy(label, candidate) {
  const [expected, actual] = await Promise.all([treeDigest(webRoot), treeDigest(candidate)]);
  if (actual !== expected) throw new Error(`${label} has a non-identical dist-web copy.`);
  process.stdout.write(`${label}: dist-web is byte-identical to the committed bundle.\n`);
}

function packageVersions(lockfile, packageName) {
  const versions = [];
  for (const line of lockfile.split('\n')) {
    const match = line.match(/^  ('[^']+'|[^:]+):\s*$/);
    if (!match) continue;
    const key = match[1].startsWith("'") ? match[1].slice(1, -1) : match[1];
    const prefix = `${packageName}@`;
    if (!key.startsWith(prefix)) continue;
    versions.push(key.slice(prefix.length).split('(')[0]);
  }
  return [...new Set(versions)].toSorted(compareVersions);
}

function assertVersions(lockfile, packageName, validate, expected) {
  const versions = packageVersions(lockfile, packageName);
  if (versions.length === 0) throw new Error(`Could not find ${packageName} in pnpm-lock.yaml.`);
  const invalid = versions.filter((version) => !validate(version));
  if (invalid.length > 0) {
    throw new Error(`${packageName} has disallowed versions: ${invalid.join(', ')}; expected ${expected}.`);
  }
  process.stdout.write(`${packageName}: ${versions.join(', ')}\n`);
}

async function assertDependencyProof() {
  const lockfile = await readFile(resolve(repositoryRoot, 'pnpm-lock.yaml'), 'utf8');
  const floor = (minimum) => (version) => compareVersions(version, minimum) >= 0;
  const major = (version) => Number.parseInt(version.split('.')[0], 10);
  const checks = [
    ['tar', floor('7.5.22'), '>=7.5.22'],
    ['ws', floor('8.21.3'), '>=8.21.3'],
    ['protobufjs', floor('7.6.5'), '>=7.6.5'],
    ['@protobufjs/utf8', floor('1.1.2'), '>=1.1.2'],
    ['dompurify', floor('3.4.14'), '>=3.4.14'],
    ['mermaid', floor('11.17.0'), '>=11.17.0'],
    ['react-router', floor('7.18.2'), '>=7.18.2'],
    ['find-my-way', floor('9.9.0'), '>=9.9.0'],
    ['ip-address', floor('10.5.0'), '>=10.5.0'],
    ['fast-uri', floor('3.1.5'), '>=3.1.5'],
    ['brace-expansion', (version) => {
      if (major(version) === 1) return compareVersions(version, '1.1.18') >= 0;
      if (major(version) === 2) return compareVersions(version, '2.1.4') >= 0;
      return major(version) >= 5 && compareVersions(version, '5.0.9') >= 0;
    }, '1.1.18, 2.1.4, or >=5.0.9'],
    ['js-yaml', (version) => major(version) === 3
      ? compareVersions(version, '3.15.1') >= 0
      : major(version) >= 4 && compareVersions(version, '4.3.1') >= 0, '3.15.1 or >=4.3.1'],
    ['vite', (version) => major(version) === 6
      ? compareVersions(version, '6.4.3') >= 0
      : major(version) === 8
        ? compareVersions(version, '8.0.16') >= 0
        : major(version) > 6, '6.4.3, 7.x, or >=8.0.16'],
    ['esbuild', floor('0.25.12'), '>=0.25.12'],
    ['postcss', floor('8.5.26'), '>=8.5.26'],
    ['nanoid', floor('3.3.18'), '>=3.3.18'],
    ['linkify-it', floor('5.0.2'), '>=5.0.2'],
    ['qs', floor('6.15.3'), '>=6.15.3'],
    ['body-parser', floor('2.3.0'), '>=2.3.0'],
  ];
  for (const [name, validate, expected] of checks) assertVersions(lockfile, name, validate, expected);

  const webRequire = createRequire(resolve(repositoryRoot, 'apps/pythinker-web/package.json'));
  const monacoRoot = dirname(webRequire.resolve('monaco-editor/package.json'));
  const monacoPackage = JSON.parse(await readFile(join(monacoRoot, 'package.json'), 'utf8'));
  if (monacoPackage.main || monacoPackage.exports?.['.']?.require) {
    throw new Error('Monaco still exposes a pruned vulnerable distribution.');
  }
  if (monacoPackage.dependencies?.dompurify !== '3.4.14') {
    throw new Error('Monaco dependency metadata does not require DOMPurify 3.4.14.');
  }
  const vendor = await readFile(
    join(monacoRoot, 'esm/vs/base/browser/dompurify/dompurify.js'),
    'utf8',
  );
  if (vendor.trim() !== "export { default } from 'dompurify';") {
    throw new Error('Monaco ESM still contains a vendored DOMPurify implementation.');
  }
  const monacoRequire = createRequire(join(monacoRoot, 'package.json'));
  const domPurifyEntry = monacoRequire.resolve('dompurify');
  const domPurifyPackage = JSON.parse(
    await readFile(resolve(dirname(domPurifyEntry), '../package.json'), 'utf8'),
  );
  if (domPurifyPackage.version !== '3.4.14') {
    throw new Error(`Monaco resolves DOMPurify ${domPurifyPackage.version}, expected 3.4.14.`);
  }
  for (const distribution of ['dev', 'min']) {
    try {
      await access(join(monacoRoot, distribution));
      throw new Error(`Monaco still contains its vulnerable ${distribution} distribution.`);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  await assertTextArtifactsSafe('Resolved Monaco package', monacoRoot);
  process.stdout.write(
    'Monaco: metadata and ESM source are patched; unused vulnerable distributions are absent.\n',
  );
}

async function inspectCliArchive(archive, temporaryRoot) {
  const destination = join(temporaryRoot, 'cli');
  await mkdir(destination, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', destination]);
  const packageRoot = join(destination, 'package');
  await stat(join(packageRoot, 'dist', 'main.mjs'));
  await assertWebCopy('Packed CLI', join(packageRoot, 'dist-web'));
  await assertTextArtifactsSafe('Packed CLI', packageRoot, true);
}

async function inspectVsix(archives, temporaryRoot) {
  for (const [index, archive] of archives.entries()) {
    const destination = join(temporaryRoot, `vsix-${index}`);
    await mkdir(destination, { recursive: true });
    execFileSync('unzip', ['-q', archive, '-d', destination]);
    await stat(join(destination, 'extension', 'dist', 'webview.js'));
    await assertTextArtifactsSafe(`VSIX ${index + 1}`, join(destination, 'extension'));
  }
}

async function inspectDesktop() {
  const desktopDist = resolve(repositoryRoot, 'apps/desktop/dist');
  const suffix = ['node_modules', '@pymodel', 'pythinker-code', 'dist', 'main.mjs'].join(sep);
  const packageRoots = (await findFiles(desktopDist, suffix)).map((file) => dirname(dirname(file)));
  if (packageRoots.length === 0) {
    throw new Error('Could not find the packaged desktop CLI runtime.');
  }
  for (const [index, packageRoot] of packageRoots.entries()) {
    await stat(join(packageRoot, 'dist', 'main.mjs'));
    await assertWebCopy(`Desktop package ${index + 1}`, join(packageRoot, 'dist-web'));
    await assertTextArtifactsSafe(`Desktop package ${index + 1}`, packageRoot, true);
  }
}

async function main() {
  await assertDependencyProof();
  const cliArchives = await findFiles(join(artifactRoot, 'cli'), '.tgz');
  const vsixArchives = await findFiles(join(artifactRoot, 'vsix'), '.vsix');
  if (cliArchives.length !== 1) throw new Error(`Expected one packed CLI, found ${cliArchives.length}.`);
  if (vsixArchives.length === 0) throw new Error('Expected at least one VSIX artifact.');

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'pythinker-security-artifacts-'));
  try {
    await assertTextArtifactsSafe('CLI dist', resolve(repositoryRoot, 'apps/pythinker-code/dist'));
    await assertTextArtifactsSafe('Committed dist-web', webRoot, true);
    await assertTextArtifactsSafe(
      'Built docs',
      resolve(repositoryRoot, 'docs/.vitepress/dist'),
      true,
    );
    await inspectCliArchive(cliArchives[0], temporaryRoot);
    await inspectVsix(vsixArchives, temporaryRoot);
    await inspectDesktop();
    execFileSync(
      process.execPath,
      [resolve(repositoryRoot, 'scripts/security/check-built-browser.mjs'), webRoot],
      { stdio: 'inherit' },
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
  process.stdout.write('All shipped artifact security checks passed.\n');
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Artifact security failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
