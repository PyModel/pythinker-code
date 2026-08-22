import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const TURN_BUDGET_CONTINUATION_FLAG_ID = 'turn-budget-continuation';
export const TURN_BUDGET_CONTINUATION_FLAG_ENV =
  'PYTHINKER_CODE_EXPERIMENTAL_TURN_BUDGET_CONTINUATION';

export const turnBudgetContinuationFlag: FlagDefinitionInput = {
  id: TURN_BUDGET_CONTINUATION_FLAG_ID,
  title: 'Turn budget continuation',
  description:
    'When loopControl.turn_budget_tokens is set, keep a naturally-stopping turn working toward the output-token target with continuation nudges until the threshold is reached or progress diminishes.',
  env: TURN_BUDGET_CONTINUATION_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(turnBudgetContinuationFlag);
