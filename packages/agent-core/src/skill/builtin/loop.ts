import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import LOOP_BODY from './loop.md?raw';

const PSEUDO_PATH = 'builtin://loop';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/loop.md',
  skillDirName: 'loop',
  source: 'builtin',
  text: LOOP_BODY,
});

export const LOOP_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
