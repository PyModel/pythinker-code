/**
 * `pythinker acp` sub-command.
 *
 * Starts the Agent Client Protocol (ACP) server backed directly by the
 * DI × Scope agent engine (`agent-core-v2`) over stdio, so ACP-compatible
 * clients can drive a pythinker-code session.
 *
 * `@pymodel/acp-server` (and its `agent-core-v2` engine) is loaded via a
 * lazy dynamic import so parsing the CLI does not initialize the ACP engine —
 * mirroring the `pythinker server run` v2 routing in `#/cli/sub/server/run.ts`.
 */

import type { Command } from 'commander';

import { getVersion } from '#/cli/version';
import { getDataDir } from '#/utils/paths';

export function registerAcpCommand(parent: Command): void {
  parent
    .command('acp')
    .description('Run pythinker-code as an Agent Client Protocol (ACP) server over stdio.')
    .action(async () => {
      try {
        const { runAcpServer } = await import('@pymodel/acp-server');
        await runAcpServer({
          homeDir: getDataDir(),
          agentInfo: { name: 'Pythinker Code CLI', version: getVersion() },
        });
        process.exit(0);
      } catch (error) {
        process.stderr.write(`acp server: fatal error: ${String(error)}\n`);
        process.exit(1);
      }
    });
}
