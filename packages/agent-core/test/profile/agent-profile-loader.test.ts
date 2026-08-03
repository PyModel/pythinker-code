import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_PROFILES,
  loadAgentProfilesFromDirectories,
  loadAgentProfilesFromDir,
  loadAgentProfilesFromSources,
  loadPluginAgentProfiles,
  resolveAgentProfiles,
  type SystemPromptContext,
} from '../../src/profile';
import { SessionSkillRegistry, type SkillDefinition } from '../../src/skill';

let workDir: string;

const promptContext: SystemPromptContext = {
  osEnv: {
    osKind: 'macOS',
    osArch: 'arm64',
    osVersion: '0',
    shellName: 'bash',
    shellPath: '/bin/bash',
  },
  cwd: '/workspace',
  now: '2026-05-09T00:00:00.000Z',
  cwdListing: 'README.md',
  agentsMd: 'Project instructions.',
  skills: 'Available test skills.',
};

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'pythinker-agent-profile-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('agent profile loader', () => {
  it('loads YAML profiles, inherits templates, and renders with runtime context', async () => {
    const systemPath = await write(
      'system.md',
      [
        'os={{ PYTHINKER_OS }}',
        'cwd={{ PYTHINKER_WORK_DIR }}',
        'listing={{ PYTHINKER_WORK_DIR_LS }}',
        'agents={{ PYTHINKER_AGENTS_MD }}',
        'skills={{ PYTHINKER_SKILLS }}',
        'parent={{ parentOnly }}',
        'child={{ childOnly }}',
        'role={{ ROLE_ADDITIONAL }}',
        '{% if PYTHINKER_OS == "macOS" %}nunjucks-ok{% endif %}',
      ].join('\n'),
    );
    await write(
      'agent.yaml',
      `
name: agent
description: Parent agent
systemPromptPath: ./${fileName(systemPath)}
promptVars:
  parentOnly: parent-value
  roleAdditional: parent-role
tools:
  - Read
  - Write
skills:
  - code-review
hooks:
  Stop:
    - hooks:
        - type: command
          command: echo verify
disallowedTools:
  - Write
model: fast-model
effort: medium
permissionMode: manual
initialPrompt: Check the repository instructions first.
background: true
maxTurns: 12
memory: project
subagents:
  shared:
    description: Shared parent subagent
  coder:
    description: Coder child subagent
`,
    );
    await write(
      'coder.yaml',
      `
extends: agent
name: coder
promptVars:
  childOnly: child-value
  roleAdditional: child-role
tools:
  - Bash
`,
    );
    await write(
      'shared.yaml',
      `
name: shared
systemPromptTemplate: shared prompt
tools:
  - Read
`,
    );

    const profiles = await loadAgentProfilesFromDir([
      join(workDir, 'agent.yaml'),
      join(workDir, 'coder.yaml'),
      join(workDir, 'shared.yaml'),
      join(workDir, 'missing.yaml'),
    ]);
    const coderPrompt = profiles['coder']?.systemPrompt(promptContext);

    expect(profiles['coder']?.description).toBe('Coder child subagent');
    expect(profiles['coder']?.tools).toEqual(['Bash']);
    expect(profiles['agent']).toMatchObject({
      tools: ['Read'],
      skills: ['code-review'],
      hooks: [
        expect.objectContaining({
          event: 'Stop',
          command: 'echo verify',
        }),
      ],
      model: 'fast-model',
      effort: 'medium',
      permissionMode: 'manual',
      initialPrompt: 'Check the repository instructions first.',
      background: true,
      maxTurns: 12,
      memory: 'project',
    });
    expect(profiles['coder']?.maxTurns).toBe(12);
    expect(profiles['coder']?.memory).toBe('project');
    expect(profiles['coder']?.skills).toEqual(['code-review']);
    expect(profiles['coder']?.hooks).toEqual(profiles['agent']?.hooks);
    expect(profiles['agent']?.subagents?.['shared']).toBe(profiles['shared']);
    expect(profiles['agent']?.subagents?.['coder']).toBe(profiles['coder']);
    expect(profiles['coder']?.subagents).toBeUndefined();
    expect(profiles['shared']?.description).toBe('Shared parent subagent');
    expect(coderPrompt).toContain('os=macOS');
    expect(coderPrompt).toContain('cwd=/workspace');
    expect(coderPrompt).toContain('listing=README.md');
    expect(coderPrompt).toContain('agents=Project instructions.');
    expect(coderPrompt).toContain('skills=Available test skills.');
    expect(coderPrompt).toContain('parent=parent-value');
    expect(coderPrompt).toContain('child=child-value');
    expect(coderPrompt).toContain('role=child-role');
    expect(coderPrompt).toContain('nunjucks-ok');
    expect(coderPrompt).not.toContain('{{ ROLE_ADDITIONAL }}');
  });

  it('reports invalid profile graphs without relying on loader internals', () => {
    expect(() =>
      resolveAgentProfiles([
        {
          name: 'agent',
          subagents: {
            missing: { description: 'Missing subagent' },
          },
        },
      ]),
    ).toThrow(/declares subagent "missing"/);

    expect(() => resolveAgentProfiles([{ name: 'agent' }, { name: 'agent' }])).toThrow(
      /Duplicate agent profile name: "agent"/,
    );

    expect(() =>
      resolveAgentProfiles([
        { name: 'agent', extends: 'coder' },
        { name: 'coder', extends: 'agent' },
      ]),
    ).toThrow(/agent -> coder -> agent/);
  });

  it('fails loudly when an embedded system prompt source is missing', () => {
    expect(() =>
      loadAgentProfilesFromSources(['profile/default/agent.yaml'], {
        'profile/default/agent.yaml': 'name: agent\nsystemPromptPath: ./missing.md\n',
      }),
    ).toThrow(/Embedded agent profile source missing: profile\/default\/missing\.md/);
  });

  it('discovers YAML profiles with later directory precedence', async () => {
    const userDir = join(workDir, 'user-agents');
    const projectDir = join(workDir, 'project-agents');
    await mkdir(userDir);
    await mkdir(projectDir);
    await writeFile(
      join(userDir, 'review.yaml'),
      'name: review\ndescription: User review\nsystemPromptTemplate: user prompt\ntools: [Read]\n',
      'utf-8',
    );
    await writeFile(
      join(projectDir, 'review.yml'),
      'name: review\ndescription: Project review\nsystemPromptTemplate: project prompt\ntools: [Read, Grep]\n',
      'utf-8',
    );

    const result = await loadAgentProfilesFromDirectories([userDir, projectDir]);

    expect(result.failures).toEqual([]);
    expect(result.profiles['review']?.description).toBe('Project review');
    expect(result.profiles['review']?.tools).toEqual(['Read', 'Grep']);
  });

  it('loads namespaced Markdown profiles from a plugin without permission escalation', async () => {
    const pluginRoot = join(workDir, 'plugin');
    const agentsDir = join(pluginRoot, 'agents', 'nested');
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, 'review.md'),
      [
        '---',
        'name: review',
        'description: Review plugin changes.',
        "tools: [Read, Grep, 'Bash(git status)', Write]",
        'disallowedTools: [Write]',
        'model: inherit',
        'effort: medium',
        'background: true',
        'maxTurns: 4',
        'isolation: worktree',
        'memory: local',
        'permissionMode: yolo',
        '---',
        'Plugin root: ${PYTHINKER_PLUGIN_ROOT}',
      ].join('\n'),
      'utf8',
    );

    const result = await loadPluginAgentProfiles([
      {
        pluginId: 'demo',
        pluginRoot,
        paths: [join(pluginRoot, 'agents')],
      },
    ]);
    const profile = result.profiles['demo:nested:review'];

    expect(result.failures).toEqual([]);
    expect(profile).toMatchObject({
      name: 'demo:nested:review',
      description: 'Review plugin changes.',
      tools: ['Read', 'Grep', 'Bash(git status)'],
      effort: 'medium',
      background: true,
      maxTurns: 4,
      isolation: 'worktree',
      memory: 'local',
    });
    expect(profile?.model).toBeUndefined();
    expect(profile?.permissionMode).toBeUndefined();
    expect(profile?.systemPrompt(promptContext)).toContain(`Plugin root: ${pluginRoot}`);
  });
});

describe('default agent profiles', () => {
  it('links bundled subagents and keeps role-specific tool sets observable', () => {
    expect(DEFAULT_AGENT_PROFILES['agent']?.subagents?.['coder']).toBe(
      DEFAULT_AGENT_PROFILES['coder'],
    );
    expect(DEFAULT_AGENT_PROFILES['agent']?.subagents?.['explore']).toBe(
      DEFAULT_AGENT_PROFILES['explore'],
    );
    expect(DEFAULT_AGENT_PROFILES['agent']?.subagents?.['plan']).toBe(
      DEFAULT_AGENT_PROFILES['plan'],
    );

    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toEqual(
      expect.arrayContaining([
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Agent',
        'Skill',
        'TaskList',
        'TaskOutput',
        'TaskStop',
      ]),
    );
    expect(DEFAULT_AGENT_PROFILES['coder']?.tools).toEqual(
      expect.arrayContaining(['Read', 'Write', 'Edit', 'Bash']),
    );
    expect(DEFAULT_AGENT_PROFILES['explore']?.tools).not.toContain('Write');
    expect(DEFAULT_AGENT_PROFILES['plan']?.tools).not.toContain('Bash');
  });

  it('renders the model-invocable skill listing for bundled prompts', () => {
    const skills = new SessionSkillRegistry();
    skills.register(skill('review', { whenToUse: 'When code review is requested.' }));
    skills.register({
      ...skill('nested-review', {
        isSubSkill: true,
        whenToUse: 'When nested review is requested.',
      }),
      path: '/skills/parent/nested-review/SKILL.md',
      dir: '/skills/parent/nested-review',
      content: 'Nested review body must not enter system prompt.',
    });
    skills.register(skill('private', { disableModelInvocation: true }));
    skills.register(skill('flow-only', { type: 'flow' }));

    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt({
      ...promptContext,
      skills,
    });

    expect(prompt).toContain('Current available skills:');
    expect(prompt).toContain('- review:');
    expect(prompt).toContain('When to use: When code review is requested.');
    expect(prompt).not.toContain('- nested-review:');
    expect(prompt).not.toContain('Path: /skills/parent/nested-review/SKILL.md');
    expect(prompt).not.toContain('When to use: When nested review is requested.');
    expect(prompt).not.toContain('private');
    expect(prompt).not.toContain('flow-only');
    expect(prompt).not.toContain('body of review');
    expect(prompt).not.toContain('Nested review body must not enter system prompt.');
  });

  it('renders the bundled default prompt from the current runtime context', () => {
    const first = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt({
      ...promptContext,
      cwd: '/workspace/one',
    });
    const second = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt({
      ...promptContext,
      cwd: '/workspace/two',
    });

    expect(first).toContain('You are Pythinker Code CLI');
    expect(first).toContain('Available skills');
    expect(first).toContain('/workspace/one');
    expect(second).toContain('/workspace/two');
    expect(second).not.toContain('/workspace/one');
  });
});

async function write(fileName: string, content: string): Promise<string> {
  const filePath = join(workDir, fileName);
  await writeFile(filePath, content.trimStart(), 'utf-8');
  return filePath;
}

function fileName(filePath: string): string {
  return filePath.slice(workDir.length + 1);
}

function skill(name: string, metadata: SkillDefinition['metadata'] = {}): SkillDefinition {
  return {
    name,
    description: `desc for ${name}`,
    path: `/skills/${name}/SKILL.md`,
    dir: `/skills/${name}`,
    content: `body of ${name}`,
    metadata,
    source: 'user',
  };
}
