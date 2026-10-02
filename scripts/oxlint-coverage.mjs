import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Wraps oxlint and fails when the file walk is neutralized. A parent
// .gitignore above a worktree (or any ignore rule covering the whole tree)
// makes oxlint exit 0 with "on 0 files" — a green result that checked
// nothing. This guard turns that into a hard failure.
const MIN_FILES = Number(process.env.LINT_MIN_FILES ?? '1000');

const repoBin = join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', '.bin', 'oxlint');
const bin = existsSync(repoBin) ? repoBin : 'oxlint';

const res = spawnSync(bin, ['--type-aware', ...process.argv.slice(2)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024,
});

const fail = (message) => {
  process.stderr.write(`oxlint coverage check failed: ${message}\n`);
  process.exit(2);
};

if (res.error !== undefined) fail(`could not run ${bin}: ${res.error.message}`);

process.stdout.write(res.stdout ?? '');
process.stderr.write(res.stderr ?? '');

const match = `${res.stdout ?? ''}${res.stderr ?? ''}`.match(/on (\d+) files? /);
const files = match === null ? Number.NaN : Number(match[1]);
if (!Number.isFinite(files) || files < MIN_FILES) {
  const scanned = Number.isFinite(files) ? `${files}` : 'an unknown number of';
  fail(
    `scanned ${scanned} files, minimum is ${MIN_FILES}. ` +
      "The linter's file walk was likely neutralized (e.g. a parent .gitignore); " +
      'this run is not a real lint.',
  );
}

process.exit(res.status ?? 1);
