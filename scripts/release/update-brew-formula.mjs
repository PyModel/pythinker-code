/**
 * Bump Formula/pythinker-code.rb in PyModel/homebrew-tap to the published npm
 * tarball. `changeset publish` can succeed several minutes before the public
 * GET of `/-/pythinker-code-<version>.tgz` returns 200, so the download polls
 * until the tarball is fetchable (fetch, sleep, and clock are injected so the
 * poll is unit-testable without a network or a real wait).
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NPM_TARBALL_POLL_BUDGET_MS = 600_000;
export const NPM_TARBALL_POLL_INTERVAL_MS = 15_000;

function redactGitOutput(value, token) {
  const redacted = String(value ?? '').replaceAll(/\/\/x-access-token:[^@\s]*@/gu, '//***@');
  return token.length >= 8 ? redacted.replaceAll(token, '***') : redacted;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function downloadNpmTarball(options) {
  const { url, fetchImpl, sleep, now, budgetMs, intervalMs, log = console.log } = options;
  const deadline = now() + budgetMs;
  let attempts = 0;
  let lastError = new Error('Failed to download npm tarball');

  for (;;) {
    attempts += 1;
    try {
      const response = await fetchImpl(url);
      if (response.status === 200) {
        const tarball = Buffer.from(await response.arrayBuffer());
        if (tarball.length > 0) return { tarball, attempts };
        lastError = new Error('Failed to download npm tarball: empty body');
      } else {
        lastError = new Error(`Failed to download npm tarball: HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = new Error(`Failed to download npm tarball: ${errorMessage(error)}`, { cause: error });
    }

    if (now() + intervalMs >= deadline) {
      throw new Error(`${lastError.message} after ${attempts} attempt(s)`);
    }
    log(`${lastError.message} (attempt ${attempts}); retrying in ${intervalMs / 1000}s`);
    await sleep(intervalMs);
  }
}

async function main() {
  const packageJson = JSON.parse(readFileSync(new URL('../../apps/pythinker-code/package.json', import.meta.url), 'utf8'));
  const version = packageJson.version;
  const tarballUrl = `https://registry.npmjs.org/@pymodel/pythinker-code/-/pythinker-code-${version}.tgz`;
  const { tarball } = await downloadNpmTarball({
    url: tarballUrl,
    fetchImpl: (url) => fetch(url, { signal: AbortSignal.timeout(15_000) }),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
    now: () => Date.now(),
    budgetMs: NPM_TARBALL_POLL_BUDGET_MS,
    intervalMs: NPM_TARBALL_POLL_INTERVAL_MS,
  });
  const sha256 = createHash('sha256').update(tarball).digest('hex');

  const token = process.env.TAP_GITHUB_TOKEN;
  if (!token) throw new Error('TAP_GITHUB_TOKEN is required');

  const tapDir = mkdtempSync(join(tmpdir(), 'tap-'));
  try {
    try {
      execFileSync('git', ['clone', `https://x-access-token:${token}@github.com/PyModel/homebrew-tap.git`, tapDir], {
        stdio: 'pipe',
      });
    } catch (error) {
      const stderr = redactGitOutput(error.stderr, token).trim();
      const stdout = redactGitOutput(error.stdout, token).trim();
      const message = redactGitOutput(error.message, token).trim();
      throw new Error(`Failed to clone Homebrew tap: ${stderr || stdout || message}`, { cause: error });
    }

    const formulaPath = join(tapDir, 'Formula/pythinker-code.rb');
    const formula = readFileSync(formulaPath, 'utf8');
    const urlPattern = /^([ \t]*)url "[^"\r\n]*"(\r?)$/gm;
    const shaPattern = /^([ \t]*)sha256 "[^"\r\n]*"(\r?)$/gm;
    if ([...formula.matchAll(urlPattern)].length !== 1) throw new Error('Expected exactly one formula url line');
    if ([...formula.matchAll(shaPattern)].length !== 1) throw new Error('Expected exactly one formula sha256 line');

    const updatedFormula = formula
      .replace(urlPattern, (_, indent, eol) => `${indent}url "${tarballUrl}"${eol}`)
      .replace(shaPattern, (_, indent, eol) => `${indent}sha256 "${sha256}"${eol}`);
    writeFileSync(formulaPath, updatedFormula);

    const diff = spawnSync('git', ['diff', '--quiet'], { cwd: tapDir, stdio: 'ignore' });
    if (diff.error || (diff.status !== 0 && diff.status !== 1)) throw new Error('Failed to inspect Homebrew tap changes');
    if (diff.status === 0) {
      console.log(`Homebrew formula is already at ${version}`);
      return;
    }

    execFileSync('git', ['add', 'Formula/pythinker-code.rb'], { cwd: tapDir, stdio: 'inherit' });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=github-actions[bot]',
        '-c',
        'user.email=41898282+github-actions[bot]@users.noreply.github.com',
        'commit',
        '-m',
        `pythinker-code ${version}`,
      ],
      { cwd: tapDir, stdio: 'inherit' },
    );
    try {
      execFileSync('git', ['push', 'origin', 'main'], { cwd: tapDir, stdio: 'pipe' });
    } catch (error) {
      const stderr = redactGitOutput(error.stderr, token).trim();
      const stdout = redactGitOutput(error.stdout, token).trim();
      const message = redactGitOutput(error.message, token).trim();
      throw new Error(`Failed to push Homebrew tap: ${stderr || stdout || message}`, { cause: error });
    }
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
