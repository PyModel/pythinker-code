import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SELF = 'scripts/check-identity-freeze.mjs';
const SELF_TEST = 'scripts/check-identity-freeze.test.mjs';

export const VSCODE_PUBLISHER = 'pymodel';
export const VSCODE_NAME = 'pythinker';
export const VSCODE_DISPLAY_NAME = 'Pythinker';
export const CLI_PACKAGE = '@pymodel/pythinker-code';
export const CAPABILITY_MARKER = 'pymodel.kosong.UNKNOWN_CAPABILITY';
export const FORBIDDEN_CAPABILITY_MARKER = 'moonshot-ai.kosong.UNKNOWN_CAPABILITY';

export const CAPABILITY_FILES = [
  'packages/kosong/src/capability.ts',
  'packages/agent-core-v2/src/kosong/contract/capability.ts',
  'packages/agent-core-v2/src/llm-adapter/contract/capability.ts',
  'packages/agent-core-v2/src/human/llm/capability.ts',
];

export const CHANGELOG_FILES = {
  cli: 'apps/pythinker-code/CHANGELOG.md',
  vscode: 'apps/vscode/CHANGELOG.md',
  desktop: 'apps/desktop/CHANGELOG.md',
};

export const MOONSHOT_AI_ALLOW_FILES = new Set([
  SELF,
  SELF_TEST,
  'packages/oauth/src/open-platform.ts',
  'packages/oauth/src/refreshProviderModels.ts',
  'packages/oauth/test/open-platform.test.ts',
]);

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;
const HEADING = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/mu;
const PROVIDER_HOST = /api\.moonshot\.(?:ai|cn)/gu;

export function parseSemver(version) {
  if (typeof version !== 'string') return null;
  const match = SEMVER.exec(version);
  if (match === null) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? null : match[4].split('.'),
  };
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (a === null || b === null) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.pre === null && b.pre === null) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < length; index += 1) {
    const leftId = a.pre[index];
    const rightId = b.pre[index];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    const leftNumeric = /^\d+$/u.test(leftId);
    const rightNumeric = /^\d+$/u.test(rightId);
    if (leftNumeric && rightNumeric) {
      const delta = Number(leftId) - Number(rightId);
      if (delta !== 0) return delta;
      continue;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    if (leftId < rightId) return -1;
    if (leftId > rightId) return 1;
  }
  return 0;
}

export const compareSemverCore = compareSemver;

export function firstChangelogHeading(source) {
  if (typeof source !== 'string') return null;
  return HEADING.exec(source)?.[1] ?? null;
}

function asText(value) {
  return typeof value === 'string' ? value : '-';
}

export function evaluate(input) {
  const failures = [];
  const vscode = input.vscode ?? {};
  if (vscode.publisher !== VSCODE_PUBLISHER) {
    failures.push(`VS Code publisher must be ${VSCODE_PUBLISHER}, got ${asText(vscode.publisher)}`);
  }
  if (vscode.name !== VSCODE_NAME) {
    failures.push(`VS Code name must be ${VSCODE_NAME}, got ${asText(vscode.name)}`);
  }
  if (vscode.displayName !== VSCODE_DISPLAY_NAME) {
    failures.push(`VS Code displayName must be ${VSCODE_DISPLAY_NAME}, got ${asText(vscode.displayName)}`);
  }

  for (const [lane, heading] of Object.entries(input.changelogHeadings ?? {})) {
    const version = input.versions?.[lane];
    if (typeof version !== 'string') {
      failures.push(`${lane} package.json version is missing`);
      continue;
    }
    if (heading !== version) {
      failures.push(`${lane} changelog heading ${asText(heading)} does not match version ${version}`);
    }
  }

  for (const [file, source] of Object.entries(input.capabilitySources ?? {})) {
    if (!source.includes(CAPABILITY_MARKER)) {
      failures.push(`${file}: missing ${CAPABILITY_MARKER}`);
    }
    if (source.includes(FORBIDDEN_CAPABILITY_MARKER)) {
      failures.push(`${file}: still uses ${FORBIDDEN_CAPABILITY_MARKER}`);
    }
  }

  for (const hit of input.moonshotHits ?? []) {
    failures.push(`${hit.file}:${hit.line}: moonshot-ai identity token`);
  }

  for (const [lane, base] of Object.entries(input.baseVersions ?? {})) {
    const head = input.versions?.[lane];
    const order = compareSemver(asText(head), asText(base));
    if (order !== null && order < 0) {
      failures.push(`${lane} version rewound ${asText(base)} -> ${asText(head)}`);
    }
  }

  if (typeof input.npmLatest === 'string') {
    const cliVersion = asText(input.versions?.cli);
    const order = compareSemver(cliVersion, input.npmLatest);
    if (order !== null && order < 0) {
      failures.push(`CLI version ${cliVersion} is below npm latest ${input.npmLatest}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

export function moonshotHitAllowed(file, line) {
  if (MOONSHOT_AI_ALLOW_FILES.has(file)) return true;
  return !line.replaceAll(PROVIDER_HOST, '').includes('moonshot-ai');
}

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

function readText(relative) {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

function scanMoonshotHits() {
  const hits = [];
  for (const file of trackedFiles()) {
    if (file === 'pnpm-lock.yaml' || file.includes('/dist/') || file.includes('/dist-web/')) continue;
    let bytes;
    try {
      bytes = readFileSync(path.join(ROOT, file));
    } catch {
      continue;
    }
    if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0)) continue;
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
    for (const [index, line] of text.split(/\r?\n/).entries()) {
      if (!line.includes('moonshot-ai')) continue;
      if (moonshotHitAllowed(file, line)) continue;
      hits.push({ file, line: index + 1, text: line.trim() });
    }
  }
  return hits;
}

function readBaseVersion(baseSha, relative) {
  try {
    const source = execFileSync('git', ['show', `${baseSha}:${relative}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const version = JSON.parse(source).version;
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

function readNpmLatest() {
  const cleanEnv = { ...process.env };
  delete cleanEnv.NODE_AUTH_TOKEN;
  delete cleanEnv.NPM_CONFIG_USERCONFIG;
  delete cleanEnv.npm_config_userconfig;
  return execFileSync(
    'npm',
    ['view', CLI_PACKAGE, 'version', '--registry=https://registry.npmjs.org'],
    { cwd: ROOT, env: cleanEnv, encoding: 'utf8', timeout: 30_000 },
  ).trim();
}

function main() {
  const vscode = readJson('apps/vscode/package.json');
  const cli = readJson('apps/pythinker-code/package.json');
  const desktop = readJson('apps/desktop/package.json');
  const versions = { cli: cli.version, vscode: vscode.version, desktop: desktop.version };
  const changelogHeadings = Object.fromEntries(
    Object.entries(CHANGELOG_FILES).map(([lane, file]) => [lane, firstChangelogHeading(readText(file))]),
  );
  const capabilitySources = Object.fromEntries(
    CAPABILITY_FILES.map((file) => [file, readText(file)]),
  );

  const baseSha = process.env.BASE_SHA;
  const baseVersions = {};
  if (typeof baseSha === 'string' && /^[0-9a-f]{7,40}$/u.test(baseSha)) {
    const cliBase = readBaseVersion(baseSha, 'apps/pythinker-code/package.json');
    const vscodeBase = readBaseVersion(baseSha, 'apps/vscode/package.json');
    const desktopBase = readBaseVersion(baseSha, 'apps/desktop/package.json');
    if (cliBase !== undefined) baseVersions.cli = cliBase;
    if (vscodeBase !== undefined) baseVersions.vscode = vscodeBase;
    if (desktopBase !== undefined) baseVersions.desktop = desktopBase;
  }

  let npmLatest;
  if (process.argv.includes('--npm')) {
    try {
      npmLatest = readNpmLatest();
    } catch (error) {
      process.stderr.write(
        `Identity freeze failed: cannot read npm latest for ${CLI_PACKAGE}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }
  }

  const result = evaluate({
    vscode: {
      publisher: vscode.publisher,
      name: vscode.name,
      displayName: vscode.displayName,
    },
    versions,
    changelogHeadings,
    capabilitySources,
    moonshotHits: scanMoonshotHits(),
    baseVersions: Object.keys(baseVersions).length > 0 ? baseVersions : undefined,
    npmLatest,
  });

  if (!result.ok) {
    process.stderr.write(`Identity freeze failed:\n${result.failures.map((line) => `- ${line}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('Identity freeze passed.\n');
}

if (process.argv[1] === import.meta.filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
