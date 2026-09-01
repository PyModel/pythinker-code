import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const EXPERT_TALK_FLAG_ID = 'expert_talk';

export const expertTalkFlag: FlagDefinitionInput = {
  id: EXPERT_TALK_FLAG_ID,
  title: 'Discussion',
  description: 'Combine two models through independent analysis, peer review, and fusion.',
  env: 'PYTHINKER_CODE_EXPERIMENTAL_EXPERT_TALK',
  default: false,
  surface: 'both',
};

registerFlagDefinition(expertTalkFlag);
