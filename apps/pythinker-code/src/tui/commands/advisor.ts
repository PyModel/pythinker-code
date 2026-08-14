import { formatErrorMessage, type AdvisorStatusSnapshot } from '@pymodel/pythinker-code-sdk';
import type { SlashCommandHost } from './dispatch';

const ADVISOR_STATUS_GLYPHS: Record<string, string> = {
  running: '●',
  paused: '○',
  no_model: '○',
  quota_exhausted: '✕',
  error: '✕',
};

const ADVISOR_STATUS_LABELS: Record<string, string> = {
  running: 'running',
  paused: 'off',
  no_model: 'no model',
  quota_exhausted: 'quota exhausted',
  error: 'error',
};

export async function handleAdvisorCommand(host: SlashCommandHost, args: string): Promise<void> {
  const parts = args.trim().split(/\s+/u).filter(Boolean);
  const verb = parts[0] ?? 'status';
  const advisorId = parts[1];
  if (parts.length > 2 || !['on', 'off', 'reload', 'status', 'toggle'].includes(verb)) {
    host.showError('Usage: /advisor [on|off|status|reload|toggle] [advisor-id]');
    return;
  }
  if (host.session === undefined) {
    host.showError('No active session.');
    return;
  }

  if (verb === 'status') {
    host.showNotice('Advisor status', formatAdvisorStatuses(await host.session.advisor.status()));
    return;
  }
  if (verb === 'reload') {
    await host.session.advisor.reload();
    host.showStatus('Advisor configuration reloaded.');
    return;
  }

  const statuses = await host.session.advisor.status();
  if (advisorId !== undefined && !statuses.some((status) => status.id === advisorId)) {
    host.showError(
      `Unknown advisor: ${advisorId}. Run /advisor status to list configured advisors.`,
    );
    return;
  }
  const enabled =
    verb === 'toggle'
      ? !(
          statuses.find((status) =>
            advisorId === undefined ? true : status.id === advisorId,
          )?.enabled ?? false
        )
      : verb === 'on';
  let updatedStatuses: readonly AdvisorStatusSnapshot[];
  try {
    updatedStatuses = await host.session.advisor.setEnabled(enabled, advisorId);
  } catch (error) {
    host.showError(formatErrorMessage(error));
    return;
  }
  const target = advisorId === undefined ? 'Advisor' : `Advisor ${advisorId}`;
  const applied =
    advisorId === undefined
      ? updatedStatuses.length > 0 &&
        updatedStatuses.every((status) => status.enabled === enabled)
      : updatedStatuses.find((status) => status.id === advisorId)?.enabled === enabled;
  if (!applied) {
    host.showError(`${target} remains ${enabled ? 'disabled' : 'enabled'}.`);
    return;
  }
  host.showStatus(`${target} ${enabled ? 'enabled' : 'disabled'}.`);
}

function formatAdvisorStatuses(statuses: readonly AdvisorStatusSnapshot[]): string {
  if (statuses.length === 0) return 'Advisor is disabled.';
  return statuses
    .map((advisor) => {
      const glyph = ADVISOR_STATUS_GLYPHS[advisor.status] ?? '?';
      const label = ADVISOR_STATUS_LABELS[advisor.status] ?? advisor.status;
      const model = advisor.model === undefined ? '' : `\n  Model: ${advisor.model}`;
      const details = `\n  ${advisor.notes} notes · $${advisor.costUsd.toFixed(4)} · ${advisor.failures} failures`;
      const message = advisor.message === undefined ? '' : `\n  ${advisor.message}`;
      return `${glyph} ${advisor.name} [${label}]${advisor.enabled ? '' : ' (disabled)'}${model}${details}${message}`;
    })
    .join('\n\n');
}
