import type { Session, SkillSummary } from '@pythoughts/pythinker-code-sdk';

import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/pythinker-tui';
import type { SlashCommandHost } from './dispatch';
import type { PythinkerSlashCommand } from './types';

export type SkillListSession = Pick<Session, 'listSkills'>;

export interface SkillSlashCommands {
  readonly commands: readonly PythinkerSlashCommand[];
  readonly commandMap: ReadonlyMap<string, string>;
}

export function isUserActivatableSkill(skill: SkillSummary): boolean {
  return (
    skill.userInvocable !== false &&
    (skill.type === undefined ||
      skill.type === 'prompt' ||
      skill.type === 'inline' ||
      skill.type === 'flow')
  );
}

function compareSkillSlashCommands(a: SkillSummary, b: SkillSummary): number {
  return (
    getSkillSlashCommandGroup(a.source) - getSkillSlashCommandGroup(b.source) ||
    a.name.localeCompare(b.name)
  );
}

function getSkillSlashCommandGroup(source: SkillSummary['source']): number {
  return source === 'builtin' ? 0 : 1;
}

export function buildSkillSlashCommands(skills: readonly SkillSummary[]): SkillSlashCommands {
  const commandMap = new Map<string, string>();
  const sortedSkills = [...skills].toSorted(compareSkillSlashCommands);
  const commands = sortedSkills.filter(isUserActivatableSkill).map((skill) => {
    const commandName =
      skill.commandName ??
      (skill.source === 'builtin' || skill.isSubSkill === true
        ? skill.name
        : `skill:${skill.name}`);
    commandMap.set(commandName, skill.name);
    return {
      name: commandName,
      aliases: [],
      description: skill.description ?? '',
      argumentHint: skill.argumentHint,
    };
  });
  return { commands, commandMap };
}

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
