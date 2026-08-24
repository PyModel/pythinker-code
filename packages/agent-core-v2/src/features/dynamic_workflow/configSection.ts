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
});

export type DynamicWorkflowConfig = z.infer<typeof DynamicWorkflowConfigSchema>;

export const DEFAULT_DYNAMIC_WORKFLOW_TIMEOUT_MS = 2 * 60 * 60 * 1000;

export const DYNAMIC_WORKFLOW_TIMEOUT_ENV =
  'PYTHINKER_CODE_AGENT_DYNAMIC_WORKFLOW_TIMEOUT_MS';

function parseTimeoutMsEnv(raw: string): number | undefined {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

export const dynamicWorkflowEnvBindings: EnvBindings<DynamicWorkflowConfig> = envBindings(
  DynamicWorkflowConfigSchema,
  {
    timeoutMs: { env: DYNAMIC_WORKFLOW_TIMEOUT_ENV, parse: parseTimeoutMsEnv },
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
