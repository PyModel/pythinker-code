import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_OUTPUT_STYLES,
  loadOutputStyles,
  resolveOutputStyle,
} from '../../src/profile/output-style';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('output styles', () => {
  it('loads built-in, plugin, user, and project styles with project precedence', async () => {
    const root = await temporaryDirectory();
    const brandHome = join(root, 'home');
    const workDir = join(root, 'project');
    const pluginRoot = join(root, 'plugin');
    await writeStyle(
      join(brandHome, 'output-styles', 'concise.md'),
      'name: concise\ndescription: User concise',
      'Use short user answers.',
    );
    await writeStyle(
      join(workDir, '.pythinker-code', 'output-styles', 'concise.md'),
      'name: concise\ndescription: Project concise\nkeep-coding-instructions: true',
      'Use short project answers.',
    );
    await writeStyle(
      join(pluginRoot, 'output-styles', 'review.md'),
      'name: review\ndescription: Review mode\nforce-for-plugin: true',
      'Review every change.',
    );

    const result = await loadOutputStyles({
      brandHome,
      workDir,
      pluginSources: [
        {
          pluginId: 'quality',
          pluginRoot,
          paths: [join(pluginRoot, 'output-styles')],
        },
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.styles['default']).toBeNull();
    expect(result.styles['Explanatory']).toEqual(BUILTIN_OUTPUT_STYLES['Explanatory']);
    expect(result.styles['concise']).toMatchObject({
      source: 'project',
      prompt: 'Use short project answers.',
      keepCodingInstructions: true,
    });
    expect(result.styles['quality:review']).toMatchObject({
      source: 'plugin',
      forceForPlugin: true,
    });
  });

  it('selects a forced plugin style before configured and default styles', () => {
    const configured = {
      name: 'configured',
      description: 'Configured',
      prompt: 'Configured prompt',
      source: 'user' as const,
    };
    const styles = {
      default: null,
      configured,
      'plugin:forced': {
        name: 'plugin:forced',
        description: 'Forced',
        prompt: 'Forced prompt',
        source: 'plugin' as const,
        forceForPlugin: true,
      },
    };

    expect(resolveOutputStyle(styles, 'configured')?.name).toBe('plugin:forced');
    expect(resolveOutputStyle({ default: null, configured }, 'configured')).toBe(configured);
    expect(resolveOutputStyle({ default: null }, 'missing')).toBeNull();
  });

  it('loads nested styles from the Git root through the working directory', async () => {
    const root = await temporaryDirectory();
    const projectRoot = join(root, 'project');
    const workDir = join(projectRoot, 'packages', 'app');
    const pluginRoot = join(root, 'plugin');
    await mkdir(join(projectRoot, '.git'), { recursive: true });
    await writeStyle(
      join(projectRoot, '.pythinker-code', 'output-styles', 'root.md'),
      '',
      '# Root style',
    );
    await writeStyle(
      join(workDir, '.pythinker-code', 'output-styles', 'nested', 'root.md'),
      '',
      'Use the nearest project style.',
    );
    await writeStyle(
      join(pluginRoot, 'output-styles', 'nested', 'review.md'),
      'description: Nested plugin style',
      'Review nested files.',
    );

    const result = await loadOutputStyles({
      brandHome: join(root, 'home'),
      workDir,
      pluginSources: [
        {
          pluginId: 'quality',
          pluginRoot,
          paths: [join(pluginRoot, 'output-styles')],
        },
      ],
    });

    expect(result.failures).toEqual([]);
    expect(result.styles['root']).toMatchObject({
      source: 'project',
      description: 'Use the nearest project style.',
    });
    expect(result.styles['quality:review']).toMatchObject({
      source: 'plugin',
      prompt: 'Review nested files.',
    });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pythinker-output-style-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeStyle(path: string, frontmatter: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
}
