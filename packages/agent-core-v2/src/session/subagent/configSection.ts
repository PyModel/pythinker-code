import { z } from 'zod';

import { Error2, ErrorCodes, isError2 } from '#/errors';
import { isPlainObject } from '#/app/config/toml';
import type { IFlagService } from '#/app/flag/flag';
import {
  type EnvBindings,
  envBindings,
  stripEnvBoundFields,
  type IConfigService,
} from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';
import { THINKING_SECTION } from '#/app/kosongConfig/configSection';
import type { IModelCatalog, Model } from '#/kosong/model/catalog';
import {
  declaredDefaultEffortForModel,
  type ThinkingConfig,
} from '#/kosong/model/thinking';

import { SECONDARY_MODEL_FLAG_ID } from './flag';
import {
  type CanonicalSubagentModelPolicy,
  INHERIT_SUBAGENT_MODEL_POLICY,
  type LegacySecondaryModelConfig,
  LegacySecondaryModelConfigSchema,
  normalizeLegacySecondaryModel,
  normalizeLegacySecondaryModelOrInherit,
  PRIMARY_SUBAGENT_MODEL_CHOICE,
  SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE,
  SECONDARY_MODEL_FORCE_EXCLUDES_MODELS_MESSAGE,
  SECONDARY_MODEL_FORCE_REQUIRES_DEFAULT_MESSAGE,
  SECONDARY_MODEL_PRIMARY_MODEL_RESERVED_MESSAGE,
  SECONDARY_MODEL_SECTION,
  subagentPolicyModelChoices,
  validateSubagentModelPolicy,
} from './policy';

export {
  PRIMARY_SUBAGENT_MODEL_CHOICE,
  SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE,
  SECONDARY_MODEL_FORCE_EXCLUDES_MODELS_MESSAGE,
  SECONDARY_MODEL_FORCE_REQUIRES_DEFAULT_MESSAGE,
  SECONDARY_MODEL_PRIMARY_MODEL_RESERVED_MESSAGE,
  SECONDARY_MODEL_SECTION,
};

export const SUBAGENT_SECTION = 'subagent';

export const SubagentConfigSchema = z.object({
  timeoutMs: z.number().int().min(0).optional(),
});

export type SubagentConfig = z.infer<typeof SubagentConfigSchema>;

export const SecondaryModelConfigSchema = LegacySecondaryModelConfigSchema;

export type SecondaryModelConfig = LegacySecondaryModelConfig;

export const DEFAULT_SUBAGENT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const SUBAGENT_TIMEOUT_ENV = 'PYTHINKER_SUBAGENT_TIMEOUT_MS';

function parseTimeoutMsEnv(raw: string): number | undefined {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

export const subagentEnvBindings: EnvBindings<SubagentConfig> = envBindings(
  SubagentConfigSchema,
  {
    timeoutMs: { env: SUBAGENT_TIMEOUT_ENV, parse: parseTimeoutMsEnv },
  },
);

export const stripSubagentEnv = stripEnvBoundFields(subagentEnvBindings);

registerConfigSection(SUBAGENT_SECTION, SubagentConfigSchema, {
  defaultValue: { timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS },
  env: subagentEnvBindings,
  stripEnv: stripSubagentEnv,
});

registerConfigSection(SECONDARY_MODEL_SECTION, SecondaryModelConfigSchema);

export function resolveSubagentTimeoutMs(config: IConfigService): number {
  return (
    config.get<SubagentConfig | undefined>(SUBAGENT_SECTION)?.timeoutMs ??
    DEFAULT_SUBAGENT_TIMEOUT_MS
  );
}

export interface SubagentModelPool {
  readonly defaultModel?: string;
  readonly models: Record<string, string>;
}

function configuredPolicy(config: IConfigService): CanonicalSubagentModelPolicy {
  return normalizeLegacySecondaryModel(
    config.get<LegacySecondaryModelConfig | undefined>(SECONDARY_MODEL_SECTION),
  );
}

function configuredPolicyOrInherit(config: IConfigService): CanonicalSubagentModelPolicy {
  return normalizeLegacySecondaryModelOrInherit(
    config.get<LegacySecondaryModelConfig | undefined>(SECONDARY_MODEL_SECTION),
  );
}

export function resolveSubagentModelPool(config: IConfigService): SubagentModelPool | undefined {
  const policy = configuredPolicyOrInherit(config);
  const models = subagentPolicyModelChoices(policy);
  if (policy.mode === 'inherit' || models === undefined) return undefined;
  return { defaultModel: policy.defaultModel, models: { ...models } };
}

export function isSubagentModelForced(config: IConfigService): boolean {
  return configuredPolicyOrInherit(config).mode === 'force';
}

export function exposesSubagentModelChoice(config: IConfigService, flags: IFlagService): boolean {
  if (!flags.enabled(SECONDARY_MODEL_FLAG_ID)) return false;
  if (isSubagentModelForced(config)) return false;
  return resolveSubagentModelPool(config) !== undefined;
}

function catalogValidationContext(modelCatalog: IModelCatalog) {
  return {
    resolveModel(alias: string) {
      const model = modelCatalog.get(alias);
      return { id: model.id, defaultEffort: model.defaultEffort, supportEfforts: model.supportEfforts };
    },
  };
}

export function assertValidSubagentModelPool(
  pool: SubagentModelPool,
  modelCatalog: IModelCatalog,
): void {
  if (Object.hasOwn(pool.models, PRIMARY_SUBAGENT_MODEL_CHOICE)) {
    throw new Error2(ErrorCodes.CONFIG_INVALID, SECONDARY_MODEL_PRIMARY_MODEL_RESERVED_MESSAGE, {
      details: {
        section: SECONDARY_MODEL_SECTION,
        field: 'models',
        model: PRIMARY_SUBAGENT_MODEL_CHOICE,
      },
    });
  }
  if (pool.defaultModel === undefined) {
    throw new Error2(ErrorCodes.CONFIG_INVALID, SECONDARY_MODEL_DEFAULT_MODEL_REQUIRED_MESSAGE, {
      details: { section: SECONDARY_MODEL_SECTION, field: 'defaultModel' },
    });
  }
  validateSubagentModelPolicy(
    { mode: 'pool', defaultModel: pool.defaultModel, models: { ...pool.models } },
    catalogValidationContext(modelCatalog),
  );
}

export function assertValidSubagentModelConfig(
  config: IConfigService,
  flags: IFlagService,
  modelCatalog: IModelCatalog,
): void {
  if (!flags.enabled(SECONDARY_MODEL_FLAG_ID)) return;
  validateSubagentModelPolicy(configuredPolicy(config), catalogValidationContext(modelCatalog));
}

export function cascadeSubagentModelPool(
  section: SecondaryModelConfig | undefined,
  _survivingModels: Record<string, unknown>,
  renamedAliases: ReadonlyMap<string, string> = new Map(),
): SecondaryModelConfig | undefined {
  if (section === undefined) return undefined;
  const remap = (alias: string): string => renamedAliases.get(alias) ?? alias;
  const nextDefault = section.defaultModel === undefined ? undefined : remap(section.defaultModel);
  const nextLegacyDefault = section.model === undefined ? undefined : remap(section.model);

  let changed = nextDefault !== section.defaultModel || nextLegacyDefault !== section.model;
  let nextPool: Record<string, string> | undefined;
  if (section.models !== undefined) {
    nextPool = {};
    for (const [alias, description] of Object.entries(section.models)) {
      const key = remap(alias);
      if (key !== alias) changed = true;
      nextPool[key] = description;
    }
  }
  if (!changed) return undefined;
  return { ...section, defaultModel: nextDefault, model: nextLegacyDefault, models: nextPool };
}

export function resolveSubagentBinding(
  config: IConfigService,
  flags: IFlagService,
  own: { modelAlias: string; thinkingLevel: string },
  requested?: string,
): { model: string; thinking?: string } {
  const enabled = flags.enabled(SECONDARY_MODEL_FLAG_ID);
  const policy = enabled ? configuredPolicy(config) : INHERIT_SUBAGENT_MODEL_POLICY;
  if (policy.mode === 'force') {
    if (requested !== undefined) {
      throw new Error2(
        ErrorCodes.CONFIG_INVALID,
        `Invalid model "${requested}": [secondary_model].force is set, so every subagent binds "${policy.defaultModel}" (omit the model parameter).`,
        { details: { model: requested } },
      );
    }
    return { model: policy.defaultModel, thinking: policy.defaultEffort };
  }
  if (requested === PRIMARY_SUBAGENT_MODEL_CHOICE) {
    return { model: own.modelAlias, thinking: own.thinkingLevel };
  }
  if (policy.mode === 'inherit') {
    if (requested !== undefined) {
      throw new Error2(
        ErrorCodes.CONFIG_INVALID,
        `Invalid model "${requested}": no [secondary_model.models] pool is configured, so subagents inherit the caller's model (pass "primary" or omit the model parameter).`,
        { details: { model: requested } },
      );
    }
    return { model: own.modelAlias, thinking: own.thinkingLevel };
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
  if (!Object.hasOwn(choices, choice)) {
    const available = [...Object.keys(choices), PRIMARY_SUBAGENT_MODEL_CHOICE];
    throw new Error2(
      ErrorCodes.CONFIG_INVALID,
      `Invalid model "${choice}". Available models: ${available.join(', ')}.`,
      { details: { model: choice, availableModels: available } },
    );
  }
  return { model: choice, thinking: policy.defaultEffort };
}

export function resolveSubagentThinking(
  config: IConfigService,
  model: Model | undefined,
  explicit: string | undefined,
): string | undefined {
  if (explicit !== undefined) return explicit;
  if (config.get<ThinkingConfig>(THINKING_SECTION)?.enabled === false) return undefined;
  return declaredDefaultEffortForModel(model);
}

export function buildSubagentModelDescriptions(
  config: IConfigService,
  flags: IFlagService,
  callerModelAlias: string | undefined,
): string | undefined {
  if (!exposesSubagentModelChoice(config, flags)) return undefined;
  const pool = resolveSubagentModelPool(config)!;
  const lines = ['Available models (pass via model):'];
  const defaultModel = pool.defaultModel;
  const markersFor = (alias: string): string => {
    const markers: string[] = [];
    if (alias === defaultModel) markers.push('[default]');
    if (alias === callerModelAlias) markers.push('[main model]');
    return markers.length === 0 ? '' : ` ${markers.join(' ')}`;
  };
  if (defaultModel !== undefined && Object.hasOwn(pool.models, defaultModel)) {
    lines.push(
      formatPoolLine(`${defaultModel}${markersFor(defaultModel)}`, pool.models[defaultModel]!),
    );
  }
  for (const [alias, description] of Object.entries(pool.models)) {
    if (alias === defaultModel) continue;
    lines.push(formatPoolLine(`${alias}${markersFor(alias)}`, description));
  }
  const callerInPool =
    callerModelAlias !== undefined && Object.hasOwn(pool.models, callerModelAlias);
  lines.push(
    `- ${PRIMARY_SUBAGENT_MODEL_CHOICE}${callerInPool ? ` (${callerModelAlias})` : ''}: the main model you are running on, bound with your current thinking level; use it for hard, quality-sensitive subagent tasks`,
  );
  return lines.join('\n');
}

function formatPoolLine(label: string, description: string): string {
  return description === '' ? `- ${label}` : `- ${label}: ${description}`;
}

export function stripSubagentModelParameter(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const properties = parameters['properties'];
  if (!isPlainObject(properties) || !('model' in properties)) return parameters;
  const nextProperties = { ...properties };
  delete nextProperties['model'];
  const next: Record<string, unknown> = { ...parameters, properties: nextProperties };
  const required = parameters['required'];
  if (Array.isArray(required) && required.includes('model')) {
    next['required'] = required.filter((entry) => entry !== 'model');
  }
  return next;
}

export function stripSubagentForkParameter(
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const properties = parameters['properties'];
  if (!isPlainObject(properties) || !('fork' in properties)) return parameters;
  const nextProperties = { ...properties };
  delete nextProperties['fork'];
  const next: Record<string, unknown> = { ...parameters, properties: nextProperties };
  const required = parameters['required'];
  if (Array.isArray(required) && required.includes('fork')) {
    next['required'] = required.filter((entry) => entry !== 'fork');
  }
  return next;
}

export function wrapSubagentModelError(
  error: unknown,
  boundModel: string,
  callerModelAlias: string | undefined,
): unknown {
  if (boundModel === callerModelAlias) return error;
  if (!isError2(error) || error.code !== ErrorCodes.CONFIG_INVALID) return error;
  if (error.details?.['model'] !== boundModel) return error;
  return new Error2(
    error.code,
    `${error.message} (subagent model "${boundModel}" comes from [secondary_model.models] — check that it names a valid [models] entry)`,
    {
      cause: error,
      name: error.name,
      details: {
        ...error.details,
        subagentModel: boundModel,
        subagentModelConfig: {
          section: 'secondary_model.models',
        },
      },
    },
  );
}

export function formatSubagentTimeoutDescription(ms: number): string {
  if (ms % (60 * 60 * 1000) === 0) {
    const h = ms / (60 * 60 * 1000);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  if (ms % (60 * 1000) === 0) {
    const m = ms / (60 * 1000);
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  if (ms % 1000 === 0) {
    const s = ms / 1000;
    return `${s} second${s === 1 ? '' : 's'}`;
  }
  return `${ms} ms`;
}
