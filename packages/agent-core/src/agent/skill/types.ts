import type { SkillDefinition } from '../../skill';

export interface SkillRegistry {
  getSkill(name: string): SkillDefinition | undefined;
  getPluginSkill(pluginId: string, name: string): SkillDefinition | undefined;
  activateForPaths?(
    filePaths: readonly string[],
    cwd: string,
  ): readonly SkillDefinition[];
  loadNestedForPaths?(
    filePaths: readonly string[],
    cwd: string,
  ): Promise<readonly SkillDefinition[]>;
  renderSkillPrompt(skill: SkillDefinition, rawArgs: string): string;
  listInvocableSkills(): readonly SkillDefinition[];
  getSkillRoots(): readonly string[];
  getModelSkillListing(): string;
}
