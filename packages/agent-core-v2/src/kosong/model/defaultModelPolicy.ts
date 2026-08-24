import type { ModelRecord, ModelsSection } from './model';

const TOOL_USE_CAPABILITY = 'tool_use';

/**
 * True when a model can plausibly drive an agent turn.
 *
 * A model is rejected only on positive evidence that it cannot: it declares
 * capabilities and `tool_use` is absent (embedding, rerank and vision-only
 * entries), or it declares a non-positive context window. A record that
 * declares no capabilities at all — common for hand-configured
 * OpenAI-compatible endpoints — stays eligible, so an unknown provider can
 * never leave the caller with no candidate at all.
 */
export function isEligibleDefaultModel(record: ModelRecord): boolean {
  const context = effectiveContextSize(record);
  if (context !== undefined && context <= 0) return false;
  const capabilities = effectiveCapabilities(record);
  if (capabilities === undefined || capabilities.length === 0) return true;
  return capabilities.some((entry) => entry.trim().toLowerCase() === TOOL_USE_CAPABILITY);
}

/**
 * Rank eligible model ids best-first.
 *
 * Declared tool use wins over an undeclared capability set, then the larger
 * usable context window, then a stable id sort so the outcome never depends on
 * object key order or catalog iteration.
 */
export function rankDefaultModelCandidates(models: ModelsSection): string[] {
  return Object.entries(models)
    .filter(([, record]) => isEligibleDefaultModel(record))
    .map(([id, record]) => ({
      id,
      declaresToolUse: declaresToolUse(record),
      context: effectiveContextSize(record) ?? 0,
    }))
    .toSorted((a, b) => {
      if (a.declaresToolUse !== b.declaresToolUse) return a.declaresToolUse ? -1 : 1;
      if (a.context !== b.context) return b.context - a.context;
      return a.id.localeCompare(b.id);
    })
    .map((candidate) => candidate.id);
}

/**
 * The default model the given catalog should settle on.
 *
 * Any existing default is returned untouched — including one this policy would
 * not have picked itself, and one naming a model the registry has not loaded
 * yet, so neither a deliberate choice nor an env-pinned pointer is ever
 * clobbered. A fallback is chosen only when nothing is set at all. Returns
 * `undefined` when no model is eligible, leaving readiness honestly false
 * rather than pointing at a model that cannot serve a turn.
 */
export function resolveDefaultModel(
  models: ModelsSection,
  current: string | undefined,
): string | undefined {
  if (current !== undefined) return current;
  return rankDefaultModelCandidates(models)[0];
}

function effectiveCapabilities(record: ModelRecord): readonly string[] | undefined {
  return record.overrides?.capabilities ?? record.capabilities;
}

function effectiveContextSize(record: ModelRecord): number | undefined {
  return record.overrides?.maxContextSize ?? record.maxContextSize;
}

function declaresToolUse(record: ModelRecord): boolean {
  const capabilities = effectiveCapabilities(record);
  if (capabilities === undefined) return false;
  return capabilities.some((entry) => entry.trim().toLowerCase() === TOOL_USE_CAPABILITY);
}
