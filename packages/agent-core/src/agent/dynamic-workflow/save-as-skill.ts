import { promises as fs } from 'node:fs';

import path from 'pathe';

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
 */
export async function writeSavedWorkflowSkill(input: {
  readonly scope: SavedWorkflowScope;
  readonly workflow: SavedWorkflow;
  readonly projectRoot: string;
  readonly brandHomeDir: string;
}): Promise<string> {
  const dir = savedWorkflowSkillDir({
    scope: input.scope,
    name: input.workflow.name,
    projectRoot: input.projectRoot,
    brandHomeDir: input.brandHomeDir,
  });
  const content = renderSavedWorkflowSkill({
    ...input.workflow,
    name: savedWorkflowSkillName(input.workflow.name),
  });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), content, 'utf8');
  return dir;
}
