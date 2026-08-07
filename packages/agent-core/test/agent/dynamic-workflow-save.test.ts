import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';

import { load as loadYaml } from 'js-yaml';
import path from 'pathe';
import { describe, expect, it } from 'vitest';

import {
  renderSavedWorkflowSkill,
  savedWorkflowSkillDir,
} from '../../src/agent/dynamic-workflow/save-as-skill';
import { parseSkillFromFile } from '../../src/skill/parser';

function frontmatterOf(rendered: string): string {
  const lines = rendered.split('\n');
  expect(lines[0]).toBe('---');
  const end = lines.indexOf('---', 1);
  expect(end).toBeGreaterThan(1);
  return lines.slice(1, end).join('\n');
}

describe('savedWorkflowSkillDir', () => {
  it('project scope path has exactly one .pythinker-code segment', () => {
    const dir = savedWorkflowSkillDir({
      scope: 'project',
      name: 'review',
      projectRoot: '/repo',
      brandHomeDir: '/home/user/.pythinker-code',
    });
    expect(dir).toBe('/repo/.pythinker-code/skills/review');
    const segments = dir.split('/').filter((part) => part === '.pythinker-code');
    expect(segments).toHaveLength(1);
  });

  it('personal scope path has no added .pythinker-code segment', () => {
    const dir = savedWorkflowSkillDir({
      scope: 'personal',
      name: 'review',
      projectRoot: '/repo',
      brandHomeDir: '/home/user/.pythinker-code',
    });
    expect(dir).toBe('/home/user/.pythinker-code/skills/review');
    const segments = dir.split('/').filter((part) => part === '.pythinker-code');
    expect(segments).toHaveLength(1);
  });

  it('slugifies a mixed-case name with spaces into the directory', () => {
    const dir = savedWorkflowSkillDir({
      scope: 'project',
      name: '  My Cool   Workflow ',
      projectRoot: '/repo',
      brandHomeDir: '/home/user/.pythinker-code',
    });
    expect(dir).toBe('/repo/.pythinker-code/skills/my-cool-workflow');
  });

  // `normalizeSkillName` only lowercases. Trusting it as a sanitizer let
  // `../../..` through `path.join` and resolved the saved skill clean out of
  // the project root, to wherever the traversal pointed.
  it.each([
    ['..', '..'],
    ['traversal', '../../../../tmp/pwned'],
    ['separator', 'a/b'],
    ['backslash', 'a\\b'],
    ['empty', ''],
    ['blank', '   '],
    ['dotted', 'a.b'],
    ['leading hyphen', '-lead'],
  ])('refuses to build a path from a %s name', (_label, name) => {
    for (const scope of ['project', 'personal'] as const) {
      expect(() =>
        savedWorkflowSkillDir({
          scope,
          name,
          projectRoot: '/repo',
          brandHomeDir: '/home/user/.pythinker-code',
        }),
      ).toThrow(/not a valid skill name/);
    }
  });
});

describe('renderSavedWorkflowSkill', () => {
  it('omits absent optional keys and keeps the documented key order', () => {
    const minimal = renderSavedWorkflowSkill({
      name: 'review',
      description: 'Review the diff',
    });
    const minimalFrontmatter = (loadYaml(frontmatterOf(minimal)) ?? {}) as Record<
      string,
      unknown
    >;
    expect(Object.keys(minimalFrontmatter)).toEqual(['name', 'description']);

    const full = renderSavedWorkflowSkill({
      name: 'review',
      description: 'Review the diff',
      subagentType: 'reviewer',
      model: 'claude-sonnet-4',
      effort: 'high',
    });
    const fullFrontmatter = (loadYaml(frontmatterOf(full)) ?? {}) as Record<
      string,
      unknown
    >;
    expect(Object.keys(fullFrontmatter)).toEqual([
      'name',
      'description',
      'subagent-type',
      'model',
      'effort',
    ]);
    expect(fullFrontmatter).toMatchObject({
      name: 'review',
      description: 'Review the diff',
      'subagent-type': 'reviewer',
      model: 'claude-sonnet-4',
      effort: 'high',
    });
  });

  it('double-quotes and escapes a description with `: `, quotes, and backslashes', () => {
    const rendered = renderSavedWorkflowSkill({
      name: 'triage',
      description: 'Triage: the "urgent" queue #1 (C:\\work\\files)',
    });
    const frontmatter = frontmatterOf(rendered);
    expect(frontmatter).toContain(
      'description: "Triage: the \\"urgent\\" queue #1 (C:\\\\work\\\\files)"',
    );
    const parsed = (loadYaml(frontmatter) ?? {}) as Record<string, unknown>;
    expect(parsed).toEqual({
      name: 'triage',
      description: 'Triage: the "urgent" queue #1 (C:\\work\\files)',
    });
  });

  it('lengthens the fence when the template contains a ``` sequence', () => {
    const template = 'Run this:\n```\nls -la\n```\nThen report.';
    const rendered = renderSavedWorkflowSkill({
      name: 'run',
      description: 'Run a command',
      promptTemplate: template,
    });
    expect(rendered).toContain('## Prompt template');
    expect(rendered).toContain(`\`\`\`\`\n${template}\n\`\`\`\``);
    expect(rendered.trimEnd().endsWith('````')).toBe(true);
  });

  it('renders the output schema block only when outputSchema is set', () => {
    const withSchema = renderSavedWorkflowSkill({
      name: 'plan',
      description: 'Make a plan',
      outputSchema: { type: 'object', properties: { steps: { type: 'array' } } },
    });
    expect(withSchema).toContain('## Output schema');
    expect(withSchema).toContain('```json');
    expect(withSchema).toContain('"type": "object"');

    const withoutSchema = renderSavedWorkflowSkill({
      name: 'plan',
      description: 'Make a plan',
    });
    expect(withoutSchema).not.toContain('## Output schema');
    expect(withoutSchema).not.toContain('```json');
  });

  it('leads the body with a `# <description>` heading', () => {
    const rendered = renderSavedWorkflowSkill({
      name: 'review',
      description: 'Review the diff',
      promptTemplate: 'Inspect the changes.',
    });
    expect(rendered).toContain('\n---\n\n# Review the diff\n');
  });
});

// Rendering valid-looking Markdown is not the contract — being loadable as a
// skill is. This drives the real parser the discovery path uses, so a saved
// workflow that cannot be read back fails here rather than at the next launch.
describe('a saved workflow round-trips through the skill parser', () => {
  it('parses back into a skill carrying the workflow fields', async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'workflow-skill-'));
    try {
      const skillMdPath = path.join(dir, 'SKILL.md');
      await fs.writeFile(
        skillMdPath,
        renderSavedWorkflowSkill({
          name: 'review-diff',
          description: 'Triage: the "urgent" queue',
          subagentType: 'reviewer',
          model: 'claude-sonnet-4',
          effort: 'high',
          promptTemplate: 'Review {{item}} and report.',
          outputSchema: { type: 'object' },
        }),
        'utf8',
      );

      const skill = await parseSkillFromFile({
        skillMdPath,
        skillDirName: 'review-diff',
        source: 'project',
      });

      expect(skill.name).toBe('review-diff');
      expect(skill.description).toBe('Triage: the "urgent" queue');
      expect(skill.content).toContain('Review {{item}} and report.');
      expect(skill.metadata).toMatchObject({
        model: 'claude-sonnet-4',
        effort: 'high',
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
