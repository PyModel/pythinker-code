import type { ModelRecord, ModelsSection } from './model';

const TOOL_USE_CAPABILITY = 'tool_use';

export function isEligibleDefaultModel(record: ModelRecord): boolean {
  const context = effectiveContextSize(record);
  if (context !== undefined && context <= 0) return false;
  const capabilities = effectiveCapabilities(record);
  if (capabilities === undefined || capabilities.length === 0) return true;
  return capabilities.some((entry) => entry.trim().toLowerCase() === TOOL_USE_CAPABILITY);
}

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
