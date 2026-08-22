import { describe, expect, it } from 'vitest';

import { CHECK_PYTHINKER_CODE_DOCS_SKILL, SessionSkillRegistry, UPDATE_CONFIG_SKILL, registerBuiltinSkills } from '../../src/skill';

describe('builtin skill: update-config', () => {
  it('has the expected identity and inline metadata', () => {
    expect(UPDATE_CONFIG_SKILL.name).toBe('update-config');
    expect(UPDATE_CONFIG_SKILL.source).toBe('builtin');
    expect(UPDATE_CONFIG_SKILL.description.length).toBeGreaterThan(0);
    expect(UPDATE_CONFIG_SKILL.metadata.type).toBe('inline');
  });

  it('is model-invocable (does not disable model invocation)', () => {
    expect(UPDATE_CONFIG_SKILL.metadata.disableModelInvocation).not.toBe(true);
  });

  it('pins the doc URL as the single source of truth and references TOML / FetchURL / /reload', () => {
    const content = UPDATE_CONFIG_SKILL.content;
    expect(content).toContain('config-files.html');
    expect(content).toContain('FetchURL');
    expect(content).toContain('/reload');
    expect(content.toLowerCase()).toContain('toml');
  });

  it('registers through registerBuiltinSkills and shows up as model-invocable', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    expect(registry.getSkill('update-config')).toBeDefined();
    expect(
      registry.listInvocableSkills().some((skill) => skill.name === 'update-config'),
    ).toBe(true);
  });
});

describe('builtin skill: check-pythinker-code-docs', () => {
  it('has the expected identity and inline metadata', () => {
    expect(CHECK_PYTHINKER_CODE_DOCS_SKILL.name).toBe('check-pythinker-code-docs');
    expect(CHECK_PYTHINKER_CODE_DOCS_SKILL.source).toBe('builtin');
    expect(CHECK_PYTHINKER_CODE_DOCS_SKILL.description.length).toBeGreaterThan(0);
    expect(CHECK_PYTHINKER_CODE_DOCS_SKILL.metadata.type).toBe('inline');
  });

  it('is model-invocable (does not disable model invocation)', () => {
    expect(CHECK_PYTHINKER_CODE_DOCS_SKILL.metadata.disableModelInvocation).not.toBe(true);
  });

  it('pins the official docs site and the module routing list', () => {
    const content = CHECK_PYTHINKER_CODE_DOCS_SKILL.content;
    expect(content).toContain('https://github.com/PyModel/pythinker-code/tree/main/docs/en');
    expect(content).toContain('pythinker-code-cli/configuration/');
    expect(content).toContain('pythinker-code-cli/customization/');
    expect(content).toContain('pythinker-code/membership.html');
    expect(content).toContain('pythinker-code/error-reference.html');
    expect(content).toContain('FetchURL');
  });

  it('registers through registerBuiltinSkills and shows up as model-invocable', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    expect(registry.getSkill('check-pythinker-code-docs')).toBeDefined();
    expect(
      registry.listInvocableSkills().some((skill) => skill.name === 'check-pythinker-code-docs'),
    ).toBe(true);
  });
});
