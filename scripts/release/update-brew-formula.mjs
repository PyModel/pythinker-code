/**
 * Write Formula/pythinker-code.rb in PyModel/homebrew-tap for the released
 * version. The formula installs the native per-platform tarball from the
 * GitHub release (macOS and Linux, arm64 and x64), so Homebrew users need no
 * Node.js and run the same binary the native installer ships.
 *
 * The job runs after publish-native-assets, but the release download URL can
 * still lag the upload, so each tarball is polled until it is fetchable and
 * hashed from the downloaded bytes (fetch, sleep, and clock are injected so
 * the poll is unit-testable without a network or a real wait). A tarball that
 * never appears fails the job once the budget runs out.
 *
 * After the push, the formula is read back from the tap's main branch and
 * compared byte for byte, so a green job proves the tap serves this version.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ASSET_POLL_BUDGET_MS = 600_000;
export const ASSET_POLL_INTERVAL_MS = 15_000;
const PUSH_ATTEMPTS = 3;

const RELEASES_BASE = 'https://github.com/PyModel/pythinker-code/releases/download';
const FORMULA_PATH = 'Formula/pythinker-code.rb';

/** Homebrew platform branch → native release target. */
export const BREW_TARGETS = {
  macosArm: 'darwin-arm64',
  macosIntel: 'darwin-x64',
  linuxArm: 'linux-arm64',
  linuxIntel: 'linux-x64',
};

export function nativeTarballUrl(version, target) {
  const tag = encodeURIComponent(`@pymodel/pythinker-code@${version}`);
  return `${RELEASES_BASE}/${tag}/pythinker-code-${target}.tar.gz`;
}

function redactGitOutput(value, token) {
  const redacted = String(value ?? '').replaceAll(/\/\/x-access-token:[^@\s]*@/gu, '//***@');
  return token.length >= 8 ? redacted.replaceAll(token, '***') : redacted;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function downloadWhenAvailable(options) {
  const { url, fetchImpl, sleep, now, budgetMs, intervalMs, log = console.log } = options;
  const deadline = now() + budgetMs;
  let attempts = 0;
  let lastError;

  for (;;) {
    attempts += 1;
    try {
      const response = await fetchImpl(url);
      if (response.status === 200) {
        const body = Buffer.from(await response.arrayBuffer());
        if (body.length > 0) return { body, attempts };
        lastError = new Error(`Failed to download ${url}: empty body`);
      } else {
        lastError = new Error(`Failed to download ${url}: HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = new Error(`Failed to download ${url}: ${errorMessage(error)}`, { cause: error });
    }

    const message = lastError?.message ?? `Failed to download ${url}`;
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new Error(`${message} after ${attempts} attempt(s)`);
    }
    const waitMs = remainingMs < intervalMs ? remainingMs : intervalMs;
    log(`${message} (attempt ${attempts}); retrying in ${waitMs / 1000}s`);
    await sleep(waitMs);
  }
}

/** `assets` maps each BREW_TARGETS value to `{ url, sha256 }`. */
export function renderFormula({ version, assets }) {
  const pair = (target, indent) => {
    const asset = assets[target];
    if (asset === undefined) throw new Error(`missing Homebrew asset for ${target}`);
    if (!/^[a-f0-9]{64}$/u.test(asset.sha256)) throw new Error(`invalid sha256 for ${target}`);
    return `${indent}url "${asset.url}"\n${indent}sha256 "${asset.sha256}"`;
  };
  const branch = (armTarget, intelTarget) =>
    [
      '    if Hardware::CPU.arm?',
      pair(armTarget, '      '),
      '    else',
      pair(intelTarget, '      '),
      '    end',
    ].join('\n');

  return `class PythinkerCode < Formula
  desc "Terminal-native AI engineering agent by PyModel"
  homepage "https://code.pythinker.com"
  version "${version}"
  license "MIT"

  on_macos do
${branch(BREW_TARGETS.macosArm, BREW_TARGETS.macosIntel)}
  end

  on_linux do
${branch(BREW_TARGETS.linuxArm, BREW_TARGETS.linuxIntel)}
  end

  def install
    bin.install "pythinker"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/pythinker --version").strip
  end
end
`;
}

function git(args, options, token) {
  try {
    return execFileSync('git', args, { stdio: 'pipe', encoding: 'utf8', ...options });
  } catch (error) {
    const stderr = redactGitOutput(error.stderr, token).trim();
    const stdout = redactGitOutput(error.stdout, token).trim();
    const message = redactGitOutput(error.message, token).trim();
    throw new Error(`git ${args[0]} failed: ${stderr || stdout || message}`, { cause: error });
  }
}

async function main() {
  const packageJson = JSON.parse(readFileSync(new URL('../../apps/pythinker-code/package.json', import.meta.url), 'utf8'));
  const version = packageJson.version;

  // One budget for all four tarballs, so the poll always ends inside the
  // job's timeout.
  const deadline = Date.now() + ASSET_POLL_BUDGET_MS;
  const assets = {};
  for (const target of Object.values(BREW_TARGETS)) {
    const url = nativeTarballUrl(version, target);
    const { body } = await downloadWhenAvailable({
      url,
      fetchImpl: (input) => fetch(input, { signal: AbortSignal.timeout(120_000) }),
      sleep: (ms) =>
        new Promise((resolve) => {
          setTimeout(resolve, ms);
        }),
      now: () => Date.now(),
      budgetMs: Math.max(0, deadline - Date.now()),
      intervalMs: ASSET_POLL_INTERVAL_MS,
    });
    assets[target] = { url, sha256: createHash('sha256').update(body).digest('hex') };
  }
  const formula = renderFormula({ version, assets });

  const token = process.env.TAP_GITHUB_TOKEN;
  if (!token) throw new Error('TAP_GITHUB_TOKEN is required');

  const tapDir = mkdtempSync(join(tmpdir(), 'tap-'));
  try {
    git(['clone', `https://x-access-token:${token}@github.com/PyModel/homebrew-tap.git`, tapDir], {}, token);
    writeFileSync(join(tapDir, FORMULA_PATH), formula);

    const diff = spawnSync('git', ['diff', '--quiet'], { cwd: tapDir, stdio: 'ignore' });
    if (diff.error || (diff.status !== 0 && diff.status !== 1)) throw new Error('Failed to inspect Homebrew tap changes');
    if (diff.status === 0) {
      console.log(`Homebrew formula is already at ${version}`);
      return;
    }

    git(['add', FORMULA_PATH], { cwd: tapDir }, token);
    git(
      [
        '-c',
        'user.name=github-actions[bot]',
        '-c',
        'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit',
        '-m',
        `pythinker-code ${version}`,
      ],
      { cwd: tapDir },
      token,
    );
    for (let attempt = 1; ; attempt += 1) {
      try {
        git(['push', 'origin', 'HEAD:main'], { cwd: tapDir }, token);
        break;
      } catch (error) {
        if (attempt >= PUSH_ATTEMPTS) throw error;
        console.log(`${errorMessage(error)}; rebasing onto the tap's main and retrying`);
        git(['pull', '--rebase', 'origin', 'main'], { cwd: tapDir }, token);
      }
    }

    git(['fetch', 'origin', 'main'], { cwd: tapDir }, token);
    const published = git(['show', `origin/main:${FORMULA_PATH}`], { cwd: tapDir }, token);
    if (published !== formula) {
      throw new Error(`The tap's main does not serve the ${version} formula after the push`);
    }
    console.log(`Homebrew tap serves pythinker-code ${version}`);
  } finally {
    rmSync(tapDir, { recursive: true, force: true });
  }
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
