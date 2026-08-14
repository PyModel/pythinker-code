import { runPythinkerMcpServer } from '@pymodel/pythinker-code-sdk';
import type { Command } from 'commander';

import { getVersion } from '#/cli/version';

export interface McpCommandDeps {
  readonly cwd: () => string;
  readonly version: () => string;
  readonly runServer: typeof runPythinkerMcpServer;
}

export function registerMcpCommand(parent: Command, deps?: Partial<McpCommandDeps>): void {
  const resolved: McpCommandDeps = {
    cwd: deps?.cwd ?? (() => process.cwd()),
    version: deps?.version ?? getVersion,
    runServer: deps?.runServer ?? runPythinkerMcpServer,
  };
  const mcp = parent.command('mcp').description('Manage Model Context Protocol integrations.');
  mcp
    .command('serve')
    .description('Expose active built-in Pythinker tools as an MCP server over stdio.')
    .option('--debug', 'Enable debug diagnostics.', false)
    .option('--verbose', 'Enable verbose server mode.', false)
    .action(async (options: { debug: boolean; verbose: boolean }) => {
      await resolved.runServer({
        workDir: resolved.cwd(),
        version: resolved.version(),
        debug: options.debug,
        verbose: options.verbose,
      });
    });
}
