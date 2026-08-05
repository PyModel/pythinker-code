// Publishing to a registry fails in three different ways, and they need three
// different responses: a flaky network call should be retried, a bad token
// should stop everything immediately, and a rejected package should fail only
// its own target so the remaining ones still ship.
const TRANSIENT_PATTERN =
  /request timeout|etimedout|econnreset|econnrefused|enotfound|eai_again|socket hang up|network|\b(?:429|500|502|503|504)\b|too many requests|service unavailable|gateway/i;
const AUTH_PATTERN = /\b401\b|unauthorized|invalidaccess|access denied|not allowed|forbidden|\b403\b|authentication|invalid token|expired/i;

export const DEFAULT_ATTEMPTS = 3;

export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `auth` aborts the whole run — every remaining target would fail identically.
 * `transient` is worth retrying. `fatal` fails one target and lets the rest go.
 */
export function classifyError(error) {
  const message = messageOf(error);
  if (AUTH_PATTERN.test(message)) return 'auth';
  if (TRANSIENT_PATTERN.test(message)) return 'transient';
  return 'fatal';
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs `action`, retrying only transient failures with a widening backoff.
 * Returns the action's value; rethrows the last error once attempts run out.
 */
export async function withRetry(action, options = {}) {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const label = options.label ?? 'operation';
  const backoffMs = options.backoffMs ?? [5000, 15000];

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const kind = classifyError(error);
      if (kind !== 'transient' || attempt >= attempts) {
        throw error;
      }
      const wait = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)];
      console.warn(`${label}: ${kind} failure on attempt ${attempt}/${attempts}, retrying in ${wait / 1000}s...`);
      console.warn(`  ${messageOf(error).split('\n')[0]}`);
      await delay(wait);
    }
  }
}

/**
 * Publishes every target, keeping going after a per-target failure so one flaky
 * upload cannot strand the rest. Throws a summary naming exactly which targets
 * are live and which still need a re-run, because a half-published version is
 * the state that is hardest to reason about afterwards.
 */
export async function publishEachTarget({ targets, files, registry, publishOne }) {
  const published = [];
  const skipped = [];
  const failures = [];
  let abortReason = '';

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const file = files[index];
    if (abortReason) {
      failures.push({ target, message: `not attempted (${abortReason})` });
      continue;
    }
    console.log(`Publishing verified package ${file}...`);
    try {
      const outcome = await withRetry(() => publishOne(file, target), { label: `${registry} ${target}` });
      (outcome === 'skipped' ? skipped : published).push(target);
    } catch (error) {
      const kind = classifyError(error);
      failures.push({ target, message: messageOf(error).split('\n')[0] });
      if (kind === 'auth') {
        abortReason = 'aborted after an authentication failure';
      }
    }
  }

  summarize({ registry, published, skipped, failures });
  if (failures.length > 0) {
    throw new Error(
      `${registry}: ${failures.length} of ${targets.length} target(s) failed. ` +
        `Published targets are live and will be skipped on a re-run — fix the cause and run the publish command again.`,
    );
  }
  return { published, skipped };
}

function summarize({ registry, published, skipped, failures }) {
  console.log(`\n${registry} summary:`);
  if (published.length > 0) console.log(`  published: ${published.join(', ')}`);
  if (skipped.length > 0) console.log(`  already published: ${skipped.join(', ')}`);
  for (const failure of failures) {
    console.log(`  FAILED ${failure.target}: ${failure.message}`);
  }
}
