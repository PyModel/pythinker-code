import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands';
import { handleAddDirCommand } from '#/tui/commands/add-dir';

describe('add-dir slash command', () => {
  it('adds a validated directory to the active session', async () => {
    const host = makeHost();

    await handleAddDirCommand(host, '/tmp/extra');
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    picker.handleInput('\r');

    await vi.waitFor(() => {
      expect(host.session.addWorkspaceDirectory).toHaveBeenCalledWith('/tmp/extra');
    });
    expect(host.showNotice).toHaveBeenCalledWith(
      'Added /tmp/extra as a working directory for this session',
      '/permissions to manage',
    );
  });

  it('can remember a directory in user configuration', async () => {
    const host = makeHost();

    await handleAddDirCommand(host, '/tmp/extra');
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    picker.handleInput('\u001B[B');
    picker.handleInput('\r');

    await vi.waitFor(() => {
      expect(host.harness.setConfig).toHaveBeenCalledWith({
        additionalDirs: ['/tmp/existing', '/tmp/extra'],
      });
    });
    expect(host.showNotice).toHaveBeenCalledWith(
      'Added /tmp/extra as a working directory and saved to user settings',
      '/permissions to manage',
    );
  });

  it('opens a path input when invoked without arguments', async () => {
    const host = makeHost();

    await handleAddDirCommand(host, '');

    const input = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      render(width: number): string[];
    };
    expect(input.render(100).join('\n')).toContain('Add working directory');
  });
});

function makeHost() {
  const session = {
    addWorkspaceDirectory: vi.fn(async () => ({
      path: '/tmp/extra',
      source: 'session' as const,
    })),
  };
  const harness = {
    getConfig: vi.fn(async () => ({
      providers: {},
      additionalDirs: ['/tmp/existing'],
    })),
    setConfig: vi.fn(async () => ({ providers: {} })),
  };
  return {
    session,
    harness,
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    showError: vi.fn(),
    showNotice: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost & {
    session: typeof session;
    harness: typeof harness;
    mountEditorReplacement: ReturnType<typeof vi.fn>;
    restoreEditor: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    showNotice: ReturnType<typeof vi.fn>;
  };
}
