import { describe, expect, it, vi } from 'vitest';

import type { Session } from '@pymodel/pythinker-code-sdk';

import { handleTowerCommand } from '#/tui/commands/index';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import {
  NO_ACTIVE_SESSION_MESSAGE,
  TOWER_STATUS_PROMPT,
  TOWER_TEARDOWN_PROMPT,
} from '#/tui/constant/pythinker-tui';

function makeHost(
  overrides: {
    hasSession?: boolean;
    towerMode?: boolean;
    engineV2?: boolean;
    refuseTowerEntry?: boolean;
  } = {},
) {
  let engineMode = overrides.towerMode ?? false;
  const session = {
    setTowerMode: vi.fn(async (enabled: boolean) => {
      if (!(overrides.refuseTowerEntry && enabled)) engineMode = enabled;
    }),
    getStatus: vi.fn(async () => ({ towerMode: engineMode })),
  };
  const host = {
    state: {
      appState: {
        towerMode: overrides.towerMode ?? false,
      },
    },
    engineV2: overrides.engineV2 ?? true,
    session: overrides.hasSession === false ? undefined : session,
    ensureSession: vi.fn(async () => {
      host.session = session as unknown as Session;
      return session as unknown as Session;
    }),
    requireSession: () => {
      if (host.session === undefined) throw new Error('No active session');
      return host.session;
    },
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    sendNormalUserInput: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session };
}

describe('handleTowerCommand', () => {
  it('routes status and teardown without changing the mode', async () => {
    const { host, session } = makeHost({ towerMode: true });

    await handleTowerCommand(host, '');
    await handleTowerCommand(host, 'status');
    await handleTowerCommand(host, 'teardown');

    expect(host.sendNormalUserInput).toHaveBeenNthCalledWith(1, TOWER_STATUS_PROMPT);
    expect(host.sendNormalUserInput).toHaveBeenNthCalledWith(2, TOWER_STATUS_PROMPT);
    expect(host.sendNormalUserInput).toHaveBeenNthCalledWith(3, TOWER_TEARDOWN_PROMPT);
    expect(session.setTowerMode).not.toHaveBeenCalled();
  });

  it('turns tower mode on and off', async () => {
    const { host, session } = makeHost();

    await handleTowerCommand(host, 'on');
    await handleTowerCommand(host, 'off');

    expect(session.setTowerMode).toHaveBeenNthCalledWith(1, true, undefined);
    expect(session.setTowerMode).toHaveBeenNthCalledWith(2, false, undefined);
    expect(host.showNotice).toHaveBeenNthCalledWith(1, 'Tower mode: ON');
    expect(host.showNotice).toHaveBeenNthCalledWith(2, 'Tower mode: OFF');
  });

  it('turns tower mode on with a base branch', async () => {
    const { host, session } = makeHost();

    await handleTowerCommand(host, 'develop');

    expect(session.setTowerMode).toHaveBeenCalledWith(true, 'develop');
    expect(host.setAppState).toHaveBeenCalledWith({ towerMode: true });
    expect(host.showNotice).toHaveBeenCalledWith('Tower mode: ON (base: develop)');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('updates the base when tower mode is already on', async () => {
    const { host, session } = makeHost({ towerMode: true });

    await handleTowerCommand(host, 'develop');

    expect(session.setTowerMode).toHaveBeenCalledWith(true, 'develop');
    expect(host.showNotice).toHaveBeenCalledWith('Tower base: develop');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not show the base notice when enabling with a base fails', async () => {
    const { host, session } = makeHost();
    session.setTowerMode.mockRejectedValueOnce(new Error('not a local branch'));

    await handleTowerCommand(host, 'develop');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to enable tower mode'),
    );
    expect(host.showNotice).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not show ON when the engine refuses tower entry', async () => {
    const { host } = makeHost({ refuseTowerEntry: true });

    await handleTowerCommand(host, 'on');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('could not be enabled'));
    expect(host.setAppState).toHaveBeenCalledWith({ towerMode: false });
    expect(host.showNotice).not.toHaveBeenCalled();
  });

  it('lazy-creates a v2 session and rejects a missing legacy session', async () => {
    const current = makeHost({ hasSession: false });
    await handleTowerCommand(current.host, 'on');
    expect(current.host.ensureSession).toHaveBeenCalledOnce();
    expect(current.session.setTowerMode).toHaveBeenCalledWith(true, undefined);

    const legacy = makeHost({ hasSession: false, engineV2: false });
    await handleTowerCommand(legacy.host, 'on');
    expect(legacy.host.showError).toHaveBeenCalledWith(expect.stringContaining('session'));
    expect(legacy.host.ensureSession).not.toHaveBeenCalled();
  });

  it('rejects a legacy host even when it already has a session', async () => {
    const { host, session } = makeHost({ engineV2: false });

    await handleTowerCommand(host, 'on');

    expect(host.showError).toHaveBeenCalledWith(NO_ACTIVE_SESSION_MESSAGE);
    expect(session.setTowerMode).not.toHaveBeenCalled();
    expect(host.ensureSession).not.toHaveBeenCalled();
  });
});
