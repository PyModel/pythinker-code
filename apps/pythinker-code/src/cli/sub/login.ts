/**
 * `pythinker login` — interactive multi-provider login. The action drives the
 * same provider picker the TUI's `/login` offers (OAuth and API-key flows,
 * plus every catalog provider). `--provider <id|name>` skips the picker.
 *
 * The `authMethods.terminal-auth.args=['login']` (legacy `_meta` path)
 * advertised by the ACP server points clients at this entry point. The
 * first-class ACP `args=['--login']` path enters the same flow via
 * `pythinker acp --login`.
 */

import type { Command } from 'commander';

import { runLoginFlow } from './login-flow';

export function registerLoginCommand(parent: Command): void {
  parent
    .command('login')
    .description('Log in to a model provider.')
    .option(
      '-p, --provider <id|name>',
      'provider id or name to log in to (skips provider selection)',
    )
    .action(async (opts: { provider?: string }) => {
      await runLoginFlow({ provider: opts.provider });
    });
}
