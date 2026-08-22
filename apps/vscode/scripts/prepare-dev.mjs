#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isMainModule } from './vsix-targets.mjs';

const SAFE_DIRECTORY_NAME = 'vscode-extension-dev';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolve(scriptDir, '../../..');
const defaultBaseDir = join(monorepoRoot, '.tmp', SAFE_DIRECTORY_NAME);
export async function prepareDevEnvironment(baseDir = defaultBaseDir, options = {}) {
  const root = resolve(baseDir);
  assertSafeRoot(root);
  // Preflight the seed before touching the tree: a missing or unreadable
  // source must fail without destroying the existing dev profile.
  const seed = options.seedConfig ? await readSeedConfig(root) : undefined;
  await rm(root, { recursive: true, force: true });

  const paths = {
    root,
    userData: join(root, 'user-data'),
    extensions: join(root, 'extensions'),
    pythinkerHome: join(root, 'pythinker-home'),
    workspace: join(root, 'workspace'),
  };
  await Promise.all(
    Object.values(paths)
      .filter((path) => path !== root)
      .map((path) => mkdir(path, { recursive: true })),
  );
  if (seed !== undefined) {
    await writeFile(join(paths.pythinkerHome, 'config.toml'), seed.content, { mode: 0o600 });
  }
  await writeFile(
    join(paths.workspace, 'README.md'),
    '# Isolated Pythinker Code extension development workspace\n',
  );
  return paths;
}

/**
 * Opt-in: copy the real home's config.toml into the fresh isolated dev home so
 * the development extension starts with the user's providers and models.
 * WARNING: config.toml is copied verbatim, so this duplicates every secret it
 * contains — API keys and any embedded provider auth/OAuth metadata — into a
 * disposable file under .tmp/ (mode 0600 where supported). Separate credential
 * stores, session data, and mcp.json are NOT copied; those stay in the real home.
 */
async function readSeedConfig(root) {
  const sourceHome = process.env.PYTHINKER_CODE_HOME ?? join(homedir(), '.pythinker-code');
  const source = resolve(sourceHome, 'config.toml');
  if (source === root || source.startsWith(root + sep)) {
    throw new Error(
      `--seed-config source ${source} is inside the dev tree being reset (${root}); refusing.`,
    );
  }
  let content;
  try {
    content = await readFile(source, 'utf8');
  } catch (error) {
    throw new Error(
      `--seed-config could not read ${source}: ${error instanceof Error ? error.message : String(error)}.`,
      { cause: error },
    );
  }
  return { source, content };
}

function assertSafeRoot(root) {
  const parsed = parse(root);
  if (root === parsed.root || basename(root) !== SAFE_DIRECTORY_NAME) {
    throw new Error(
      `Refusing to reset unsafe development directory "${root}"; it must end in ${SAFE_DIRECTORY_NAME}.`,
    );
  }
}

function parseArguments(argv) {
  let baseDir = defaultBaseDir;
  let help = false;
  let seedConfig = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      continue;
    } else if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--base-dir') {
      const value = argv[++index];
      if (value === undefined || value.startsWith('-')) throw new Error('--base-dir requires a value.');
      baseDir = value;
    } else if (argument === '--seed-config') {
      seedConfig = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return { baseDir, help, seedConfig };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(
      'Usage: node scripts/prepare-dev.mjs [--base-dir <.../vscode-extension-dev>] [--seed-config]',
    );
    console.log('  --seed-config  copy <real home>/config.toml into the fresh dev home');
    return;
  }
  const paths = await prepareDevEnvironment(options.baseDir, { seedConfig: options.seedConfig });
  console.log(`Prepared isolated VS Code profile: ${paths.root}`);
  console.log(`PYTHINKER_CODE_HOME=${paths.pythinkerHome}`);
  console.log(`Workspace=${paths.workspace}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(`Development environment setup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
