import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const OUTPUT_TOKEN_RECOVERY_FLAG_ID = 'output-token-recovery';
export const OUTPUT_TOKEN_RECOVERY_FLAG_ENV = 'PYTHINKER_CODE_EXPERIMENTAL_OUTPUT_TOKEN_RECOVERY';

export const outputTokenRecoveryFlag: FlagDefinitionInput = {
  id: OUTPUT_TOKEN_RECOVERY_FLAG_ID,
  title: 'Output token recovery',
  description:
    'When a model response ends truncated at the output token limit with no tool calls, inject a resume nudge and continue the same turn instead of ending it truncated. Caps recoveries per turn.',
  env: OUTPUT_TOKEN_RECOVERY_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(outputTokenRecoveryFlag);
