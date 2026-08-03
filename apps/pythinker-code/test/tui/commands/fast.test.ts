import { describe, expect, it, vi } from 'vitest';

import { handleFastCommand } from '#/tui/commands/fast';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

function makeHost(options: {
  readonly hasSession?: boolean;
  readonly model?: string;
  readonly fastMode?: boolean;
  readonly fastModeSupported?: boolean;
} = {}) {
  const session = {
    getStatus: vi.fn(async () => ({
      fastMode: options.fastMode ?? false,
      fastModeSupported: options.fastModeSupported ?? true,
    })),
    setFastMode: vi.fn(async () => {}),
  };
  const host = {
    session: options.hasSession === false ? undefined : session,
    state: {
      appState: {
        model: options.model ?? 'openai/gpt-5.6-sol',
        fastMode: options.fastMode ?? false,
        fastModeSupported: options.fastModeSupported ?? true,
      },
    },
    requireSession: () => session,
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session };
}

describe('handleFastCommand', () => {
  it('enables provider-native Fast mode and warns about premium usage', async () => {
    const { host, session } = makeHost();

    await handleFastCommand(host, 'on');

    expect(session.setFastMode).toHaveBeenCalledWith(true);
    expect(host.setAppState).toHaveBeenCalledWith({
      fastMode: true,
      fastModeSupported: true,
    });
    expect(host.showNotice).toHaveBeenCalledWith(
      '↯ Fast mode on',
      expect.stringContaining('premium'),
    );
  });

  it('toggles Fast mode off when called without arguments', async () => {
    const { host, session } = makeHost({ fastMode: true });

    await handleFastCommand(host, '');

    expect(session.setFastMode).toHaveBeenCalledWith(false);
    expect(host.setAppState).toHaveBeenCalledWith({
      fastMode: false,
      fastModeSupported: true,
    });
    expect(host.showStatus).toHaveBeenCalledWith('Fast mode off.');
  });

  it('reports current status without changing it', async () => {
    const { host, session } = makeHost({ fastMode: true });

    await handleFastCommand(host, 'status');

    expect(session.setFastMode).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith('↯ Fast mode is on.');
  });

  it('rejects enabling Fast mode when the current model/provider does not support it', async () => {
    const { host, session } = makeHost({ fastModeSupported: false });

    await handleFastCommand(host, 'on');

    expect(session.setFastMode).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith(
      'Fast mode is unavailable for the current model and provider.',
    );
  });

  it('reports unavailable status without changing the session', async () => {
    const { host, session } = makeHost({ fastModeSupported: false });

    await handleFastCommand(host, 'status');

    expect(session.setFastMode).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith(
      'Fast mode is unavailable for the current model and provider.',
      'warning',
    );
  });

  it('rejects unknown subcommands', async () => {
    const { host, session } = makeHost();

    await handleFastCommand(host, 'turbo');

    expect(session.getStatus).not.toHaveBeenCalled();
    expect(session.setFastMode).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith('Usage: /fast [on|off|status]');
  });
});
