import { createHash } from 'node:crypto';

import { z } from 'zod';

import { Error2, ErrorCodes } from '#/errors';
import type { ExperimentalFlagSource } from '#/app/flag/flag';
import { isPlainObject } from '#/app/config/configPure';

export const SECONDARY_MODEL_SECTION = 'secondaryModel';

export const PRIMARY_SUBAGENT_MODEL_CHOICE = 'primary';

export const LegacySecondaryModelConfigSchema = z.object({
  defaultModel: z.string().min(1).optional(),
  models: z.record(z.string(), z.string()).optional(),
  force: z.boolean().optional(),
  model: z.string().min(1).optional(),
  maxContextSize: z.number().int().min(1).optional(),
  maxInputSize: z.number().int().min(1).optional(),
  maxOutputSize: z.number().int().min(1).optional(),
  capabilities: z.array(z.string()).optional(),
  displayName: z.string().optional(),
  reasoningKey: z.string().optional(),
  adaptiveThinking: z.boolean().optional(),
  supportEfforts: z.array(z.string()).optional(),
  defaultEffort: z.string().optional(),
  offEffort: z.string().optional(),
});

export type LegacySecondaryModelConfig = z.infer<typeof LegacySecondaryModelConfigSchema>;

const modelAliasSchema = z.string().min(1);
const effortSchema = z.string().min(1).optional();

export const CanonicalSubagentModelPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z
    .object({ mode: z.literal('default'), defaultModel: modelAliasSchema, defaultEffort: effortSchema })
    .strict(),
  z
    .object({
      mode: z.literal('pool'),
      defaultModel: modelAliasSchema,
      models: z.record(z.string(), z.string()),
      defaultEffort: effortSchema,
    })
    .strict(),
  z
    .object({ mode: z.literal('force'), defaultModel: modelAliasSchema, defaultEffort: effortSchema })
    .strict(),
]);

export type CanonicalSubagentModelPolicy = z.infer<typeof CanonicalSubagentModelPolicySchema>;

export type SubagentModelPolicyMode = CanonicalSubagentModelPolicy['mode'];

export type SubagentPolicySource = 'config' | 'default';

export const INHERIT_SUBAGENT_MODEL_POLICY: CanonicalSubagentModelPolicy = Object.freeze({
  mode: 'inherit',
}) as CanonicalSubagentModelPolicy;

export const SECONDARY_MODEL_FORCE_REQUIRES_DEFAULT_MESSAGE =
  '[secondary_model].default_model is required when [secondary_model].force is set';

export const SECONDARY_MODEL_FORCE_EXCLUDES_MODELS_MESSAGE =
  '[secondary_model].force cannot be combined with [secondary_model.models]: the pool table only exists to offer the main agent a choice, and force removes that choice';

export const SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE =
  '[secondary_model].default_model is required when [secondary_model.models] is configured';

export const SECONDARY_MODEL_PRIMARY_MODEL_RESERVED_MESSAGE = `[secondary_model.models] key "${PRIMARY_SUBAGENT_MODEL_CHOICE}" is reserved: it always binds the caller's own model. Rename the pool entry.`;

function invalid(message: string, details: Record<string, unknown>): Error2 {
  return new Error2(ErrorCodes.CONFIG_INVALID, message, {
    details: { section: SECONDARY_MODEL_SECTION, ...details },
  });
}

function effortOf(defaultEffort: string | undefined): string | undefined {
  return defaultEffort === undefined || defaultEffort.length === 0 ? undefined : defaultEffort;
}

export function normalizeLegacySecondaryModel(
  legacy: LegacySecondaryModelConfig | undefined,
): CanonicalSubagentModelPolicy {
  if (legacy === undefined) return INHERIT_SUBAGENT_MODEL_POLICY;
  const single = legacy.defaultModel ?? legacy.model;
  if (legacy.force === true) {
    if (legacy.models !== undefined) {
      throw invalid(SECONDARY_MODEL_FORCE_EXCLUDES_MODELS_MESSAGE, { field: 'force' });
    }
    if (single === undefined) {
      throw invalid(SECONDARY_MODEL_FORCE_REQUIRES_DEFAULT_MESSAGE, { field: 'defaultModel' });
    }
    return { mode: 'force', defaultModel: single, defaultEffort: effortOf(legacy.defaultEffort) };
  }
  if (legacy.models !== undefined) {
    if (legacy.defaultModel === undefined) {
      throw invalid(SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE, { field: 'defaultModel' });
    }
    return {
      mode: 'pool',
      defaultModel: legacy.defaultModel,
      models: { ...legacy.models },
      defaultEffort: effortOf(legacy.defaultEffort),
    };
  }
  if (single !== undefined) {
    return { mode: 'default', defaultModel: single, defaultEffort: effortOf(legacy.defaultEffort) };
  }
  return INHERIT_SUBAGENT_MODEL_POLICY;
}

export function normalizeLegacySecondaryModelOrInherit(
  legacy: LegacySecondaryModelConfig | undefined,
): CanonicalSubagentModelPolicy {
  try {
    return normalizeLegacySecondaryModel(legacy);
  } catch {
    return INHERIT_SUBAGENT_MODEL_POLICY;
  }
}

export function toPersistedSecondaryModel(
  policy: CanonicalSubagentModelPolicy,
): LegacySecondaryModelConfig | undefined {
  switch (policy.mode) {
    case 'inherit':
      return undefined;
    case 'default':
      return { defaultModel: policy.defaultModel, defaultEffort: policy.defaultEffort };
    case 'pool':
      return {
        defaultModel: policy.defaultModel,
        models: { ...policy.models },
        defaultEffort: policy.defaultEffort,
      };
    case 'force':
      return { defaultModel: policy.defaultModel, force: true, defaultEffort: policy.defaultEffort };
  }
}

export function parseCanonicalSubagentModelPolicy(input: unknown): CanonicalSubagentModelPolicy {
  const parsed = CanonicalSubagentModelPolicySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue === undefined || issue.path.length === 0 ? '' : `${issue.path.join('.')}: `;
    throw invalid(
      `Invalid subagent model policy: ${path}${issue?.message ?? 'malformed policy'}`,
      { field: issue?.path.join('.') },
    );
  }
  return parsed.data;
}

export interface SubagentPolicyModelInfo {
  readonly id: string;
  readonly defaultEffort?: string;
  readonly supportEfforts?: readonly string[];
}

export interface SubagentPolicyValidationContext {
  resolveModel(alias: string): SubagentPolicyModelInfo | undefined;
}

export function subagentPolicyModelChoices(
  policy: CanonicalSubagentModelPolicy,
): Readonly<Record<string, string>> | undefined {
  switch (policy.mode) {
    case 'inherit':
      return undefined;
    case 'pool':
      return policy.models;
    case 'default':
    case 'force':
      return { [policy.defaultModel]: '' };
  }
}

function assertModelResolves(
  alias: string,
  field: string,
  context: SubagentPolicyValidationContext,
): SubagentPolicyModelInfo {
  let info: SubagentPolicyModelInfo | undefined;
  try {
    info = context.resolveModel(alias);
  } catch (error) {
    throw new Error2(
      ErrorCodes.CONFIG_INVALID,
      `[secondary_model.models] entry "${alias}" could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error, details: { section: SECONDARY_MODEL_SECTION, field, model: alias } },
    );
  }
  if (info === undefined) {
    throw invalid(
      `[secondary_model.models] entry "${alias}" could not be resolved: Model "${alias}" is not configured in config.toml.`,
      { field, model: alias },
    );
  }
  return info;
}

export function validateSubagentModelPolicy(
  policy: CanonicalSubagentModelPolicy,
  context: SubagentPolicyValidationContext,
): void {
  if (policy.mode === 'inherit') return;
  if (policy.mode === 'pool') {
    if (Object.hasOwn(policy.models, PRIMARY_SUBAGENT_MODEL_CHOICE)) {
      throw invalid(SECONDARY_MODEL_PRIMARY_MODEL_RESERVED_MESSAGE, {
        field: 'models',
        model: PRIMARY_SUBAGENT_MODEL_CHOICE,
      });
    }
    const aliases = Object.keys(policy.models);
    if (!Object.hasOwn(policy.models, policy.defaultModel)) {
      throw new Error2(
        ErrorCodes.CONFIG_INVALID,
        `[secondary_model].default_model "${policy.defaultModel}" is not a [secondary_model.models] key. Available models: ${aliases.join(', ')}.`,
        { details: { model: policy.defaultModel, availableModels: aliases } },
      );
    }
    for (const alias of aliases) assertModelResolves(alias, 'models', context);
  }
  const bound = assertModelResolves(policy.defaultModel, 'defaultModel', context);
  if (
    policy.defaultEffort !== undefined &&
    bound.supportEfforts !== undefined &&
    bound.supportEfforts.length > 0 &&
    !bound.supportEfforts.includes(policy.defaultEffort)
  ) {
    throw invalid(
      `[secondary_model].default_effort "${policy.defaultEffort}" is not supported by "${policy.defaultModel}". Supported efforts: ${bound.supportEfforts.join(', ')}.`,
      { field: 'defaultEffort', model: policy.defaultModel, effort: policy.defaultEffort },
    );
  }
}

export function prospectiveModelView(providers: unknown, models: unknown): SubagentPolicyValidationContext {
  const providerTable = isPlainObject(providers) ? providers : {};
  const modelTable = isPlainObject(models) ? models : {};
  const resolveEntry = (alias: string): Record<string, unknown> | undefined => {
    const direct = modelTable[alias];
    if (isPlainObject(direct)) return direct;
    for (const entry of Object.values(modelTable)) {
      if (!isPlainObject(entry)) continue;
      const aliases = entry['aliases'];
      if (Array.isArray(aliases) && aliases.includes(alias)) return entry;
    }
    return undefined;
  };
  return {
    resolveModel(alias) {
      const entry = resolveEntry(alias);
      if (entry === undefined) return undefined;
      const provider = entry['provider'];
      if (typeof provider === 'string' && !isPlainObject(providerTable[provider])) return undefined;
      const supportEfforts = entry['supportEfforts'];
      const defaultEffort = entry['defaultEffort'];
      return {
        id: alias,
        defaultEffort: typeof defaultEffort === 'string' ? defaultEffort : undefined,
        supportEfforts: Array.isArray(supportEfforts)
          ? supportEfforts.filter((effort): effort is string => typeof effort === 'string')
          : undefined,
      };
    },
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isPlainObject(value)) return value === undefined ? null : value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    const entry = value[key];
    if (entry === undefined) continue;
    out[key] = sortKeys(entry);
  }
  return out;
}

function digest(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 32);
}

export const SUBAGENT_POLICY_RESOURCE_VERSION_PREFIX = 'subagent-policy-v1:';

export function subagentPolicyResourceVersion(
  persisted: LegacySecondaryModelConfig | undefined,
): string {
  let canonical: unknown;
  try {
    const policy = normalizeLegacySecondaryModel(persisted);
    canonical = policy.mode === 'inherit' ? null : policy;
  } catch {
    canonical = { invalid: persisted ?? null };
  }
  return `${SUBAGENT_POLICY_RESOURCE_VERSION_PREFIX}${digest(canonicalJson(canonical))}`;
}

export interface SubagentFeatureState {
  readonly enabled: boolean;
  readonly source: ExperimentalFlagSource;
}

export interface RoutingEnvironmentInput {
  readonly effectivePolicy: CanonicalSubagentModelPolicy;
  readonly policySource: SubagentPolicySource;
  readonly feature: SubagentFeatureState;
  readonly callerModel: string;
  readonly callerThinking?: string;
  readonly thinkingEnabled: boolean;
  readonly boundModelDefaultEffort?: string;
}

export const ROUTING_ENVIRONMENT_REVISION_PREFIX = 'route-env:v1:';

export function routingEnvironmentRevision(input: RoutingEnvironmentInput): string {
  return `${ROUTING_ENVIRONMENT_REVISION_PREFIX}${digest(canonicalJson(input))}`;
}

export type SubagentRoutingOperation = 'spawn' | 'fork' | 'resume';

export interface RouteDecisionInput {
  readonly routingEnvironmentRevision: string;
  readonly operation: SubagentRoutingOperation;
  readonly profile?: string;
  readonly model?: string;
  readonly thinking?: string;
}

export const ROUTE_DECISION_FINGERPRINT_PREFIX = 'route-decision:v1:';

export function routeDecisionFingerprint(input: RouteDecisionInput): string {
  return `${ROUTE_DECISION_FINGERPRINT_PREFIX}${digest(canonicalJson(input))}`;
}
