import type { ModelAlias } from '@pythoughts/agent-core';
import {
  capabilitiesForModel,
  type ManagedKimiCodeModelInfo,
} from '@pythoughts/pythinker-code-oauth';

/**
 * Builds a pythinker-code model alias from an open-platform model entry, the
 * managed-provider counterpart of `catalogModelToAlias`.
 *
 * Renderers need this to ask `effortLevelsForModel` what a managed model
 * supports without depending on the oauth package themselves.
 */
export function managedModelToAlias(
  platformId: string,
  model: ManagedKimiCodeModelInfo,
): ModelAlias {
  return {
    provider: platformId,
    model: model.id,
    maxContextSize: model.contextLength,
    capabilities: capabilitiesForModel(model),
    // Carry the declared efforts through, so the login picker offers what the
    // model actually supports rather than the low/medium/high fallback. The
    // config written after the picker records this same list.
    supportEfforts:
      model.supportedReasoningEfforts === undefined
        ? undefined
        : [...model.supportedReasoningEfforts],
    displayName: model.displayName,
  };
}
