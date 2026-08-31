import { Error2, ErrorCodes } from '#/errors';
import type { ExperimentalFlagSource } from '#/app/flag/flag';

import {
  type CanonicalSubagentModelPolicy,
  PRIMARY_SUBAGENT_MODEL_CHOICE,
  SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE,
  SECONDARY_MODEL_PRIMARY_MODEL_RESERVED_MESSAGE,
  SECONDARY_MODEL_SECTION,
  type SubagentModelPolicyMode,
  type SubagentPolicySource,
  type SubagentRoutingOperation,
  subagentPolicyModelChoices,
} from './policy';

export type SubagentProfileSource = 'requested' | 'default' | 'fork-inherit' | 'resume-existing';

export type SubagentModelSource =
  | 'caller'
  | 'policy-default'
  | 'policy-pool'
  | 'policy-force'
  | 'fork-inherit'
  | 'resume-existing';

export interface SubagentBindingProvenance {
  readonly operation: SubagentRoutingOperation;
  readonly profileSource: SubagentProfileSource;
  readonly modelSource: SubagentModelSource;
  readonly policyMode: SubagentModelPolicyMode;
  readonly policySource: SubagentPolicySource;
  readonly featureSource: ExperimentalFlagSource;
  readonly resolvedFromRoutingEnvironmentRevision: string;
  readonly routeDecisionFingerprint: string;
}

export interface SubagentCallerModelBinding {
  readonly modelAlias: string;
  readonly thinkingLevel: string;
}

export interface SubagentModelRouteInput {
  readonly policy: CanonicalSubagentModelPolicy;
  readonly own: SubagentCallerModelBinding;
  readonly requested?: string;
}

export interface SubagentModelRoute {
  readonly model: string;
  readonly thinking?: string;
  readonly source: SubagentModelSource;
}

export function resolveSubagentModelRoute(input: SubagentModelRouteInput): SubagentModelRoute {
  const { policy, own, requested } = input;
  if (policy.mode === 'force') {
    if (requested !== undefined) {
      throw new Error2(
        ErrorCodes.CONFIG_INVALID,
        `Invalid model "${requested}": [secondary_model].force is set, so every subagent binds "${policy.defaultModel}" (omit the model parameter).`,
        { details: { model: requested } },
      );
    }
    return { model: policy.defaultModel, thinking: policy.defaultEffort, source: 'policy-force' };
  }
  if (requested === PRIMARY_SUBAGENT_MODEL_CHOICE) {
    return { model: own.modelAlias, thinking: own.thinkingLevel, source: 'caller' };
  }
  if (policy.mode === 'inherit') {
    if (requested !== undefined) {
      throw new Error2(
        ErrorCodes.CONFIG_INVALID,
        `Invalid model "${requested}": no [secondary_model.models] pool is configured, so subagents inherit the caller's model (pass "primary" or omit the model parameter).`,
        { details: { model: requested } },
      );
    }
    return { model: own.modelAlias, thinking: own.thinkingLevel, source: 'caller' };
  }
  const choices = subagentPolicyModelChoices(policy) ?? {};
  if (Object.hasOwn(choices, PRIMARY_SUBAGENT_MODEL_CHOICE)) {
    throw new Error2(ErrorCodes.CONFIG_INVALID, SECONDARY_MODEL_PRIMARY_MODEL_RESERVED_MESSAGE, {
      details: {
        section: SECONDARY_MODEL_SECTION,
        field: 'models',
        model: PRIMARY_SUBAGENT_MODEL_CHOICE,
      },
    });
  }
  const choice = requested ?? policy.defaultModel;
  if (choice === undefined) {
    throw new Error2(ErrorCodes.CONFIG_INVALID, SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE, {
      details: { section: SECONDARY_MODEL_SECTION, field: 'defaultModel' },
    });
  }
  if (!Object.hasOwn(choices, choice)) {
    const available = [...Object.keys(choices), PRIMARY_SUBAGENT_MODEL_CHOICE];
    throw new Error2(
      ErrorCodes.CONFIG_INVALID,
      `Invalid model "${choice}". Available models: ${available.join(', ')}.`,
      { details: { model: choice, availableModels: available } },
    );
  }
  return {
    model: choice,
    thinking: policy.defaultEffort,
    source: policy.mode === 'pool' ? 'policy-pool' : 'policy-default',
  };
}

export function resumedBindingProvenance(
  stored: SubagentBindingProvenance,
): SubagentBindingProvenance {
  return {
    ...stored,
    operation: 'resume',
    profileSource: 'resume-existing',
    modelSource: 'resume-existing',
  };
}
