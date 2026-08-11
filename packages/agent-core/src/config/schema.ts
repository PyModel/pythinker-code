import { HOOK_EVENT_TYPES } from '../session/hooks/types';
import { parsePattern } from '#/agent/permission/matches-rule';
import { ErrorCodes, PythinkerError } from '#/errors';
import { z } from 'zod';

export const ProviderTypeSchema = z.enum([
  'anthropic',
  'openai',
  'pythinker',
  'google-genai',
  'openai_responses',
  'vertexai',
]);

export type ProviderType = z.infer<typeof ProviderTypeSchema>;


const StringRecordSchema = z.record(z.string(), z.string());

const ProviderConfigFieldsSchema = z.object({
  type: ProviderTypeSchema,
  apiKey: z.string().optional(),
  apiKeyEnvVar: z.string().trim().min(1).optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  env: StringRecordSchema.optional(),
  customHeaders: StringRecordSchema.optional(),
  source: z.record(z.string(), z.unknown()).optional(),
});

export const ProviderConfigSchema = ProviderConfigFieldsSchema;

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ModelAliasSchema = z.object({
  provider: z.string(),
  model: z.string(),
  maxContextSize: z.number().int().min(1),
  maxOutputSize: z.number().int().min(1).optional(),
  capabilities: z.array(z.string()).optional(),
  supportEfforts: z.array(z.string()).optional(),
  thinkingBudgets: z.record(z.string(), z.number().int().min(0)).optional(),
  displayName: z.string().optional(),
  reasoningKey: z.string().optional(),
  // Explicitly declare adaptive-thinking support, overriding the kosong
  // model-name version inference. Needed for custom-named Anthropic endpoints
  // whose model name does not encode a parseable Claude version.
  adaptiveThinking: z.boolean().optional(),
});

export type ModelAlias = z.infer<typeof ModelAliasSchema>;

export const ThinkingConfigSchema = z.object({
  mode: z.enum(['auto', 'on', 'off']).optional(),
  effort: z.string().optional(),
});

export type ThinkingConfig = z.infer<typeof ThinkingConfigSchema>;

export const PermissionModeSchema = z.enum(['yolo', 'manual', 'auto']);

export const WorkflowSizeGuidelineSchema = z.enum(['small', 'medium', 'large', 'unrestricted']);

export type WorkflowSizeGuideline = z.infer<typeof WorkflowSizeGuidelineSchema>;

export const PermissionRuleDecisionSchema = z.enum(['allow', 'deny', 'ask']);
export const PermissionRuleScopeSchema = z.enum([
  'turn-override',
  'session-runtime',
  'project',
  'user',
]);

export const PermissionRuleSchema = z.object({
  decision: PermissionRuleDecisionSchema,
  scope: PermissionRuleScopeSchema.default('user'),
  pattern: z.string().min(1).refine(isValidPermissionPattern, {
    message: 'Invalid permission rule pattern',
  }),
  reason: z.string().optional(),
});

export const PermissionConfigSchema = z.object({
  rules: z.array(PermissionRuleSchema).optional(),
});

export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;

export const LoopControlSchema = z.object({
  maxStepsPerTurn: z.number().int().min(0).optional(),
  maxRetriesPerStep: z.number().int().min(0).optional(),
  maxRalphIterations: z.number().int().min(-1).optional(),
  reservedContextSize: z.number().int().min(0).optional(),
  compactionTriggerRatio: z.number().min(0.5).max(0.99).optional(),
});

export type LoopControl = z.infer<typeof LoopControlSchema>;

export const BackgroundConfigSchema = z.object({
  maxRunningTasks: z.number().int().min(1).optional(),
  keepAliveOnExit: z.boolean().optional(),
  killGracePeriodMs: z.number().int().min(0).optional(),
  printWaitCeilingS: z.number().int().min(1).optional(),
});

export type BackgroundConfig = z.infer<typeof BackgroundConfigSchema>;

export const ExperimentalConfigSchema = z.record(z.string(), z.boolean());

export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>;

const HookDefBaseSchema = {
  event: z.enum(HOOK_EVENT_TYPES),
  matcher: z.string().optional(),
  if: z.string().optional(),
  statusMessage: z.string().optional(),
  timeout: z.number().int().min(1).max(600).optional(),
  once: z.boolean().optional(),
  async: z.boolean().optional(),
} as const;

export const CommandHookDefSchema = z
  .object({
    ...HookDefBaseSchema,
    type: z.literal('command').optional(),
    command: z.string().min(1),
    asyncRewake: z.boolean().optional(),
    shell: z.enum(['bash', 'powershell']).optional(),
  })
  .strict();

export const HttpHookDefSchema = z
  .object({
    ...HookDefBaseSchema,
    type: z.literal('http'),
    url: z.url(),
    headers: StringRecordSchema.optional(),
    allowedEnvVars: z.array(z.string().min(1)).optional(),
  })
  .strict();

const ModelHookDefSchema = z
  .object({
    ...HookDefBaseSchema,
    type: z.enum(['prompt', 'agent']),
    prompt: z.string().min(1),
    model: z.string().trim().min(1).optional(),
  })
  .strict();

export const HookDefSchema = z.union([
  CommandHookDefSchema,
  HttpHookDefSchema,
  ModelHookDefSchema,
]);

export type HookDefConfig = z.infer<typeof HookDefSchema>;

const HOOK_EVENTS = new Set<string>(HOOK_EVENT_TYPES);

export function parseFrontmatterHooks(value: unknown): HookDefConfig[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const parsed = z.array(HookDefSchema).safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }
  if (!isRecord(value)) return undefined;

  const hooks: HookDefConfig[] = [];
  for (const [event, matchers] of Object.entries(value)) {
    if (!HOOK_EVENTS.has(event) || !Array.isArray(matchers)) return undefined;
    for (const matcher of matchers) {
      if (!isRecord(matcher) || !Array.isArray(matcher['hooks'])) return undefined;
      const matcherValue =
        typeof matcher['matcher'] === 'string' && matcher['matcher'].trim().length > 0
          ? matcher['matcher'].trim()
          : undefined;
      for (const hook of matcher['hooks']) {
        if (!isRecord(hook)) return undefined;
        const parsed = HookDefSchema.safeParse({
          ...hook,
          event,
          matcher: matcherValue,
        });
        if (!parsed.success) return undefined;
        hooks.push(parsed.data);
      }
    }
  }
  return hooks;
}

export const PythoughtsServiceConfigSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  customHeaders: StringRecordSchema.optional(),
});

export type PythoughtsServiceConfig = z.infer<typeof PythoughtsServiceConfigSchema>;

export const ServicesConfigSchema = z.object({
  pythoughtsSearch: PythoughtsServiceConfigSchema.optional(),
  pythoughtsFetch: PythoughtsServiceConfigSchema.optional(),
});

export type ServicesConfig = z.infer<typeof ServicesConfigSchema>;

const McpServerCommonFields = {
  enabled: z.boolean().optional(),
  startupTimeoutMs: z.number().int().min(1).optional(),
  toolTimeoutMs: z.number().int().min(1).optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
} as const;

export const McpServerStdioConfigSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: StringRecordSchema.optional(),
  cwd: z.string().optional(),
  // Reserved for future kaos-backed stdio launchers. `undefined` and `'local'`
  // both mean direct child_process spawn for now.
  executor: z.enum(['local', 'kaos']).optional(),
  ...McpServerCommonFields,
});

export type McpServerStdioConfig = z.infer<typeof McpServerStdioConfigSchema>;

export const McpServerHttpConfigSchema = z.object({
  transport: z.literal('http'),
  url: z.string().url(),
  headers: StringRecordSchema.optional(),
  // Indirect secret reference: the bearer token is looked up from
  // `process.env[bearerTokenEnvVar]` at connection time, never committed.
  bearerTokenEnvVar: z.string().min(1).optional(),
  ...McpServerCommonFields,
});

export type McpServerHttpConfig = z.infer<typeof McpServerHttpConfigSchema>;

export const McpServerSseConfigSchema = z.object({
  transport: z.literal('sse'),
  url: z.string().url(),
  headers: StringRecordSchema.optional(),
  // Indirect secret reference: the bearer token is looked up from
  // `process.env[bearerTokenEnvVar]` at connection time, never committed.
  bearerTokenEnvVar: z.string().min(1).optional(),
  ...McpServerCommonFields,
});

export type McpServerSseConfig = z.infer<typeof McpServerSseConfigSchema>;

export type McpRemoteServerConfig = McpServerHttpConfig | McpServerSseConfig;

const McpServerConfigDiscriminatedSchema = z.discriminatedUnion('transport', [
  McpServerStdioConfigSchema,
  McpServerHttpConfigSchema,
  McpServerSseConfigSchema,
]);

export const McpServerConfigSchema = z.preprocess((raw) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if ('transport' in obj) return obj;
  if (typeof obj['command'] === 'string') return { ...obj, transport: 'stdio' };
  if (typeof obj['url'] === 'string') return { ...obj, transport: 'http' };
  return obj;
}, McpServerConfigDiscriminatedSchema);

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const PythinkerConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  modelRoles: z.record(z.string(), z.string()).optional(),
  outputStyle: z.string().trim().min(1).optional(),
  models: z.record(z.string(), ModelAliasSchema).optional(),
  thinking: ThinkingConfigSchema.optional(),
  planMode: z.boolean().optional(),
  yolo: z.boolean().optional(),
  defaultThinking: z.boolean().optional(),
  defaultPermissionMode: PermissionModeSchema.optional(),
  defaultPlanMode: z.boolean().optional(),
  permission: PermissionConfigSchema.optional(),
  hooks: z.array(HookDefSchema).optional(),
  allowedHttpHookUrls: z.array(z.string().min(1)).optional(),
  httpHookAllowedEnvVars: z.array(z.string().min(1)).optional(),
  services: ServicesConfigSchema.optional(),
  mergeAllAvailableSkills: z.boolean().optional(),
  extraSkillDirs: z.array(z.string()).optional(),
  additionalDirs: z.array(z.string().trim().min(1)).optional(),
  loopControl: LoopControlSchema.optional(),
  background: BackgroundConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  telemetry: z.boolean().optional(),
  disableWorkflows: z.boolean().optional(),
  workflowSizeGuideline: WorkflowSizeGuidelineSchema.optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export type PythinkerConfig = z.infer<typeof PythinkerConfigSchema>;

const ProviderConfigPatchSchema = ProviderConfigFieldsSchema.partial();
const ModelAliasPatchSchema = ModelAliasSchema.partial();
const ThinkingConfigPatchSchema = ThinkingConfigSchema.partial();
const PermissionConfigPatchSchema = PermissionConfigSchema.partial();
const LoopControlPatchSchema = LoopControlSchema.partial();
const BackgroundConfigPatchSchema = BackgroundConfigSchema.partial();
const ExperimentalConfigPatchSchema = ExperimentalConfigSchema;
const PythoughtsServiceConfigPatchSchema = PythoughtsServiceConfigSchema.partial();
const ServicesConfigPatchSchema = z.object({
  pythoughtsSearch: PythoughtsServiceConfigPatchSchema.optional(),
  pythoughtsFetch: PythoughtsServiceConfigPatchSchema.optional(),
});

export const PythinkerConfigPatchSchema = z
  .object({
    providers: z.record(z.string(), ProviderConfigPatchSchema).optional(),
    defaultProvider: z.string().optional(),
    defaultModel: z.string().optional(),
    modelRoles: z.record(z.string(), z.string()).optional(),
    outputStyle: z.string().trim().min(1).optional(),
    models: z.record(z.string(), ModelAliasPatchSchema).optional(),
    thinking: ThinkingConfigPatchSchema.optional(),
    planMode: z.boolean().optional(),
    yolo: z.boolean().optional(),
    defaultThinking: z.boolean().optional(),
    defaultPermissionMode: PermissionModeSchema.optional(),
    defaultPlanMode: z.boolean().optional(),
    permission: PermissionConfigPatchSchema.optional(),
    hooks: z.array(HookDefSchema).optional(),
    allowedHttpHookUrls: z.array(z.string().min(1)).optional(),
    httpHookAllowedEnvVars: z.array(z.string().min(1)).optional(),
    services: ServicesConfigPatchSchema.optional(),
    mergeAllAvailableSkills: z.boolean().optional(),
    extraSkillDirs: z.array(z.string()).optional(),
    additionalDirs: z.array(z.string().trim().min(1)).optional(),
    loopControl: LoopControlPatchSchema.optional(),
    background: BackgroundConfigPatchSchema.optional(),
    experimental: ExperimentalConfigPatchSchema.optional(),
    telemetry: z.boolean().optional(),
    disableWorkflows: z.boolean().optional(),
    workflowSizeGuideline: WorkflowSizeGuidelineSchema.optional(),
  })
  .strict();

export type PythinkerConfigPatch = z.infer<typeof PythinkerConfigPatchSchema>;

export function getDefaultConfig(): PythinkerConfig {
  return {
    providers: {},
  };
}

export function validateConfig(config: unknown): PythinkerConfig {
  try {
    return PythinkerConfigSchema.parse(config);
  } catch (error) {
    throw new PythinkerError(ErrorCodes.CONFIG_INVALID, `Invalid configuration: ${formatConfigValidationError(error)}`, {
      cause: error,
    });
  }
}

export function formatConfigValidationError(error: unknown): string {
  const missingModelContextSize = missingModelContextSizeMessage(error);
  if (missingModelContextSize !== undefined) return missingModelContextSize;
  return error instanceof Error ? error.message : String(error);
}

function missingModelContextSizeMessage(error: unknown): string | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  for (const issue of error.issues) {
    const [section, modelName, field] = issue.path;
    if (section === 'models' && typeof modelName === 'string' && field === 'maxContextSize') {
      return `Model "${modelName}" must define a positive max_context_size in config.toml.`;
    }
  }
  return undefined;
}

function isValidPermissionPattern(pattern: string): boolean {
  try {
    parsePattern(pattern);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
