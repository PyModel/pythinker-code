import type { PythinkerHarness } from '@pymodel/pythinker-code-sdk';

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
  // setConfig deep-merges, so a stale `mode = "off"` left in config.toml would
  // survive an effort-only patch and force thinking off on the next startup.
  // Write mode alongside effort to keep the pair consistent.
  const mode = defaultThinking ? 'on' : 'off';
  const config = await harness.getConfig({ reload: true });
  if (
    config.defaultModel === alias &&
    config.defaultThinking === defaultThinking &&
    config.thinking?.effort === effort &&
    config.thinking.mode === mode
  ) {
    return false;
  }
  await harness.setConfig({
    defaultModel: alias,
    defaultThinking,
    thinking: { effort, mode },
  });
  return true;
}
