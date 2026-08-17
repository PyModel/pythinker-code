import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SessionSkillRegistry, registerBuiltinSkills } from '../../src/skill';
import type { SkillDefinition, SkillSource } from '../../src/skill';

describe('skill registry prompt rendering', () => {
  it('registers the built-in loop workflow with recurring-task guidance', () => {
    const registry = new SessionSkillRegistry();

    registerBuiltinSkills(registry);

    const loop = registry.getSkill('loop');
    expect(loop?.metadata.argumentHint).toBe('[interval] <prompt>');
    expect(loop?.content).toContain('CronCreate');
    expect(loop?.content).toContain('CronDelete');
    expect(loop?.content).toContain('immediately execute');
  });

  it('groups skills by scope under canonical section headings', () => {
    const registry = makeRegistry([
      makeSkill('builtin-a', 'builtin'),
      makeSkill('user-a', 'user'),
      makeSkill('proj-a', 'project'),
      makeSkill('extra-a', 'extra'),
    ]);

    const rendered = registry.getPythinkerSkillsDescription();

    expect(rendered).toContain('### Project');
    expect(rendered).toContain('### User');
    expect(rendered).toContain('### Extra');
    expect(rendered).toContain('### Built-in');

    const projectIdx = rendered.indexOf('### Project');
    const userIdx = rendered.indexOf('### User');
    const extraIdx = rendered.indexOf('### Extra');
    const builtinIdx = rendered.indexOf('### Built-in');
    expect(projectIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(extraIdx);
    expect(extraIdx).toBeLessThan(builtinIdx);

    expect(sectionFor(rendered, '### Project')).toContain('proj-a');
    expect(sectionFor(rendered, '### User')).toContain('user-a');
    expect(sectionFor(rendered, '### Extra')).toContain('extra-a');
    expect(sectionFor(rendered, '### Built-in')).toContain('builtin-a');
    expect(sectionFor(rendered, '### Project')).not.toContain('user-a');
    expect(sectionFor(rendered, '### User')).not.toContain('proj-a');
  });

  it('omits scope headings that have no skills', () => {
    const registry = makeRegistry([makeSkill('alpha', 'user')]);

    const rendered = registry.getPythinkerSkillsDescription();

    expect(rendered).toContain('### User');
    expect(rendered).not.toContain('### Project');
    expect(rendered).not.toContain('### Extra');
    expect(rendered).not.toContain('### Built-in');
  });

  it('renders a "No skills" placeholder for an empty registry', () => {
    const registry = new SessionSkillRegistry();

    const rendered = registry.getPythinkerSkillsDescription();

    expect(rendered.trim()).not.toBe('');
    expect(/no skills/i.test(rendered)).toBe(true);
  });

  it('sorts skills alphabetically within a scope', () => {
    const registry = makeRegistry([
      makeSkill('zebra', 'user'),
      makeSkill('alpha', 'user'),
      makeSkill('mango', 'user'),
    ]);

    const rendered = registry.getPythinkerSkillsDescription();

    const a = rendered.indexOf('alpha');
    const m = rendered.indexOf('mango');
    const z = rendered.indexOf('zebra');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(m);
    expect(m).toBeLessThan(z);
  });

  it('keeps non-user-invocable skills available to the model', () => {
    const modelOnly = makeSkill('model-only', 'project');
    const registry = makeRegistry([
      {
        ...modelOnly,
        metadata: { ...modelOnly.metadata, userInvocable: false },
      },
    ]);

    expect(registry.listInvocableSkills().map((skill) => skill.name)).toContain('model-only');
  });

  it('activates a conditional skill after a matching project path is touched', () => {
    const conditional = makeSkill('typescript-only', 'project');
    const registry = makeRegistry([
      {
        ...conditional,
        metadata: {
          ...conditional.metadata,
          paths: 'src/*.{ts,tsx}, !src/generated/**',
        },
      },
    ]);

    expect(registry.getSkill('typescript-only')).toBeUndefined();
    expect(registry.activateForPaths(['/workspace/src/generated/types.ts'], '/workspace')).toEqual(
      [],
    );

    const activated = registry.activateForPaths(['/workspace/src/main.ts'], '/workspace');

    expect(activated.map((skill) => skill.name)).toEqual(['typescript-only']);
    expect(registry.getSkill('typescript-only')?.name).toBe('typescript-only');
  });

  it('does not load nested skills from a Git-ignored project directory', async () => {
    const root = await mkdtemp(join(process.cwd(), '.ignored-nested-skill-'));
    try {
      const owner = join(root, 'generated');
      const filePath = join(owner, 'main.ts');
      const skillDir = join(owner, '.pythinker-code', 'skills', 'ignored');
      await mkdir(skillDir, { recursive: true });
      await writeFile(filePath, 'generated\n', 'utf8');
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: ignored\ndescription: Ignored\n---\nIgnored.\n',
        'utf8',
      );
      const registry = new SessionSkillRegistry({
        isPathIgnored: async (candidate) => candidate === owner,
      });

      await registry.loadNestedForPaths([filePath], root);

      expect(registry.getSkill('ignored')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('end-to-end: a project skill that shadows other scopes renders once under Project', () => {
    const registry = makeRegistry([makeSkill('foo', 'project', 'project version', '/tmp/proj/foo/SKILL.md')]);

    const rendered = registry.getPythinkerSkillsDescription();

    expect(rendered.match(/\n- foo\n/g) ?? []).toHaveLength(1);
    expect(sectionFor(rendered, '### Project')).toContain('foo');
    expect(rendered).toContain('/tmp/proj/foo/SKILL.md');
    expect(rendered).toContain('project version');
  });

  it('renders each skill as name + Path + Description', () => {
    const registry = makeRegistry([
      makeSkill('alpha', 'user', 'Alpha does things', '/tmp/user/alpha/SKILL.md'),
    ]);

    const rendered = registry.getPythinkerSkillsDescription();

    expect(rendered).toContain('- alpha');
    expect(rendered).toContain('  - Path: /tmp/user/alpha/SKILL.md');
    expect(rendered).toContain('  - Description: Alpha does things');
  });
});

describe('disabled skills', () => {
  it('never registers a skill the user turned off', () => {
    const registry = new SessionSkillRegistry({ disabledNames: ['user-a'] });

    registry.register(makeSkill('user-a', 'user'));
    registry.register(makeSkill('user-b', 'user'));

    expect(registry.getSkill('user-a')).toBeUndefined();
    expect(registry.getSkill('user-b')).toBeDefined();
  });

  it('matches the disabled name regardless of case', () => {
    const registry = new SessionSkillRegistry({ disabledNames: ['Gen-Changesets'] });

    registry.register(makeSkill('gen-changesets', 'project'));

    expect(registry.getSkill('gen-changesets')).toBeUndefined();
  });

  it('disables built-in skills too', () => {
    const registry = new SessionSkillRegistry({ disabledNames: ['loop'] });

    registerBuiltinSkills(registry);

    expect(registry.getSkill('loop')).toBeUndefined();
  });

  it('never indexes a disabled plugin skill discovered from a root', async () => {
    // Discovery indexes plugin skills before `register` runs, so a disabled one
    // stays reachable through `getPluginSkill` unless the check repeats there.
    const disabled = { ...makeSkill('deploy', 'extra'), plugin: { id: 'acme' } };
    const kept = { ...makeSkill('rollback', 'extra'), plugin: { id: 'acme' } };
    const registry = new SessionSkillRegistry({
      disabledNames: ['Deploy'],
      discover: async (options) => {
        options.onDiscoveredSkill?.(disabled);
        options.onDiscoveredSkill?.(kept);
        return [disabled, kept];
      },
    });

    await registry.loadRoots([{ path: '/tmp/plugins', source: 'extra' }]);

    expect(registry.getPluginSkill('acme', 'deploy')).toBeUndefined();
    expect(registry.getSkill('deploy')).toBeUndefined();
    expect(registry.getPluginSkill('acme', 'rollback')).toBeDefined();
  });
});

function makeRegistry(skills: readonly SkillDefinition[]): SessionSkillRegistry {
  const registry = new SessionSkillRegistry();
  for (const skill of skills) registry.register(skill);
  return registry;
}

function makeSkill(
  name: string,
  source: SkillSource,
  description = 'desc',
  skillPath?: string,
): SkillDefinition {
  const finalPath = skillPath ?? `/tmp/${source}/${name}/SKILL.md`;
  return {
    name,
    description,
    path: finalPath,
    dir: finalPath.replace(/\/SKILL\.md$/, ''),
    content: '',
    metadata: { type: 'prompt' },
    source,
  };
}

function sectionFor(rendered: string, header: string): string {
  const start = rendered.indexOf(header);
  if (start === -1) return '';
  const next = rendered.indexOf('### ', start + header.length);
  return next === -1 ? rendered.slice(start) : rendered.slice(start, next);
}
