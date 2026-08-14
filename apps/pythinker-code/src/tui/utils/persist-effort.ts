import type { PythinkerHarness } from '@pythoughts/pythinker-code-sdk';

/**
 * Save the model + thinking-effort pair as the startup default.
 * Returns false when the config already holds the same selection.
 */
export async function persistDefaultModelSelection(
  harness: PythinkerHarness,
  alias: string,
  effort: string,
): Promise<boolean> {
  const defaultThinking = effort !== 'off';
  const config = await harness.getConfig({ reload: true });
  if (
    config.defaultModel === alias &&
    config.defaultThinking === defaultThinking &&
    config.thinking?.effort === effort
  ) {
    return false;
  }
  await harness.setConfig({
    defaultModel: alias,
    defaultThinking,
    thinking: { effort },
  });
  return true;
}
