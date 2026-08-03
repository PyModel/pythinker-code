import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import { registerMcpCommand } from '#/cli/sub/mcp';

describe('pythinker mcp serve', () => {
  it('starts the built-in tool server for the current directory', async () => {
    const runServer = vi.fn().mockResolvedValue(undefined);
    const program = new Command('pythinker');
    registerMcpCommand(program, {
      cwd: () => '/workspace',
      version: () => '1.2.3',
      runServer,
    });

    await program.parseAsync(['node', 'pythinker', 'mcp', 'serve', '--debug', '--verbose']);

    expect(runServer).toHaveBeenCalledWith({
      workDir: '/workspace',
      version: '1.2.3',
      debug: true,
      verbose: true,
    });
  });
});
