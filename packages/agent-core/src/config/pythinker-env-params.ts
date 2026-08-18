import {
  type ChatProvider,
  type GenerationKwargs,
  PythinkerChatProvider,
  type ThinkingEffort,
} from '@pymodel/kosong';
import { AnthropicChatProvider } from '@pymodel/kosong/providers/anthropic';

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
 * Resolve the operational `PYTHINKER_MODEL_THINKING_EFFORT` override after the
 * model-aware effort has been resolved. The override intentionally bypasses
 * `support_efforts`, but cannot turn Thinking on after the user disabled it.
 *
 * Provider identity is supplied separately from the wire adapter so a Pythinker
 * provider routed through the Anthropic protocol still receives Pythinker semantics.
 */
export function resolvePythinkerEnvThinkingEffort(
  thinkingEffort: ThinkingEffort,
  pythinkerProvider: boolean,
  env: Env = process.env,
): ThinkingEffort | undefined {
  if (!pythinkerProvider || thinkingEffort === 'off') return undefined;
  const effort = env['PYTHINKER_MODEL_THINKING_EFFORT']?.trim().toLowerCase();
  return effort === undefined || effort.length === 0 ? undefined : effort;
}

const KEEP_OFF_VALUES = new Set(['0', 'false', 'no', 'off', 'none', 'null']);

type KeepResolution =
  | { readonly specified: false }
  | { readonly specified: true; readonly value: string | undefined };

/**
 * Parse a single keep source (env var or config field). A blank value is
 * "unspecified" and falls through to the next source; an off-value explicitly
 * disables Preserved Thinking (short-circuits, no fallback); anything else is
 * forwarded verbatim (e.g. "all").
 */
function parseKeepValue(raw: string | undefined): KeepResolution {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return { specified: false };
  if (KEEP_OFF_VALUES.has(trimmed.toLowerCase())) return { specified: true, value: undefined };
  return { specified: true, value: trimmed };
}

/**
 * Resolve the Preserved Thinking passthrough (Pythinker `thinking.keep` / Anthropic
 * `context_management` `clear_thinking_20251015`) with precedence env
 * (`PYTHINKER_MODEL_THINKING_KEEP`) > config (`thinking.keep`) > default `"all"`.
 * Only meaningful while thinking is on — otherwise the API would receive a keep
 * directive with no accompanying `thinking.type` it honors, so it resolves to
 * `undefined`. Applied via `ConfigState.provider`, which is shared by the main
 * loop AND full-history compaction, so compaction intentionally carries the
 * same keep (and, for Anthropic, the beta endpoint) when thinking is on;
 * `keep:"all"` prunes nothing and a consistent request shape maximizes KV-cache
 * reuse.
 *
 * Returns `undefined` when Preserved Thinking should be disabled.
 */
export function resolveThinkingKeep(
  env: Env,
  configKeep: string | undefined,
  thinkingEffort: ThinkingEffort,
): string | undefined {
  if (thinkingEffort === 'off') return undefined;
  const fromEnv = parseKeepValue(env['PYTHINKER_MODEL_THINKING_KEEP']);
  if (fromEnv.specified) return fromEnv.value;
  const fromConfig = parseKeepValue(configKeep);
  if (fromConfig.specified) return fromConfig.value;
  return 'all';
}

/**
 * Apply the PyModel Preserved Thinking passthrough to a chat provider. See
 * `resolveThinkingKeep` for precedence. Non-Pythinker providers are returned
 * unchanged.
 */
export function applyPythinkerEnvThinkingKeep(
  provider: ChatProvider,
  thinkingEffort: ThinkingEffort,
  env: Env = process.env,
  configKeep?: string,
): ChatProvider {
  if (!(provider instanceof PythinkerChatProvider)) return provider;
  const keep = resolveThinkingKeep(env, configKeep, thinkingEffort);
  if (keep === undefined) return provider;
  return provider.withExtraBody({ thinking: { keep } });
}

/**
 * Apply the Anthropic equivalent of Preserved Thinking — a `context_management`
 * `clear_thinking_20251015` edit carrying `keep` — to an Anthropic chat
 * provider. See `resolveThinkingKeep` for precedence. Non-Anthropic providers
 * are returned unchanged. Applies to every Anthropic provider (Claude and
 * Pythinker's Anthropic-compatible mode) while thinking is on; `keep: "all"` tells
 * the server to retain all prior thinking blocks (prune none), mirroring Pythinker's
 * `thinking.keep`.
 */
export function applyAnthropicThinkingKeep(
  provider: ChatProvider,
  thinkingEffort: ThinkingEffort,
  env: Env = process.env,
  configKeep?: string,
): ChatProvider {
  if (!(provider instanceof AnthropicChatProvider)) return provider;
  const keep = resolveThinkingKeep(env, configKeep, thinkingEffort);
  if (keep === undefined) return provider;
  return provider.withThinkingKeep(keep);
}
