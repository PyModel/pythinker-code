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

export const DEFAULT_SUPPORTED_EFFORTS: readonly string[] = ['low', 'medium', 'high'];

export function thinkingAvailability(model: ModelAlias | undefined): ThinkingAvailability {
  if (model === undefined) return 'toggle';
  const capabilities = model.capabilities ?? [];
  if (capabilities.includes('always_thinking')) return 'always-on';
  if (capabilities.includes('thinking') || model.adaptiveThinking === true) return 'toggle';
  return 'unsupported';
}

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

export function effortLevelsForModel(model: ModelAlias | undefined): string[] {
  const availability = thinkingAvailability(model);
  if (availability === 'unsupported') return ['off'];
  const base = baseEffortsForModel(model);
  return availability === 'always-on' ? base : ['off', ...base];
}

export function coerceEffortForModel(model: ModelAlias | undefined, requested: string): string {
  const availability = thinkingAvailability(model);
  if (availability === 'unsupported') return 'off';
  const levels = effortLevelsForModel(model);
  const normalized = requested === 'on' ? 'high' : requested;
  if (availability === 'always-on' && normalized === 'off') return levels[0]!;
  if (levels.includes(normalized)) return normalized;
  const requestedIndex = (CANONICAL_EFFORT_ORDER as readonly string[]).indexOf(normalized);
  for (let index = requestedIndex - 1; index >= 0; index--) {
    const candidate = CANONICAL_EFFORT_ORDER[index]!;
    if (levels.includes(candidate)) return candidate;
  }
  return levels[0]!;
}
