import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const AUTO_SESSION_TITLE_FLAG_ID = 'auto_session_title';
export const AUTO_SESSION_TITLE_FLAG_ENV = 'PYTHINKER_CODE_EXPERIMENTAL_AUTO_SESSION_TITLE';

export const sessionTitleFlag: FlagDefinitionInput = {
  id: AUTO_SESSION_TITLE_FLAG_ID,
  title: 'AI session titles',
  description:
    'Reserved session-title generation surface; this build has no title-generation backend.',
  env: AUTO_SESSION_TITLE_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(sessionTitleFlag);
