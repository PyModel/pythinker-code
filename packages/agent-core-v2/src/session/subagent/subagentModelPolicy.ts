import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

import type {
  CanonicalSubagentModelPolicy,
  LegacySecondaryModelConfig,
  SubagentFeatureState,
  SubagentPolicySource,
  SubagentPolicyValidationContext,
} from './policy';

export interface SubagentModelPolicySnapshot {
  readonly policy: CanonicalSubagentModelPolicy;
  readonly resourceVersion: string;
}

export interface EffectiveSubagentModelPolicy {
  readonly configuredPolicy: CanonicalSubagentModelPolicy;
  readonly effectivePolicy: CanonicalSubagentModelPolicy;
  readonly policySource: SubagentPolicySource;
  readonly feature: SubagentFeatureState;
}

export interface PreparedSubagentPolicyMutation {
  readonly policy: CanonicalSubagentModelPolicy;
  readonly section: LegacySecondaryModelConfig | undefined;
}

export interface SubagentCallerBinding {
  readonly modelAlias: string;
  readonly thinkingLevel?: string;
}

export interface ISubagentModelPolicyService {
  readonly _serviceBrand: undefined;

  get(): SubagentModelPolicySnapshot;
  getEffective(): EffectiveSubagentModelPolicy;
  set(policy: unknown, expectedVersion?: string): Promise<SubagentModelPolicySnapshot>;
  clear(expectedVersion?: string): Promise<SubagentModelPolicySnapshot>;
  prepareLegacyMutation(
    input: unknown,
    context?: SubagentPolicyValidationContext,
  ): PreparedSubagentPolicyMutation;
  resolveRevision(caller: SubagentCallerBinding): string;
}

export const ISubagentModelPolicyService: ServiceIdentifier<ISubagentModelPolicyService> =
  createDecorator<ISubagentModelPolicyService>('subagentModelPolicyService');
