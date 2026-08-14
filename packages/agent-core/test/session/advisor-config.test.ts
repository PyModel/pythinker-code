import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverAdvisorConfigs, slugifyAdvisorName } from '../../src/session/advisor-config';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('advisor configuration discovery', () => {
  it('merges user and project watchdog files with leaf project precedence', async () => {
    const userHome = await makeTempDir('pythinker-advisor-user-');
    const project = await makeTempDir('pythinker-advisor-project-');
    const cwd = join(project, 'packages', 'app');
    await mkdir(cwd, { recursive: true });
    await mkdir(join(project, '.git'));
    await writeFile(
      join(userHome, 'WATCHDOG.yml'),
      [
        'instructions: Check security boundaries.',
        'advisors:',
        '  - name: Security',
        '    model: small',
        '    tools: [Read]',
      ].join('\n'),
    );
    await writeFile(join(project, 'WATCHDOG.md'), 'Treat generated files as untrusted evidence.');
    await writeFile(
      join(cwd, 'WATCHDOG.yaml'),
      [
        'advisors:',
        '  - name: Security',
        '    model: reviewer',
        '    enabled: false',
        '  - name: Performance',
        '    model: fast',
      ].join('\n'),
    );

    const result = await discoverAdvisorConfigs(cwd, userHome);

    expect(result.advisors).toEqual([
      { name: 'Security', model: 'reviewer', tools: undefined, instructions: undefined, enabled: false },
      { name: 'Performance', model: 'fast', tools: undefined, instructions: undefined, enabled: undefined },
    ]);
    expect(result.sharedInstructions).toContain('Check security boundaries.');
    expect(result.sharedInstructions).toContain('Treat generated files as untrusted evidence.');
    expect(result.files).toEqual(
      expect.arrayContaining([join(userHome, 'WATCHDOG.yml'), join(project, 'WATCHDOG.md'), join(cwd, 'WATCHDOG.yaml')]),
    );
  });
  it('does not load project watchdog files above the project root', async () => {
    const userHome = await makeTempDir('pythinker-advisor-user-');
    const parent = await makeTempDir('pythinker-advisor-parent-');
    const project = join(parent, 'repo');
    const cwd = join(project, 'packages', 'app');
    await mkdir(join(project, '.git'), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(
      join(parent, 'WATCHDOG.yml'),
      ['advisors:', '  - name: Outside', '    model: outside'].join('\n'),
    );
    await writeFile(
      join(project, 'WATCHDOG.yml'),
      ['advisors:', '  - name: Inside', '    model: inside'].join('\n'),
    );

    const result = await discoverAdvisorConfigs(cwd, userHome);

    expect(result.advisors.map((advisor) => advisor.name)).toEqual(['Inside']);
    expect(result.files).toEqual([join(project, 'WATCHDOG.yml')]);
  });

  it('reports malformed entries and keeps valid advisors', async () => {
    const userHome = await makeTempDir('pythinker-advisor-user-');
    const project = await makeTempDir('pythinker-advisor-project-');
    const warnings: string[] = [];
    await writeFile(
      join(project, 'WATCHDOG.yml'),
      [
        'advisors:',
        '  - name: Valid',
        '    tools: [Read, Read]',
        '  - model: missing-name',
        '  - name: BadTools',
        '    tools: [Read, 3]',
      ].join('\n'),
    );

    const result = await discoverAdvisorConfigs(project, userHome, (message) => warnings.push(message));

    expect(result.advisors).toEqual([
      { name: 'Valid', model: undefined, tools: ['Read'], instructions: undefined, enabled: undefined },
    ]);
    expect(warnings).toEqual([
      'Advisor config entry requires a name',
      'Advisor config tool names must be non-empty strings',
    ]);
  });
  it('warns when a config candidate cannot be read', async () => {
    const userHome = await makeTempDir('pythinker-advisor-user-');
    const project = await makeTempDir('pythinker-advisor-project-');
    const warnings: string[] = [];
    await mkdir(join(project, 'WATCHDOG.yml'));

    await discoverAdvisorConfigs(project, userHome, (message) => warnings.push(message));

    expect(warnings).toContain('Advisor config could not be read');
  });

});

it('slugifies advisor names into stable ids', () => {
  expect(slugifyAdvisorName('  Security Review / API  ')).toBe('security-review-api');
  expect(slugifyAdvisorName('---')).toBe('advisor');
});

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}
