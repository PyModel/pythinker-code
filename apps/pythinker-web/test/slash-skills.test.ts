import { describe, expect, it } from 'vitest';
import { SLASH_COMMANDS, buildSlashItems, filterCommands } from '../src/lib/slashCommands';

const skills = [
  { name: 'brainstorm', description: 'Turn an idea into a design' },
  { name: 'deep-research', description: 'Fan-out web research' },
];

describe('slash menu with session skills', () => {
  it('appends skills as /<name> after the built-in commands', () => {
    const items = buildSlashItems(skills);
    expect(items.length).toBe(SLASH_COMMANDS.length + skills.length);
    const brainstorm = items.find((i) => i.name === '/brainstorm');
    expect(brainstorm).toMatchObject({
      name: '/brainstorm',
      desc: 'Turn an idea into a design',
      isSkill: true,
    });
  });

  it('built-in commands are not flagged as skills', () => {
    const help = buildSlashItems(skills).find((i) => i.name === '/help');
    expect(help?.isSkill).toBeUndefined();
  });

  it('filters built-ins and skills together by substring', () => {
    const items = buildSlashItems(skills);
    const research = filterCommands('/deep', items);
    expect(research.map((i) => i.name)).toEqual(['/deep-research']);
  });

  it('matching a skill substring excludes unrelated built-ins', () => {
    const items = buildSlashItems(skills);
    const brain = filterCommands('/brain', items);
    expect(brain.every((i) => i.isSkill)).toBe(true);
    expect(brain.map((i) => i.name)).toContain('/brainstorm');
  });

  it('empty/slash query returns everything', () => {
    const items = buildSlashItems(skills);
    expect(filterCommands('/', items).length).toBe(items.length);
  });
});
