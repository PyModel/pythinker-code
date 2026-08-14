/**
 * Thinking-effort level rules, shared by every surface.
 *
 * Models declare their selectable effort levels via `ModelAlias.supportEfforts`;
 * when that metadata is missing the fallback set is low / medium / high.
 * Clamping semantics mirror the Web UI's `coerceThinkingForModel`
 * (apps/pythinker-web/src/lib/modelThinking.ts).
 *
 * This lives in the SDK rather than in a single app because the login flows
 * are rendered by more than one front end: the terminal renderer and the VS
 * Code renderer must offer the same levels for the same model.
 */

import type { ModelAlias } from '@pymodel/agent-core';

export type ThinkingAvailability = 'toggle' | 'always-on' | 'unsupported';

export const CANONICAL_EFFORT_ORDER = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** Fallback effort set for models without `supportEfforts` metadata. */
export const DEFAULT_SUPPORTED_EFFORTS: readonly string[] = ['low', 'medium', 'high'];

export function thinkingAvailability(model: ModelAlias | undefined): ThinkingAvailability {
  if (model === undefined) return 'toggle';
  const caps = model.capabilities ?? [];
  if (caps.includes('always_thinking')) return 'always-on';
  if (caps.includes('thinking') || model.adaptiveThinking === true) return 'toggle';
  return 'unsupported';
}

/** Effort levels the model actually supports ('off' excluded), canonical order. */
function baseEffortsForModel(model: ModelAlias | undefined): string[] {
  const supportEfforts = model?.supportEfforts;
  if (supportEfforts?.length === 0) return ['high'];
  const declared = new Set(
    (supportEfforts ?? []).filter((effort) =>
      (CANONICAL_EFFORT_ORDER as readonly string[]).includes(effort),
    ),
  );
  const ordered = CANONICAL_EFFORT_ORDER.filter(
    (effort) => effort !== 'off' && declared.has(effort),
  );
  return ordered.length > 0 ? [...ordered] : [...DEFAULT_SUPPORTED_EFFORTS];
}

/** Selectable levels for a model, in order. `['off']` when thinking is unsupported. */
export function effortLevelsForModel(model: ModelAlias | undefined): string[] {
  const availability = thinkingAvailability(model);
  if (availability === 'unsupported') return ['off'];
  const base = baseEffortsForModel(model);
  return availability === 'always-on' ? base : ['off', ...base];
}

/**
 * Clamp a requested effort to what the model supports:
 * always-on + 'off' → first supported level; unsupported → 'off'; a level the
 * model lacks → nearest lower supported level (else the first selectable one).
 * The legacy boolean-era value 'on' maps to 'high' before clamping.
 */
export function coerceEffortForModel(model: ModelAlias | undefined, requested: string): string {
  const availability = thinkingAvailability(model);
  if (availability === 'unsupported') return 'off';
  const levels = effortLevelsForModel(model);
  const normalized = requested === 'on' ? 'high' : requested;
  if (availability === 'always-on' && normalized === 'off') return levels[0]!;
  if (levels.includes(normalized)) return normalized;
  const requestedIdx = (CANONICAL_EFFORT_ORDER as readonly string[]).indexOf(normalized);
  for (let i = requestedIdx - 1; i >= 0; i--) {
    const candidate = CANONICAL_EFFORT_ORDER[i]!;
    if (levels.includes(candidate)) return candidate;
  }
  return levels[0]!;
}
