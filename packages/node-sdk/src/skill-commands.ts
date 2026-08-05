import type { SkillSummary } from '@pythoughts/agent-core';

export interface SkillSlashCommand {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly argumentHint?: string;
}

export interface SkillSlashCommands {
  readonly commands: readonly SkillSlashCommand[];
  /** Slash command name → skill name, for dispatching an invocation back to the engine. */
  readonly commandMap: ReadonlyMap<string, string>;
}

/** A skill a person can invoke by hand, as opposed to one only the model may load. */
export function isUserActivatableSkill(skill: SkillSummary): boolean {
  return (
    skill.userInvocable !== false &&
    (skill.type === undefined ||
      skill.type === 'prompt' ||
      skill.type === 'inline' ||
      skill.type === 'flow')
  );
}

/** Built-in skills come first; everything else keeps alphabetical order. */
function compareSkillSlashCommands(a: SkillSummary, b: SkillSummary): number {
  return (
    skillSlashCommandGroup(a.source) - skillSlashCommandGroup(b.source) ||
    a.name.localeCompare(b.name)
  );
}

function skillSlashCommandGroup(source: SkillSummary['source']): number {
  return source === 'builtin' ? 0 : 1;
}

/**
 * Projects a skill catalog into slash commands. Built-in skills and sub-skills
 * keep their bare name; everything else is namespaced under `skill:` so a
 * workspace skill cannot shadow a host command.
 */
export function buildSkillSlashCommands(skills: readonly SkillSummary[]): SkillSlashCommands {
  const commandMap = new Map<string, string>();
  const commands = [...skills]
    .toSorted(compareSkillSlashCommands)
    .filter(isUserActivatableSkill)
    .map((skill) => {
      const commandName =
        skill.commandName ??
        (skill.source === 'builtin' || skill.isSubSkill === true
          ? skill.name
          : `skill:${skill.name}`);
      commandMap.set(commandName, skill.name);
      return {
        name: commandName,
        aliases: [] as readonly string[],
        description: skill.description ?? '',
        argumentHint: skill.argumentHint,
      };
    });
  return { commands, commandMap };
}
