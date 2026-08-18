import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import CHECK_PYTHINKER_CODE_DOCS_BODY from './check-pythinker-code-docs.md?raw';

const PSEUDO_PATH = 'builtin://check-pythinker-code-docs';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/check-pythinker-code-docs.md',
  skillDirName: 'check-pythinker-code-docs',
  source: 'builtin',
  text: CHECK_PYTHINKER_CODE_DOCS_BODY,
});

export const CHECK_PYTHINKER_CODE_DOCS_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
