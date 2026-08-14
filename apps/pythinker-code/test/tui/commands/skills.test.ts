import type { SlashCommandHost } from '#/tui/commands';
import {
  buildSkillSlashCommands,
  handleAgentsCommand,
  handleSkillsCommand,
  isUserActivatableSkill,
} from '#/tui/commands/index';
import type { SkillSummary } from '@pymodel/pythinker-code-sdk';
import { describe, expect, it, vi } from 'vitest';

function skill(
  name: string,
  type?: SkillSummary['type'],
  extra: Partial<SkillSummary> = {},
): SkillSummary {
  return {
    name,
    type,
    description: `${name} skill`,
    ...extra,
  } as SkillSummary;
}

describe('skill slash commands', () => {
  it('allows user-activatable skill types', () => {
    expect(isUserActivatableSkill(skill('default'))).toBe(true);
    expect(isUserActivatableSkill(skill('prompt', 'prompt'))).toBe(true);
    expect(isUserActivatableSkill(skill('inline', 'inline'))).toBe(true);
    expect(isUserActivatableSkill(skill('flow', 'flow'))).toBe(true);
  });

  it('filters non-user-activatable skill types', () => {
    expect(isUserActivatableSkill(skill('agent', 'agent'))).toBe(false);
  });

  it('builds slash commands and command map entries with skill prefixes for non-built-in skills', () => {
    const built = buildSkillSlashCommands([
      skill('review', 'prompt'),
      skill('nested-review', 'prompt', {
        description: 'Nested review skill',
        argumentHint: '<target>',
        path: '/skills/parent/nested-review/SKILL.md',
      }),
      skill('agent-only', 'agent'),
      skill('commit', 'flow'),
    ]);

    expect(built.commands.map((command) => command.name)).toEqual([
      'skill:commit',
      'skill:nested-review',
      'skill:review',
    ]);
    expect(built.commands[0]).toMatchObject({
      name: 'skill:commit',
      aliases: [],
      description: 'commit skill',
    });
    expect(built.commands[1]).toMatchObject({
      name: 'skill:nested-review',
      aliases: [],
      description: 'Nested review skill',
      argumentHint: '<target>',
    });
    expect([...built.commandMap.entries()]).toEqual([
      ['skill:commit', 'commit'],
      ['skill:nested-review', 'nested-review'],
      ['skill:review', 'review'],
    ]);
  });

  it('sorts built-in skill slash commands before external skill commands', () => {
    const built = buildSkillSlashCommands([
      skill('zeta', 'prompt', { source: 'user' }),
      skill('alpha', 'prompt', { source: 'project' }),
      skill('update-config', 'inline', { source: 'builtin' }),
      skill('mcp-config', 'inline', { source: 'builtin' }),
    ]);

    expect(built.commands.map((command) => command.name)).toEqual([
      'mcp-config',
      'update-config',
      'skill:alpha',
      'skill:zeta',
    ]);
    expect([...built.commandMap.entries()]).toEqual([
      ['mcp-config', 'mcp-config'],
      ['update-config', 'update-config'],
      ['skill:alpha', 'alpha'],
      ['skill:zeta', 'zeta'],
    ]);
  });

  it('keeps disableModelInvocation skills slash-invocable', () => {
    const built = buildSkillSlashCommands([
      skill('mcp-config', 'inline', { disableModelInvocation: true, source: 'builtin' }),
    ]);

    expect(built.commands.map((command) => command.name)).toEqual(['mcp-config']);
    expect(built.commandMap.get('mcp-config')).toBe('mcp-config');
  });

  it('hides skills that disable user invocation', async () => {
    const hidden = skill('model-only', 'prompt', {
      userInvocable: false,
      source: 'project',
    });
    const built = buildSkillSlashCommands([hidden]);
    const showNotice = vi.fn();
    const host = {
      session: { listSkills: vi.fn(async () => [hidden]) },
      showNotice,
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleSkillsCommand(host, '');

    expect(built.commands).toEqual([]);
    expect(showNotice).toHaveBeenCalledWith(
      'No skills found',
      'Create skills in .pythinker-code/skills or ~/.pythinker-code/skills.',
    );
  });

  it('keeps sub-skills slash-invocable', () => {
    const built = buildSkillSlashCommands([
      skill('outer.inner', 'prompt', {
        isSubSkill: true,
        source: 'project',
      }),
    ]);

    expect(built.commands.map((command) => command.name)).toEqual(['outer.inner']);
    expect(built.commandMap.get('outer.inner')).toBe('outer.inner');
  });

  it('uses a skill-provided command name for dynamic MCP prompts', () => {
    const built = buildSkillSlashCommands([
      skill('mcp__github__review', 'prompt', {
        source: 'extra',
        commandName: 'mcp__github__review',
      }),
    ]);

    expect(built.commands.map((command) => command.name)).toEqual([
      'mcp__github__review',
    ]);
    expect(built.commandMap.get('mcp__github__review')).toBe('mcp__github__review');
  });

  it('renders the discovered user-activatable skills through the TUI', async () => {
    const showNotice = vi.fn();
    const host = {
      session: {
        listSkills: vi.fn(async () => [
          skill('review', 'prompt', { source: 'project' }),
          skill('agent-only', 'agent', { source: 'project' }),
          skill('commit', 'flow', { source: 'user' }),
        ]),
      },
      showNotice,
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleSkillsCommand(host, '');

    expect(showNotice).toHaveBeenCalledWith(
      'Skills (2)',
      '/review · project · review skill\n/commit · user · commit skill',
    );
  });
});

describe('agent profile slash command', () => {
  it('opens a searchable catalog of resolved profiles', async () => {
    const mountEditorReplacement = vi.fn();
    const host = {
      state: { appState: { workDir: '/workspace' } },
      harness: {
        listAgentProfiles: vi.fn(async () => ({
          profiles: [
            {
              name: 'coder',
              description: 'Implement changes',
              source: 'built-in',
              tools: ['Read', 'Edit'],
              background: false,
              subagents: [],
            },
            {
              name: 'reviewer',
              description: 'Review changes',
              source: 'project',
              tools: ['Read', 'Grep'],
              background: true,
              subagents: [],
            },
          ],
          warnings: [],
        })),
      },
      mountEditorReplacement,
      restoreEditor: vi.fn(),
      showNotice: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleAgentsCommand(host, '');

    expect(mountEditorReplacement).toHaveBeenCalledOnce();
    const picker = mountEditorReplacement.mock.calls[0]?.[0] as {
      render(width: number): string[];
    };
    const rendered = picker.render(120).join('\n');
    expect(rendered).toContain('Agent profiles');
    expect(rendered).toContain('coder');
    expect(rendered).toContain('reviewer');
    expect(rendered).toContain('project · background');
  });
});
