/**
 * Shared device-code login flow used by both `pythinker login` (top-level
 * subcommand) and `pythinker acp --login` (the first-class ACP terminal-auth
 * entry point). Exiting the process is part of the contract — callers
 * MUST treat the returned promise as `Promise<never>`.
 */

import { createPythinkerHarness } from '@pymodel/pythinker-code-sdk';
import type { PythinkerRegion } from '@pymodel/pythinker-code-oauth';

import { createPythinkerCodeHostIdentity } from '#/cli/version';
import { openUrl } from '#/utils/open-url';
import { persistedPythinkerOAuthRef, regionForBareLogin } from '#/utils/region';

/** Parse a `--region` CLI flag; exits with an actionable message on bad input. */
export function parseRegionFlag(value: string): PythinkerRegion {
  if (value !== 'mainland-cn' && value !== 'global') {
    process.stderr.write(`Invalid --region "${value}" (expected "mainland-cn" or "global").\n`);
    process.exit(1);
  }
  return value;
}

export async function runLoginFlow(options: { region?: PythinkerRegion } = {}): Promise<never> {
  // No flag: a fresh install follows the resolved region (env/marker/
  // default); an existing login keeps its own environment (see
  // regionForBareLogin — the default slot re-pins mainland-cn, a scoped slot
  // keeps its configured hosts).
  const region = options.region ?? regionForBareLogin(persistedPythinkerOAuthRef());
  const identity = createPythinkerCodeHostIdentity();
  const harness = createPythinkerHarness({
    identity,
    uiMode: 'cli',
  });
  const controller = new AbortController();
  process.once('SIGINT', () => {
    controller.abort();
  });
  try {
    const result = await harness.auth.login(undefined, {
      signal: controller.signal,
      region,
      onDeviceCode: (data) => {
        const url = data.verificationUriComplete || data.verificationUri;
        // Print the manual fallback before attempting to open the user's
        // browser so headless/browser-opener failures never hide the URL
        // and code needed to complete login.
        process.stderr.write(
          [
            '',
            `Opening browser for Pythinker device login: ${url}`,
            `If the browser did not open, paste the URL above and enter code: ${data.userCode}`,
            data.expiresIn !== null && data.expiresIn !== undefined
              ? `Code expires in ${data.expiresIn}s.`
              : undefined,
            'Waiting for authorization to complete...',
            '',
          ]
            .filter((line): line is string => line !== undefined)
            .join('\n'),
        );
        try {
          openUrl(url);
        } catch {
          // Best effort only: the manual fallback has already been printed.
        }
      },
    });
    process.stderr.write(`Logged in to ${result.providerName}.\n`);
    process.exit(0);
  } catch (error) {
    if (controller.signal.aborted) {
      process.stderr.write('Login cancelled.\n');
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Login failed: ${message}\n`);
    }
    process.exit(1);
  }
}
