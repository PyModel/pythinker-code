/**
 * Deprecated `pythinker server` shim.
 *
 * The `pythinker server` command tree was replaced by `pythinker web` (a foreground
 * server opened in the browser). Any `pythinker server …` invocation — bare or
 * with any legacy subcommand/flags — lands here, prints the deprecation
 * notice, and exits 1. The shim itself is scheduled for removal in the next
 * major version of Pythinker Code.
 *
 * One subcommand stays functional: `pythinker server kill`, the cleanup path for
 * background servers started by pre-0.28.0 builds (recorded in the legacy
 * single-instance lock, which the instance registry never sees).
 */

import type { Command } from 'commander';

import { registerLegacyKillCommand } from './legacy-kill';

export const DEPRECATED_SERVER_NOTICE =
  '`pythinker server` has been deprecated and no longer works.\n' +
  'Use `pythinker web` instead — it runs the local server in the foreground and opens the web UI (`--no-open` to skip).\n' +
  'To stop a server started by a version before 0.28.0, use `pythinker server kill`.\n' +
  'This notice will be removed in the next major version of Pythinker Code.\n';

export function registerDeprecatedServerCommand(program: Command): void {
  const server = program
    .command('server')
    .description('Deprecated — use `pythinker web` instead.')
    // Swallow every legacy subcommand/flag (`run`, `kill`, `--port`, …) so
    // they all land in the same notice instead of a commander parse error.
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => {
      process.stderr.write(DEPRECATED_SERVER_NOTICE);
      process.exit(1);
    });
  registerLegacyKillCommand(server);
}
