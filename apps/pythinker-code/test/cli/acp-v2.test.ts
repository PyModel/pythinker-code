/**
 * `pythinker acp-v2`
 *
 * Verifies that the ACP v2 sub-command is registered on the program and that
 * the action wires `@pymodel/acp-server`'s `runAcpServer` (the real server
 * is stubbed so the test doesn't actually take over stdio). The module is
 * loaded via a lazy dynamic import in the action, so the mock intercepts that
 * import.
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pymodel/acp-server', () => ({
  runAcpServer: vi.fn(async () => undefined),
}));

import { runAcpServer } from '@pymodel/acp-server';

import { registerAcpV2Command } from '#/cli/sub/acp-v2';
import { getDataDir } from '#/utils/paths';

class ExitCalled extends Error {
  constructor(public code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

describe('pythinker acp-v2', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(runAcpServer).mockClear();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      throw new ExitCalled(code);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('registers an `acp-v2` subcommand on the program', () => {
    const program = new Command('pythinker');
    registerAcpV2Command(program);

    const acpV2 = program.commands.find((c) => c.name() === 'acp-v2');
    expect(acpV2).toBeDefined();
    expect(acpV2?.description()).toMatch(/Agent Client Protocol/);
  });

  it('invokes runAcpServer with the v2 host options and exits 0 on success', async () => {
    const program = new Command('pythinker').exitOverride();
    registerAcpV2Command(program);

    await expect(program.parseAsync(['node', 'pythinker', 'acp-v2'])).rejects.toThrow(ExitCalled);

    expect(runAcpServer).toHaveBeenCalledTimes(1);
    const optsArg = vi.mocked(runAcpServer).mock.calls[0]?.[0];
    expect(optsArg).toEqual(
      expect.objectContaining({
        homeDir: getDataDir(),
        agentInfo: { name: 'Pythinker Code CLI', version: expect.any(String) },
      }),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('forwards PYTHINKER_CODE_HOME to terminalAuthEnv and homeDir when set', async () => {
    const previous = process.env['PYTHINKER_CODE_HOME'];
    process.env['PYTHINKER_CODE_HOME'] = '/tmp/pythinker-debug';
    try {
      const program = new Command('pythinker').exitOverride();
      registerAcpV2Command(program);

      await expect(program.parseAsync(['node', 'pythinker', 'acp-v2'])).rejects.toThrow(ExitCalled);

      const optsArg = vi.mocked(runAcpServer).mock.calls[0]?.[0];
      expect(optsArg).toEqual(
        expect.objectContaining({
          homeDir: '/tmp/pythinker-debug',
          terminalAuthEnv: { PYTHINKER_CODE_HOME: '/tmp/pythinker-debug' },
        }),
      );
    } finally {
      if (previous === undefined) {
        delete process.env['PYTHINKER_CODE_HOME'];
      } else {
        process.env['PYTHINKER_CODE_HOME'] = previous;
      }
    }
  });

  it('omits terminalAuthEnv when PYTHINKER_CODE_HOME is unset', async () => {
    const previous = process.env['PYTHINKER_CODE_HOME'];
    delete process.env['PYTHINKER_CODE_HOME'];
    try {
      const program = new Command('pythinker').exitOverride();
      registerAcpV2Command(program);

      await expect(program.parseAsync(['node', 'pythinker', 'acp-v2'])).rejects.toThrow(ExitCalled);

      const optsArg = vi.mocked(runAcpServer).mock.calls[0]?.[0] as {
        terminalAuthEnv?: unknown;
      };
      expect(optsArg.terminalAuthEnv).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env['PYTHINKER_CODE_HOME'];
      } else {
        process.env['PYTHINKER_CODE_HOME'] = previous;
      }
    }
  });

  it('forwards process.argv[1] as terminalAuthLegacyCommand', async () => {
    const program = new Command('pythinker').exitOverride();
    registerAcpV2Command(program);

    await expect(program.parseAsync(['node', 'pythinker', 'acp-v2'])).rejects.toThrow(ExitCalled);

    const optsArg = vi.mocked(runAcpServer).mock.calls[0]?.[0] as {
      terminalAuthLegacyCommand?: string;
    };
    expect(typeof optsArg.terminalAuthLegacyCommand).toBe('string');
    expect((optsArg.terminalAuthLegacyCommand ?? '').length).toBeGreaterThan(0);
    expect(optsArg.terminalAuthLegacyCommand).toBe(process.argv[1]);
  });

  it('exits without starting the ACP server when --login is passed', async () => {
    // Stub the SDK harness so runLoginFlow doesn't hit a real OAuth endpoint:
    // harness.auth.login resolves immediately and triggers exit 0.
    const loginStub = vi.fn(async () => ({ providerName: 'pythinker-code' }));
    vi.doMock(import('@pymodel/pythinker-code-sdk'), async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        createPythinkerHarness: () =>
          ({
            auth: { login: loginStub },
          }) as unknown as ReturnType<typeof actual.createPythinkerHarness>,
      };
    });
    vi.resetModules();
    const { registerAcpV2Command: freshRegister } = await import('#/cli/sub/acp-v2');
    try {
      const program = new Command('pythinker').exitOverride();
      freshRegister(program);

      await expect(program.parseAsync(['node', 'pythinker', 'acp-v2', '--login'])).rejects.toThrow(
        ExitCalled,
      );

      expect(loginStub).toHaveBeenCalledTimes(1);
      expect(runAcpServer).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      vi.doUnmock('@pymodel/pythinker-code-sdk');
      vi.resetModules();
    }
  });
});
