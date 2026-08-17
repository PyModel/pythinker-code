import type { AppModel, ThinkingLevel } from '../api/types';

export type ThinkingAvailability = 'toggle' | 'always-on' | 'unsupported';

export type ModelThinkingInfo = Pick<AppModel, 'capabilities'> & {
  readonly adaptiveThinking?: boolean;
  readonly supportEfforts?: readonly string[];
};

/**
 * Effort-level rules, mirrored from `packages/node-sdk/src/thinking-levels.ts`.
 * The web app has no dependency on the SDK or agent-core, so the rules are
 * duplicated here on purpose; keep both copies in step.
 */
export const CANONICAL_EFFORT_ORDER: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** Fallback effort set for models without `supportEfforts` metadata. */
const DEFAULT_SUPPORTED_EFFORTS: readonly ThinkingLevel[] = ['low', 'medium', 'high'];

export function modelThinkingAvailability(
  model: ModelThinkingInfo | undefined,
): ThinkingAvailability {
  if (model === undefined) return 'toggle';
  const capabilities = model.capabilities ?? [];
  if (capabilities.includes('always_thinking')) return 'always-on';
  if (capabilities.includes('thinking') || model.adaptiveThinking === true) return 'toggle';
  return 'unsupported';
}

/** Effort levels the model actually supports ('off' excluded), canonical order. */
function baseEffortsForModel(model: ModelThinkingInfo | undefined): ThinkingLevel[] {
  const supportEfforts = model?.supportEfforts;
  if (supportEfforts?.length === 0) return ['high'];
  const declared = new Set<string>(supportEfforts ?? []);
  const ordered = CANONICAL_EFFORT_ORDER.filter(
    (effort) => effort !== 'off' && declared.has(effort),
  );
  return ordered.length > 0 ? [...ordered] : [...DEFAULT_SUPPORTED_EFFORTS];
}

/** Selectable levels for a model, in order. `['off']` when thinking is unsupported. */
export function effortLevelsForModel(model: ModelThinkingInfo | undefined): ThinkingLevel[] {
  const availability = modelThinkingAvailability(model);
  if (availability === 'unsupported') return ['off'];
  const base = baseEffortsForModel(model);
  return availability === 'always-on' ? base : ['off', ...base];
}

/**
 * Clamp a requested effort to what the model supports:
 * always-on + 'off' → first supported level; unsupported → 'off'; a level the
 * model lacks → nearest lower supported level (else the first selectable one).
 */
export function coerceThinkingForModel(
  model: ModelThinkingInfo | undefined,
  requested: ThinkingLevel,
): ThinkingLevel {
  const availability = modelThinkingAvailability(model);
  if (availability === 'unsupported') return 'off';
  const levels = effortLevelsForModel(model);
  if (availability === 'always-on' && requested === 'off') return levels[0]!;
  if (levels.includes(requested)) return requested;
  const requestedIdx = CANONICAL_EFFORT_ORDER.indexOf(requested);
  for (let i = requestedIdx - 1; i >= 0; i--) {
    const candidate = CANONICAL_EFFORT_ORDER[i]!;
    if (levels.includes(candidate)) return candidate;
  }
  return levels[0]!;
}
