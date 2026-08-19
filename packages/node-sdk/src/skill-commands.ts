import type { SkillSummary } from '@pymodel/agent-core';

export interface SkillSlashCommand {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly argumentHint?: string;
}

export interface SkillSlashCommands {
  readonly commands: readonly SkillSlashCommand[];
  readonly commandMap: ReadonlyMap<string, string>;
}

export function isUserActivatableSkill(skill: SkillSummary): boolean {
  return (
    skill.type === undefined ||
    skill.type === 'prompt' ||
    skill.type === 'inline' ||
    skill.type === 'flow'
  );
}

function compareSkillSlashCommands(a: SkillSummary, b: SkillSummary): number {
  return (
    skillSlashCommandGroup(a.source) - skillSlashCommandGroup(b.source) ||
    a.name.localeCompare(b.name)
  );
}

function skillSlashCommandGroup(source: SkillSummary['source']): number {
  return source === 'builtin' ? 0 : 1;
}

export function buildSkillSlashCommands(skills: readonly SkillSummary[]): SkillSlashCommands {
  const commandMap = new Map<string, string>();
  const commands = [...skills]
    .toSorted(compareSkillSlashCommands)
    .filter(isUserActivatableSkill)
    .map((skill) => {
      const commandName =
        skill.source === 'builtin' || skill.isSubSkill === true
          ? skill.name
          : `skill:${skill.name}`;
      commandMap.set(commandName, skill.name);
      return {
        name: commandName,
        aliases: [] as readonly string[],
        description: skill.description ?? '',
      };
    });
  return { commands, commandMap };
}
