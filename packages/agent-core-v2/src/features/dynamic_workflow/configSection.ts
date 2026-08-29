import { z } from 'zod';

import {
  type EnvBindings,
  envBindings,
  stripEnvBoundFields,
  type IConfigService,
} from '#/app/config/config';
import { registerConfigSection } from '#/app/config/configSectionContributions';

export const DYNAMIC_WORKFLOW_SECTION = 'dynamicWorkflow';

export const DynamicWorkflowConfigSchema = z.object({
  timeoutMs: z.number().int().min(0).optional(),
  maxConcurrency: z.number().int().positive().optional(),
});

export type DynamicWorkflowConfig = z.infer<typeof DynamicWorkflowConfigSchema>;

export const DEFAULT_DYNAMIC_WORKFLOW_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const DYNAMIC_WORKFLOW_TIMEOUT_ENV =
  'PYTHINKER_CODE_AGENT_DYNAMIC_WORKFLOW_TIMEOUT_MS';
export const DYNAMIC_WORKFLOW_MAX_CONCURRENCY_ENV =
  'PYTHINKER_CODE_AGENT_DYNAMIC_WORKFLOW_MAX_CONCURRENCY';

function parsePositiveIntegerEnv(raw: string): number | undefined {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function parseNonNegativeIntegerEnv(raw: string): number | undefined {
  const parsed = Number(raw);
  return raw.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export const dynamicWorkflowEnvBindings: EnvBindings<DynamicWorkflowConfig> = envBindings(
  DynamicWorkflowConfigSchema,
  {
    timeoutMs: { env: DYNAMIC_WORKFLOW_TIMEOUT_ENV, parse: parseNonNegativeIntegerEnv },
    maxConcurrency: {
      env: DYNAMIC_WORKFLOW_MAX_CONCURRENCY_ENV,
      parse: parsePositiveIntegerEnv,
    },
  },
);

export const stripDynamicWorkflowEnv = stripEnvBoundFields(dynamicWorkflowEnvBindings);

registerConfigSection(DYNAMIC_WORKFLOW_SECTION, DynamicWorkflowConfigSchema, {
  defaultValue: { timeoutMs: DEFAULT_DYNAMIC_WORKFLOW_TIMEOUT_MS },
  env: dynamicWorkflowEnvBindings,
  stripEnv: stripDynamicWorkflowEnv,
});

export function resolveDynamicWorkflowTimeoutMs(config: IConfigService): number {
  return (
    config.get<DynamicWorkflowConfig | undefined>(DYNAMIC_WORKFLOW_SECTION)?.timeoutMs ??
    DEFAULT_DYNAMIC_WORKFLOW_TIMEOUT_MS
  );
}

export function resolveDynamicWorkflowMaxConcurrency(
  config: IConfigService,
  rawEnv?: string,
): number | undefined {
  if (
    rawEnv !== undefined &&
    rawEnv.trim() !== '' &&
    parsePositiveIntegerEnv(rawEnv) === undefined
  ) {
    throw new Error(
      `${DYNAMIC_WORKFLOW_MAX_CONCURRENCY_ENV} must be a positive integer, got ${JSON.stringify(rawEnv)}.`,
    );
  }
  return config.get<DynamicWorkflowConfig | undefined>(DYNAMIC_WORKFLOW_SECTION)?.maxConcurrency;
}
