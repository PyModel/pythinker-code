import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const OUTPUT_TOKEN_RECOVERY_FLAG_ID = 'output-token-recovery';
export const OUTPUT_TOKEN_RECOVERY_FLAG_ENV = 'PYTHINKER_CODE_EXPERIMENTAL_OUTPUT_TOKEN_RECOVERY';

export const MODEL_FALLBACK_FLAG_ID = 'model-fallback';
export const MODEL_FALLBACK_FLAG_ENV = 'PYTHINKER_CODE_EXPERIMENTAL_MODEL_FALLBACK';

export const outputTokenRecoveryFlag: FlagDefinitionInput = {
  id: OUTPUT_TOKEN_RECOVERY_FLAG_ID,
  title: 'Output token recovery',
  description:
    'When a model response ends truncated at the output token limit with no tool calls, inject a resume nudge and continue the same turn instead of ending it truncated. Caps recoveries per turn.',
  env: OUTPUT_TOKEN_RECOVERY_FLAG_ENV,
  default: false,
  surface: 'core',
};

export const modelFallbackFlag: FlagDefinitionInput = {
  id: MODEL_FALLBACK_FLAG_ID,
  title: 'Model fallback',
  description:
    'When step retries are exhausted on persistent retryable provider errors, switch the agent to the configured loopControl.fallback_model once per turn and retry the failed step there.',
  env: MODEL_FALLBACK_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(outputTokenRecoveryFlag);
registerFlagDefinition(modelFallbackFlag);
