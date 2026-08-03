import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';
import {
  isExperimentalFlagEnabled,
  setExperimentalFeatureForRun,
  setExperimentalFeatures,
} from './experimental-flags';

/**
 * Toggles vim editing for this run. Enabling is a session-local override
 * (never persisted); disabling also clears a previously persisted
 * `experimental.vim_mode` setting in the harness config.
 */
export async function handleVimCommand(host: SlashCommandHost): Promise<void> {
  const wasFlagEnabled = isExperimentalFlagEnabled('vim_mode');
  const enabled = !host.state.editor.isVimModeEnabled();
  setExperimentalFeatureForRun('vim_mode', enabled);
  host.state.editor.setVimMode(enabled);
  host.state.ui.requestRender();

  try {
    if (!enabled && wasFlagEnabled) {
      await host.harness.setConfig({ experimental: { vim_mode: false } });
      setExperimentalFeatures(await host.harness.getExperimentalFeatures());
      host.state.editor.setVimMode(false);
    }
    host.showStatus(
      enabled
        ? 'Editor mode set to vim (NORMAL) for this run. Press i to enter INSERT mode.'
        : 'Editor mode set to normal.',
      'success',
    );
  } catch (error) {
    host.showError(`Failed to reset saved Vim mode: ${formatErrorMessage(error)}`);
  }
}
