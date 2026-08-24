import { isRecord } from './utils';
import type { ModelAlias, ModelAliasOverrides } from './provider-config';

export const MANAGED_PYTHINKER_MODEL_FIELDS: ReadonlySet<string> = new Set([
  'provider',
  'model',
  'maxContextSize',
  'capabilities',
  'displayName',
  'protocol',
  'betaApi',
  'adaptiveThinking',
  'supportEfforts',
  'defaultEffort',
]);

export const CUSTOM_REGISTRY_MODEL_FIELDS: ReadonlySet<string> = new Set([
  'provider',
  'model',
  'maxContextSize',
  'capabilities',
  'displayName',
  'supportEfforts',
  'defaultEffort',
]);

function cloneOverrides(
  overrides: ModelAliasOverrides | undefined,
): ModelAliasOverrides | undefined {
  if (overrides === undefined) return undefined;
  return structuredClone(overrides);
}

function userExtras(
  existing: Record<string, unknown>,
  remoteOwnedFields: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (key === 'overrides') continue;
    if (!remoteOwnedFields.has(key)) out[key] = value;
  }
  return out;
}

export function mergeRefreshedModelAlias(
  existing: unknown,
  remote: ModelAlias,
  remoteOwnedFields: ReadonlySet<string>,
): ModelAlias {
  const current = isRecord(existing) ? existing : {};
  const overrides = cloneOverrides(
    isRecord(current['overrides'])
      ? (current['overrides'] as ModelAliasOverrides)
      : undefined,
  );
  return {
    ...userExtras(current, remoteOwnedFields),
    ...remote,
    ...(overrides !== undefined ? { overrides } : {}),
  };
}
