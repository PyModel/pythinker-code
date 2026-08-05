import { homedir } from 'node:os';

import { registerBuiltinSkills } from './builtin';
import { SessionSkillRegistry } from './registry';
import { resolveSkillRoots } from './scanner';
import { summarizeSkill, type SkillRoot, type SkillSummary } from './types';

/**
 * Field-for-field the resolution inputs a session uses, so a caller can pass the
 * config it already assembles for sessions. Declared here rather than imported
 * from the session layer, which depends on this one.
 */
export interface ListWorkspaceSkillsOptions {
  /** Directory the skills are resolved for, as a session's cwd would be. */
  readonly workDir: string;
  readonly userHomeDir?: string;
  /** Brand data dir (PYTHINKER_CODE_HOME); user brand skills live under `<brandHomeDir>/skills`. */
  readonly brandHomeDir?: string;
  readonly explicitDirs?: readonly string[];
  readonly extraDirs?: readonly string[];
  readonly pluginSkillRoots?: readonly SkillRoot[];
  readonly mergeAllAvailableSkills?: boolean;
  readonly builtinDir?: string;
  readonly onWarning?: (message: string, cause?: unknown) => void;
}

/**
 * The skill catalog a workspace resolves to, without opening a session.
 *
 * A session's own `listSkills` additionally reports the prompts of its MCP
 * connections; those belong to a live session and are absent here.
 */
export async function listWorkspaceSkills(
  options: ListWorkspaceSkillsOptions,
): Promise<readonly SkillSummary[]> {
  const registry = new SessionSkillRegistry({ onWarning: options.onWarning });
  const roots = await resolveSkillRoots({
    paths: {
      userHomeDir: options.userHomeDir ?? homedir(),
      brandHomeDir: options.brandHomeDir,
      workDir: options.workDir,
    },
    explicitDirs: options.explicitDirs,
    extraDirs: options.extraDirs,
    pluginSkillRoots: options.pluginSkillRoots,
    mergeAllAvailableSkills: options.mergeAllAvailableSkills,
    builtinDir: options.builtinDir,
  });
  await registry.loadRoots(roots);
  registerBuiltinSkills(registry);
  return registry.listSkills().map(summarizeSkill);
}
