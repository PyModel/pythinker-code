import { describe, expect, it, vi } from 'vitest';

import { handleAdvisorCommand } from '#/tui/commands/index';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

function makeHost() {
  const securityStatus = {
    id: 'security',
    name: 'Security',
    enabled: true,
    status: 'running' as const,
    model: 'reviewer',
    failures: 0,
    notes: 2,
    costUsd: 0.0123,
  };
  const advisor = {
    status: vi.fn(async () => [securityStatus]),
    setEnabled: vi.fn(async () => [securityStatus]),
    reload: vi.fn(async () => []),
  };
  const host = {
    session: { advisor },
    showError: vi.fn(),
    showNotice: vi.fn(),
    showStatus: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, advisor, securityStatus };
}

describe('handleAdvisorCommand', () => {
  it('renders advisor status with runtime details', async () => {
    const { host } = makeHost();

    await handleAdvisorCommand(host, 'status');

    expect(host.showNotice).toHaveBeenCalledWith(
      'Advisor status',
      expect.stringContaining('● Security [running]'),
    );
    expect(host.showNotice).toHaveBeenCalledWith(
      'Advisor status',
      expect.stringContaining('2 notes · $0.0123'),
    );
  });
  it('rejects an unknown advisor instead of reporting success', async () => {
    const { host, advisor } = makeHost();
    advisor.setEnabled.mockResolvedValueOnce([]);

    await handleAdvisorCommand(host, 'on securty');

    expect(host.showError).toHaveBeenCalledWith(
      'Unknown advisor: securty. Run /advisor status to list configured advisors.',
    );
    expect(host.showStatus).not.toHaveBeenCalled();
  });
  it('does not report success when the runtime status remains disabled', async () => {
    const { host, advisor, securityStatus } = makeHost();
    advisor.setEnabled.mockResolvedValueOnce([{ ...securityStatus, enabled: false }]);

    await handleAdvisorCommand(host, 'on security');

    expect(host.showError).toHaveBeenCalledWith('Advisor security remains disabled.');
    expect(host.showStatus).not.toHaveBeenCalled();
  });
  it('does not report global enable success for an empty advisor set', async () => {
    const { host, advisor } = makeHost();
    advisor.status.mockResolvedValueOnce([]);
    advisor.setEnabled.mockResolvedValueOnce([]);

    await handleAdvisorCommand(host, 'on');

    expect(host.showError).toHaveBeenCalledWith('Advisor remains disabled.');
    expect(host.showStatus).not.toHaveBeenCalled();
  });

  it('toggles one advisor without changing its configuration file', async () => {
    const { host, advisor, securityStatus } = makeHost();
    advisor.setEnabled.mockResolvedValueOnce([{ ...securityStatus, enabled: false }]);

    await handleAdvisorCommand(host, 'off security');

    expect(advisor.setEnabled).toHaveBeenCalledWith(false, 'security');
    expect(host.showStatus).toHaveBeenCalledWith('Advisor security disabled.');
  });

  it('reloads watchdog configuration', async () => {
    const { host, advisor } = makeHost();

    await handleAdvisorCommand(host, 'reload');

    expect(advisor.reload).toHaveBeenCalledOnce();
    expect(host.showStatus).toHaveBeenCalledWith('Advisor configuration reloaded.');
  });
});
