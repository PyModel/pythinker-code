import { constants, promises as fs } from 'node:fs';

import path from 'pathe';

import { resolveSafePath } from '../../services/fs/fsPathSafety';
import { normalizeSkillName } from '../../skill/types';

/**
 * A saved workflow's name becomes both a directory name and a slash command,
 * so it has to survive being neither. Lowercase alphanumeric words joined by
 * single hyphens is the whole alphabet — no separators, no dots, nothing that
 * `path.join` would resolve upwards.
 */
const SAFE_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * Slug for a saved workflow, or a throw naming the offending input.
 *
 * `normalizeSkillName` only lowercases — it is not a sanitizer. Leaning on it
 * alone would let `../../etc` through `path.join` and straight out of the
 * project root, so the result is validated here rather than assumed safe.
 */
export function savedWorkflowSkillName(name: string): string {
  const slug = normalizeSkillName(name.trim()).replaceAll(/\s+/gu, '-');
  if (!SAFE_SKILL_NAME.test(slug)) {
    throw new Error(
      `Cannot save workflow skill: name ${JSON.stringify(name)} is not a valid skill name. Use letters, digits and hyphens.`,
    );
  }
  return slug;
}

export type SavedWorkflowScope = 'project' | 'personal';

export interface SavedWorkflow {
  readonly name: string;
  readonly description: string;
  readonly subagentType?: string;
  readonly promptTemplate?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly outputSchema?: Record<string, unknown>;
}

/**
 * Directory where a saved dynamic-workflow skill lands.
 *
 * Project scope: `<projectRoot>/.pythinker-code/skills/<normalized name>`.
 * Personal scope: `<brandHomeDir>/skills/<normalized name>`. brandHomeDir
 * already IS the brand data dir (~/.pythinker-code or $PYTHINKER_CODE_HOME),
 * so it must not gain another `.pythinker-code` segment — that would nest
 * twice. The project path does need the `.pythinker-code` segment; the
 * asymmetry is deliberate.
 */
export function savedWorkflowSkillDir(input: {
  readonly scope: SavedWorkflowScope;
  readonly name: string;
  readonly projectRoot: string;
  readonly brandHomeDir: string;
}): string {
  const normalized = savedWorkflowSkillName(input.name);
  if (input.scope === 'project') {
    return path.join(input.projectRoot, '.pythinker-code', 'skills', normalized);
  }
  return path.join(input.brandHomeDir, 'skills', normalized);
}

/**
 * YAML's double-quoted style uses JSON's escapes, so `JSON.stringify` produces
 * a valid scalar and handles what hand-rolled quote/backslash escaping misses:
 * a newline or control character in a description would otherwise be emitted
 * raw and split the frontmatter.
 */
function quoteYamlScalar(value: string): string {
  return JSON.stringify(value);
}

// A fence that cannot collide with the template body: start at ``` and grow
// until the sequence does not appear inside the content.
function renderFence(content: string): string {
  let fence = '```';
  while (content.includes(fence)) {
    fence += '`';
  }
  return fence;
}

export function renderSavedWorkflowSkill(workflow: SavedWorkflow): string {
  const lines: string[] = [
    '---',
    `name: ${quoteYamlScalar(workflow.name)}`,
    `description: ${quoteYamlScalar(workflow.description)}`,
  ];
  if (workflow.subagentType !== undefined) {
    lines.push(`subagent-type: ${quoteYamlScalar(workflow.subagentType)}`);
  }
  if (workflow.model !== undefined) {
    lines.push(`model: ${quoteYamlScalar(workflow.model)}`);
  }
  if (workflow.effort !== undefined) {
    lines.push(`effort: ${quoteYamlScalar(workflow.effort)}`);
  }
  lines.push('---', '', `# ${workflow.description}`);
  if (workflow.promptTemplate !== undefined) {
    const fence = renderFence(workflow.promptTemplate);
    lines.push('', '## Prompt template', '', fence, workflow.promptTemplate, fence);
  }
  if (workflow.outputSchema !== undefined) {
    lines.push(
      '',
      '## Output schema',
      '',
      '```json',
      JSON.stringify(workflow.outputSchema, null, 2),
      '```',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Write a saved workflow to disk and return the directory it landed in.
 *
 * Lives here rather than in the slash command so every surface that can run a
 * workflow can also keep one. The name is validated before any directory is
 * created, so a rejected name leaves nothing behind.
 *
 * A validated name is not enough on its own. Agents work in repositories they
 * did not write, and a checked-out tree can already contain
 * `.pythinker-code/skills/<name>/SKILL.md` as a symlink pointing anywhere on
 * the machine — saving a workflow would then write through it. The resolved
 * path is checked against the scope root before the write, and the write
 * itself refuses to follow a final symlink, so neither a planted link nor one
 * swapped in afterwards is followed.
 */
export async function writeSavedWorkflowSkill(input: {
  readonly scope: SavedWorkflowScope;
  readonly workflow: SavedWorkflow;
  readonly projectRoot: string;
  readonly brandHomeDir: string;
}): Promise<string> {
  const name = savedWorkflowSkillName(input.workflow.name);
  const root = input.scope === 'project' ? input.projectRoot : input.brandHomeDir;
  const dir = savedWorkflowSkillDir({
    scope: input.scope,
    name: input.workflow.name,
    projectRoot: input.projectRoot,
    brandHomeDir: input.brandHomeDir,
  });
  const content = renderSavedWorkflowSkill({ ...input.workflow, name });
  const skillMdPath = path.join(dir, 'SKILL.md');

  // Before `mkdir`, not after: a symlinked `skills/` would otherwise have a
  // directory created through it and left behind outside the project even
  // though the write was refused.
  await assertResolvesInsideRoot(root, dir);
  await fs.mkdir(dir, { recursive: true });
  // Again once the directory exists, so a `SKILL.md` symlink planted inside it
  // is resolved rather than treated as the not-yet-existing tail.
  await assertResolvesInsideRoot(root, skillMdPath);
  await writeFileNoFollow(skillMdPath, content);
  return dir;
}

/** Throws when `target` resolves outside `root` once every symlink is followed. */
async function assertResolvesInsideRoot(root: string, target: string): Promise<void> {
  // `target` was built from `root` verbatim, so take the relative path against
  // that same un-resolved root. Measuring it against the realpath instead makes
  // every `/var` -> `/private/var` style link look like a `..` escape.
  const relative = path.relative(root, target);
  // `resolveSafePath` rejects an absolute or `..`-bearing input outright, and
  // otherwise resolves the longest existing prefix through its symlinks before
  // checking containment — which is exactly the planted-link case.
  await resolveSafePath(await fs.realpath(root), relative);
}

/**
 * Write without following a symlink at the final path component.
 *
 * `O_NOFOLLOW` is POSIX; on a platform without it the constant is undefined and
 * the containment check above is the guard, so the flag is added only when the
 * runtime offers it rather than failing the save outright.
 */
async function writeFileNoFollow(target: string, content: string): Promise<void> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}
