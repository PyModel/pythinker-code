/**
 * Shared login flow used by both `pythinker login` (top-level subcommand) and
 * `pythinker acp --login` (the first-class ACP terminal-auth entry point).
 * Exiting the process is part of the contract — callers MUST treat the
 * returned promise as `Promise<never>`.
 *
 * The terminal `LoginUi` renderer (`#/auth/terminal-login-ui`) shows the same
 * provider picker as the TUI's `/login`. `--provider <id|name>` skips the
 * picker; anything that does not match a known provider fails loudly rather
 * than falling back to a default. Without a TTY the flow refuses to guess and
 * exits non-zero.
 */

import { createPythinkerHarness } from '@pythoughts/pythinker-code-sdk';

import { runLogin } from '#/auth/login-flows';
import { createTerminalLoginUi, UnknownProviderError } from '#/auth/terminal-login-ui';
import { writeAndDrain } from '#/cli/output';
import { createPythinkerCodeHostIdentity } from '#/cli/version';

export interface LoginFlowOptions {
  /** `--provider <id|name>` — resolve and skip the interactive picker. */
  readonly provider?: string | undefined;
}

export async function runLoginFlow(options: LoginFlowOptions = {}): Promise<never> {
  if (!process.stdin.isTTY) {
    try {
      await writeAndDrain(
        process.stderr,
        'Login requires an interactive terminal.\n',
      );
    } finally {
      process.exit(1);
    }
  }

  const identity = createPythinkerCodeHostIdentity();
  const harness = createPythinkerHarness({
    identity,
    uiMode: 'cli',
  });
  const ui = createTerminalLoginUi(harness, { provider: options.provider });
  // Ctrl-C cancels whatever is in flight (catalog fetch, OAuth poll). While a
  // clack prompt is active, clack handles the signal itself and resolves the
  // prompt with the cancel symbol — cancelInFlight is unset then, so this is
  // a no-op and the prompt's own cancel path decides the outcome.
  process.once('SIGINT', () => {
    ui.cancelInFlight?.();
  });
  try {
    const loggedIn = await runLogin(ui);
    // Flush before exit so clack's final frame survives process.exit.
    try {
      await writeAndDrain(process.stderr, '');
    } finally {
      process.exit(loggedIn ? 0 : 1);
    }
  } catch (error) {
    const message =
      error instanceof UnknownProviderError
        ? `Unknown provider "${error.input}"\nValid provider ids: ${error.validIds.join(', ')}\n`
        : `Login failed: ${error instanceof Error ? error.message : String(error)}\n`;
    try {
      await writeAndDrain(process.stderr, message);
    } finally {
      process.exit(1);
    }
  }
}
