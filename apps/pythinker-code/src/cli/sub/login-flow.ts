/**
 * Shared device-code login flow used by both `pythinker login` (top-level
 * subcommand) and `pythinker acp --login` (the first-class ACP terminal-auth
 * entry point). Exiting the process is part of the contract — callers
 * MUST treat the returned promise as `Promise<never>`.
 */

import { createPythinkerHarness } from '@pythoughts/pythinker-code-sdk';

import { writeAndDrain } from '#/cli/output';
import { createPythinkerCodeHostIdentity } from '#/cli/version';
import { openUrl } from '#/utils/open-url';

export async function runLoginFlow(): Promise<never> {
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
    // Flush before exit so the confirmation survives process.exit.
    try {
      await writeAndDrain(process.stderr, `Logged in to ${result.providerName}.\n`);
    } finally {
      process.exit(0);
    }
  } catch (error) {
    const message = controller.signal.aborted
      ? 'Login cancelled.\n'
      : `Login failed: ${error instanceof Error ? error.message : String(error)}\n`;
    try {
      await writeAndDrain(process.stderr, message);
    } finally {
      process.exit(1);
    }
  }
}
