import {
  buildSkillSlashCommands,
  isUserActivatableSkill,
  type Session,
} from '@pythoughts/pythinker-code-sdk';

import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/pythinker-tui';
import type { SlashCommandHost } from './dispatch';

export type SkillListSession = Pick<Session, 'listSkills'>;

export type { SkillSlashCommands } from '@pythoughts/pythinker-code-sdk';
export { buildSkillSlashCommands, isUserActivatableSkill };

export async function handleSkillsCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /skills');
    return;
  }
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const skills = (await host.session.listSkills()).filter(isUserActivatableSkill);
  if (skills.length === 0) {
    host.showNotice(
      'No skills found',
      'Create skills in .pythinker-code/skills or ~/.pythinker-code/skills.',
    );
    return;
  }
  host.showNotice(
    `Skills (${String(skills.length)})`,
    skills
      .map((skill) => `/${skill.name} · ${skill.source} · ${skill.description}`)
      .join('\n'),
  );
}
