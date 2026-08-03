import {
  type ChatProvider,
  type GenerationKwargs,
  PythinkerChatProvider,
  type ThinkingEffort,
} from '@pythoughts/kosong';

import { parseFloatEnv } from '#/config/resolve';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Apply Pythinker sampling params (`PYTHINKER_MODEL_TEMPERATURE`, `PYTHINKER_MODEL_TOP_P`) from
 * the environment to a chat provider. Applied at provider construction
 * (`ConfigState.provider`) so every request built from `config.provider` — the
 * main loop AND full-history compaction — carries them, matching pythinker-cli where
 * these live on the shared `create_llm` provider. Applies globally to any Pythinker
 * provider (not tied to `PYTHINKER_MODEL_NAME`).
 *
 * Non-Pythinker providers — and Pythinker providers with neither var set — are returned
 * unchanged. `max_tokens` is intentionally NOT handled here: `PYTHINKER_MODEL_MAX_TOKENS`
 * already flows through the completion-budget path (`resolveCompletionBudget`).
 */
export function applyPythinkerEnvSamplingParams(
  provider: ChatProvider,
  env: Env = process.env,
): ChatProvider {
  if (!(provider instanceof PythinkerChatProvider)) return provider;

  const kwargs: GenerationKwargs = {};
  const temperature = parseFloatEnv(env['PYTHINKER_MODEL_TEMPERATURE'], 'PYTHINKER_MODEL_TEMPERATURE');
  if (temperature !== undefined) kwargs.temperature = temperature;
  const topP = parseFloatEnv(env['PYTHINKER_MODEL_TOP_P'], 'PYTHINKER_MODEL_TOP_P');
  if (topP !== undefined) kwargs.top_p = topP;

  return Object.keys(kwargs).length > 0 ? provider.withGenerationKwargs(kwargs) : provider;
}

/**
 * Apply the Pythoughts preserved-thinking passthrough (`PYTHINKER_MODEL_THINKING_KEEP`
 * -> `thinking.keep`) to a chat provider. Applied in `ConfigState.provider` after
 * `withThinking`, and only while thinking is on — otherwise the API would
 * receive a `thinking.keep` with no accompanying `thinking.type` it honors.
 * (Compaction uses a raw provider with thinking off, so it correctly skips this.)
 *
 * Non-Pythinker providers — and an unset/blank value — are returned unchanged.
 */
export function applyPythinkerEnvThinkingKeep(
  provider: ChatProvider,
  thinkingLevel: ThinkingEffort,
  env: Env = process.env,
): ChatProvider {
  if (!(provider instanceof PythinkerChatProvider)) return provider;
  const keep = env['PYTHINKER_MODEL_THINKING_KEEP']?.trim();
  if (keep === undefined || keep.length === 0 || thinkingLevel === 'off') return provider;
  return provider.withExtraBody({ thinking: { keep } });
}
