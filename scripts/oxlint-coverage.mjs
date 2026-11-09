import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Wraps oxlint and fails when the file walk is neutralized. A parent
// .gitignore above a worktree (or any ignore rule covering the whole tree)
// makes oxlint exit 0 with zero files walked — a green result that checked
// nothing. The lint run itself keeps oxlint's native output (CI annotation
// format included); afterwards a small probe run with a forced plain format
// walks a known directory and must report a real file count.
const MIN_FILES = Number(process.env.LINT_MIN_FILES ?? '10');
if (!Number.isFinite(MIN_FILES) || MIN_FILES <= 0) {
  process.stderr.write(`oxlint coverage check failed: LINT_MIN_FILES must be a positive number, got ${String(process.env.LINT_MIN_FILES)}\n`);
  process.exit(2);
}
const PROBE_DIR = 'scripts';

const repoBin = join(fileURLToPath(new URL('..', import.meta.url)), 'node_modules', '.bin', 'oxlint');
const bin = existsSync(repoBin) ? repoBin : 'oxlint';

const fail = (message) => {
  process.stderr.write(`oxlint coverage check failed: ${message}\n`);
  process.exit(2);
};

const res = spawnSync(bin, ['--type-aware', ...process.argv.slice(2)], { stdio: 'inherit' });
if (res.error !== undefined) fail(`could not run ${bin}: ${res.error.message}`);

const probe = spawnSync(bin, ['--type-aware', '--format=default', PROBE_DIR], {
  stdio: ['ignore', 'pipe', 'pipe'],
  encoding: 'utf8',
  maxBuffer: 512 * 1024 * 1024,
});
if (probe.error !== undefined) fail(`coverage probe could not run: ${probe.error.message}`);

const match = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.match(/on (\d+) files? /);
const files = match === null ? Number.NaN : Number(match[1]);
if (!Number.isFinite(files) || files < MIN_FILES) {
  const scanned = Number.isFinite(files) ? `${files}` : 'an unknown number of';
  fail(
    `walked only ${scanned} files under ${PROBE_DIR}, minimum is ${MIN_FILES}. ` +
      "The linter's file walk was likely neutralized (e.g. a parent .gitignore); " +
      'this run is not a real lint.',
  );
}

process.exit(res.status ?? 1);
