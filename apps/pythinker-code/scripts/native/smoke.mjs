import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { appRoot, nativeBinPath, nativeSmokeHome, targetTriple } from './paths.mjs';

const execFileAsync = promisify(execFile);
const target = targetTriple();
const executablePath = nativeBinPath(target);
const smokeHome = nativeSmokeHome();
const packageJson = JSON.parse(await readFile(resolve(appRoot, 'package.json'), 'utf-8'));
const expectedVersion = packageJson.version;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function ensureExecutableExists() {
  try {
    await stat(executablePath);
  } catch {
    fail(`Native executable not found at ${executablePath}. Run build:native:sea first.`);
  }
}

async function runPythinker(args) {
  try {
    const { stdout, stderr } = await execFileAsync(executablePath, args, {
      cwd: appRoot,
      maxBuffer: 1024 * 1024 * 16,
    });
    return `${stdout}${stderr}`;
  } catch (error) {
    const detail = [error.stdout?.trim(), error.stderr?.trim(), error.message]
      .filter(Boolean)
      .join('\n');
    fail(`Native smoke failed: ${executablePath} ${args.join(' ')}\n${detail}`);
  }
}

async function runPythinkerWithEnv(args, env) {
  try {
    const { stdout, stderr } = await execFileAsync(executablePath, args, {
      cwd: appRoot,
      env: { ...process.env, ...env },
      maxBuffer: 1024 * 1024 * 16,
    });
    return `${stdout}${stderr}`;
  } catch (error) {
    const detail = [error.stdout?.trim(), error.stderr?.trim(), error.message]
      .filter(Boolean)
      .join('\n');
    fail(`Native smoke failed: ${executablePath} ${args.join(' ')}\n${detail}`);
  }
}

function assertIncludes(output, expected, command) {
  if (!output.includes(expected)) {
    fail(`Native smoke output for "${command}" did not include "${expected}".\n${output}`);
  }
}

await ensureExecutableExists();

const versionOutput = await runPythinker(['--version']);
assertIncludes(versionOutput, expectedVersion, '--version');

const helpOutput = await runPythinker(['--help']);
assertIncludes(helpOutput, 'Usage: pythinker', '--help');

const exportHelpOutput = await runPythinker(['export', '--help']);
assertIncludes(exportHelpOutput, 'Usage: pythinker export', 'export --help');

const smokeCache = resolve(smokeHome, 'cache');
await rm(smokeHome, { recursive: true, force: true });
await mkdir(smokeCache, { recursive: true });
try {
  const nativeAssetOutput = await runPythinkerWithEnv(['--version'], {
    PYTHINKER_CODE_CACHE_DIR: smokeCache,
    PYTHINKER_CODE_HOME: smokeHome,
    PYTHINKER_CODE_NATIVE_ASSET_SMOKE: '1',
  });
  assertIncludes(nativeAssetOutput, `Native asset smoke passed: ${target}`, 'native asset smoke');
  assertIncludes(nativeAssetOutput, 'MiniDb worker build passed', 'MiniDb worker smoke');
  assertIncludes(nativeAssetOutput, 'search worker ready', 'search worker smoke');
} finally {
  await rm(smokeHome, { recursive: true, force: true });
}

// Plugin MCP servers declared with `command: "node"` are re-executed through
// this binary as `__plugin_run_node`, which loads the plugin script with a
// dynamic import(). Keep that path covered so bundler or SEA settings that
// break dynamic import() fail here instead of inside users' plugins.
const pluginRoot = resolve(smokeHome, 'plugin');
await rm(smokeHome, { recursive: true, force: true });
await mkdir(pluginRoot, { recursive: true });
try {
  const pluginEntry = resolve(pluginRoot, 'entry.mjs');
  await writeFile(
    pluginEntry,
    'await Promise.resolve();\nconsole.log(`plugin entry ran ${process.argv.slice(2).join(" ")}`);\n',
  );
  const pluginOutput = await runPythinkerWithEnv(['__plugin_run_node', pluginEntry, 'alpha', 'beta'], {
    PYTHINKER_CODE_HOME: smokeHome,
    PYTHINKER_PLUGIN_ROOT: pluginRoot,
  });
  assertIncludes(pluginOutput, 'plugin entry ran alpha beta', 'plugin node entry');
} finally {
  await rm(smokeHome, { recursive: true, force: true });
}

console.log(`Native smoke passed: ${executablePath}`);
