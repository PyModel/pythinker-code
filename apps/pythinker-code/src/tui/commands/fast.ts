import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/pythinker-tui';
import type { SlashCommandHost } from './dispatch';

const FAST_MODE_UNAVAILABLE = 'Fast mode is unavailable for the current model and provider.';

/**
 * Handles `/fast [on|off|status]`: toggles provider-native Fast processing
 * for the active session. Bare `/fast` flips the current state; enabling is
 * refused when the active model/provider does not support Fast mode.
 */
export async function handleFastCommand(host: SlashCommandHost, rawArgs: string): Promise<void> {
  const command = rawArgs.trim().toLowerCase();
  if (command !== '' && command !== 'on' && command !== 'off' && command !== 'status') {
    host.showError('Usage: /fast [on|off|status]');
    return;
  }
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  const status = await host.session.getStatus();
  const enabled = status.fastMode === true;
  const supported = status.fastModeSupported === true;
  host.setAppState({ fastMode: enabled, fastModeSupported: supported });

  if (command === 'status') {
    if (!supported) {
      host.showStatus(FAST_MODE_UNAVAILABLE, 'warning');
      return;
    }
    host.showStatus(enabled ? '↯ Fast mode is on.' : 'Fast mode is off.');
    return;
  }

  const nextEnabled = command === '' ? !enabled : command === 'on';
  if (nextEnabled && !supported) {
    host.showError(FAST_MODE_UNAVAILABLE);
    return;
  }
  if (nextEnabled === enabled) {
    host.showStatus(`Fast mode is already ${enabled ? 'on' : 'off'}.`);
    return;
  }

  await host.session.setFastMode(nextEnabled);
  host.setAppState({ fastMode: nextEnabled, fastModeSupported: supported });
  if (nextEnabled) {
    host.showNotice(
      '↯ Fast mode on',
      'Uses provider-native Fast processing and may consume credits or tokens at premium rates.',
    );
    return;
  }
  host.showStatus('Fast mode off.');
}
