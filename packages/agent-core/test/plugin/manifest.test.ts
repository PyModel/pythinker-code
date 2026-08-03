import { mkdtemp, mkdir, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseManifest } from '../../src/plugin/manifest';

async function makePlugin(
  files: Record<string, string>,
  options: { dirs?: readonly string[] } = {},
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'pythinker-plugin-test-'));
  for (const dir of options.dirs ?? []) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), body, 'utf8');
  }
  return realpath(root);
}

describe('parseManifest', () => {
  it('reads a minimal pythinker.plugin.json at the plugin root', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
    });
    const result = await parseManifest(root);
    expect(result.manifest?.name).toBe('demo');
    expect(result.manifest?.version).toBe('1.0.0');
    expect(result.manifestKind).toBe('pythinker-plugin-root');
    expect(result.diagnostics).toEqual([]);
  });

  it('prefers root pythinker.plugin.json when .pythinker-plugin/plugin.json also exists', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'root-version', version: '1.0.0' }),
      '.pythinker-plugin/plugin.json': JSON.stringify({ name: 'dir-version' }),
    });
    const result = await parseManifest(root);
    expect(result.manifestKind).toBe('pythinker-plugin-root');
    expect(result.manifest?.name).toBe('root-version');
    expect(result.shadowedManifestPath).toBe(path.join(root, '.pythinker-plugin/plugin.json'));
  });

  it('falls back to .pythinker-plugin/plugin.json when pythinker.plugin.json is absent', async () => {
    const root = await makePlugin(
      {
        '.pythinker-plugin/plugin.json': JSON.stringify({
          name: 'demo',
          version: '1.0.0',
          keywords: ['workflow'],
          skills: './skills/',
          interface: { displayName: 'Demo' },
          sessionStart: { skill: 'using-demo' },
          skillInstructions: 'Use Pythinker tools.',
        }),
      },
      { dirs: ['skills'] },
    );
    const result = await parseManifest(root);
    expect(result.manifestKind).toBe('pythinker-plugin-dir');
    expect(result.manifestPath).toBe(path.join(root, '.pythinker-plugin/plugin.json'));
    expect(result.manifest?.name).toBe('demo');
    expect(result.manifest?.version).toBe('1.0.0');
    expect(result.manifest?.keywords).toEqual(['workflow']);
    expect(result.manifest?.skills).toEqual([path.join(root, 'skills')]);
    expect(result.manifest?.interface?.displayName).toBe('Demo');
    expect(result.manifest?.sessionStart).toEqual({ skill: 'using-demo' });
    expect(result.manifest?.skillInstructions).toBe('Use Pythinker tools.');
  });

  it('does NOT fall back to .pythinker-plugin/plugin.json when pythinker.plugin.json is invalid JSON', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': '{ not json',
      '.pythinker-plugin/plugin.json': JSON.stringify({ name: 'dir-version' }),
    });
    const result = await parseManifest(root);
    expect(result.manifest).toBeUndefined();
    expect(result.manifestKind).toBe('pythinker-plugin-root');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('Failed to parse'),
      }),
    );
    expect(result.shadowedManifestPath).toBe(path.join(root, '.pythinker-plugin/plugin.json'));
  });

  it('rejects names that violate the regex', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'Bad Name!' }),
    });
    const result = await parseManifest(root);
    expect(result.manifest).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('"name" must match'),
      }),
    );
  });

  it('reports an error when no manifest file exists', async () => {
    const root = await makePlugin({});
    const result = await parseManifest(root);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('No manifest at'),
      }),
    );
  });

  it('resolves a single skills path', async () => {
    const root = await makePlugin(
      { 'pythinker.plugin.json': JSON.stringify({ name: 'demo', skills: './skills/' }) },
      { dirs: ['skills'] },
    );
    const result = await parseManifest(root);
    expect(result.manifest?.skills).toEqual([path.join(root, 'skills')]);
  });

  it('resolves an array of skills paths', async () => {
    const root = await makePlugin(
      {
        'pythinker.plugin.json': JSON.stringify({
          name: 'demo',
          skills: ['./a/', './b/'],
        }),
      },
      { dirs: ['a', 'b'] },
    );
    const result = await parseManifest(root);
    expect(result.manifest?.skills).toEqual([path.join(root, 'a'), path.join(root, 'b')]);
  });

  it('rejects a skills path not prefixed with ./', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo', skills: 'skills/' }),
    });
    const result = await parseManifest(root);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('"skills" path must start with "./"'),
      }),
    );
    expect(result.manifest?.skills).toEqual([]);
  });

  it('rejects a skills path that escapes plugin_root', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo', skills: './../escape' }),
    });
    const result = await parseManifest(root);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('resolves outside the plugin'),
      }),
    );
  });

  it('rejects a skills path that escapes via a symlink', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo', skills: './sym' }),
    });
    const outside = await mkdtemp(path.join(tmpdir(), 'pythinker-plugin-outside-'));
    await symlink(outside, path.join(root, 'sym'));
    const result = await parseManifest(root);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('resolves outside the plugin'),
      }),
    );
  });

  it('warns when skills resolves to a non-directory', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo', skills: './notes.md' }),
      'notes.md': 'hi',
    });
    const result = await parseManifest(root);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('is not a directory'),
      }),
    );
  });

  it('falls back to root SKILL.md when skills field is absent', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo' }),
      'SKILL.md': '---\nname: root-skill\n---\nbody',
    });
    const result = await parseManifest(root);
    expect(result.manifest?.skills).toEqual([root]);
  });

  it('does not fall back to root SKILL.md when skills field is present', async () => {
    const root = await makePlugin(
      {
        'pythinker.plugin.json': JSON.stringify({ name: 'demo', skills: './skills/' }),
        'SKILL.md': '---\nname: root-skill\n---\nbody',
      },
      { dirs: ['skills'] },
    );
    const result = await parseManifest(root);
    expect(result.manifest?.skills).toEqual([path.join(root, 'skills')]);
  });

  it('loads the standard agents directory plus explicit agent files', async () => {
    const root = await makePlugin(
      {
        'pythinker.plugin.json': JSON.stringify({
          name: 'demo',
          agents: './extra-review.md',
        }),
        'agents/review.md': '---\nname: review\n---\nReview code.',
        'extra-review.md': '---\nname: extra\n---\nReview more code.',
      },
      { dirs: ['agents'] },
    );

    const result = await parseManifest(root);

    expect(result.manifest?.agents).toEqual([
      path.join(root, 'agents'),
      path.join(root, 'extra-review.md'),
    ]);
  });

  it('warns and skips agent paths outside the plugin', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({
        name: 'demo',
        agents: './../outside.md',
      }),
    });

    const result = await parseManifest(root);

    expect(result.manifest?.agents).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('"agents" path resolves outside the plugin'),
      }),
    );
  });

  it('loads the standard output-styles directory plus explicit style files', async () => {
    const root = await makePlugin(
      {
        'pythinker.plugin.json': JSON.stringify({
          name: 'demo',
          outputStyles: './extra-style.md',
        }),
        'output-styles/review.md': '---\nname: review\n---\nReview code.',
        'extra-style.md': '---\nname: extra\n---\nUse extra guidance.',
      },
      { dirs: ['output-styles'] },
    );

    const result = await parseManifest(root);

    expect(result.manifest?.outputStyles).toEqual([
      path.join(root, 'output-styles'),
      path.join(root, 'extra-style.md'),
    ]);
  });

  it('emits info diagnostics for unsupported runtime extension fields', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({
        name: 'demo',
        tools: { foo: { description: 'x' } },
        commands: ['x'],
        configFile: 'cfg.json',
        config_file: 'legacy-cfg.json',
        inject: { foo: 'bar' },
        bootstrap: { skill: 'using-demo' },
        hooks: { sessionStart: { skill: 'using-demo' } },
        apps: './apps',
      }),
    });
    const result = await parseManifest(root);
    expect(result.manifest).toEqual(expect.objectContaining({ name: 'demo' }));
    for (const field of [
      'tools',
      'commands',
      'configFile',
      'config_file',
      'inject',
      'bootstrap',
      'hooks',
      'apps',
    ]) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'info',
          message: expect.stringContaining(`"${field}" is present but not supported`),
        }),
      );
    }
  });

  it('parses skillInstructions', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo', skillInstructions: 'Do this.' }),
    });
    const result = await parseManifest(root);
    expect(result.manifest?.skillInstructions).toBe('Do this.');
  });

  it('parses keywords metadata', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo', keywords: ['finance', 'workflow'] }),
    });
    const result = await parseManifest(root);
    expect(result.manifest?.keywords).toEqual(['finance', 'workflow']);
  });

  it('reads sessionStart', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({
        name: 'demo',
        sessionStart: { skill: 'using-demo' },
      }),
    });
    const result = await parseManifest(root);
    expect(result.manifest?.sessionStart).toEqual({ skill: 'using-demo' });
  });

  it('does not read .codex-plugin/plugin.json as a manifest', async () => {
    const root = await makePlugin({
      '.codex-plugin/plugin.json': JSON.stringify({ name: 'demo', skills: './skills/' }),
    });
    const result = await parseManifest(root);
    expect(result.manifest).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('No manifest at'),
      }),
    );
  });

  it('uses strict=false marketplace components for a Claude manifest', async () => {
    const root = await makePlugin(
      {
        '.claude-plugin/plugin.json': JSON.stringify({
          name: 'manifest-name',
          version: '2.0.0',
          skills: './manifest-skills',
          commands: ['./commands/review.md'],
        }),
      },
      { dirs: ['manifest-skills', 'marketplace-skills'] },
    );

    const result = await parseManifest(root, {
      id: 'marketplace-slug',
      version: '9.0.0',
      strict: false,
      components: { skills: './marketplace-skills' },
      unsupportedComponents: ['hooks'],
    });

    expect(result.manifestKind).toBe('claude-plugin');
    expect(result.manifest).toEqual(
      expect.objectContaining({
        name: 'marketplace-slug',
        version: '2.0.0',
        skills: [path.join(root, 'marketplace-skills')],
      }),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'info',
          message: expect.stringContaining('strict=false ignores manifest component declarations'),
        }),
        expect.objectContaining({
          severity: 'info',
          message: expect.stringContaining('"commands" is present but not supported'),
        }),
        expect.objectContaining({
          severity: 'info',
          message: expect.stringContaining(
            '"hooks" is declared by the marketplace but not supported',
          ),
        }),
      ]),
    );
  });

  it('materializes a manifestless marketplace definition', async () => {
    const root = await makePlugin(
      {
        'agents/review.md': '---\nname: review\n---\nReview code.',
      },
      { dirs: ['agents'] },
    );

    const result = await parseManifest(root, {
      id: 'definition-only',
      displayName: 'Definition Only',
      version: '1.2.3',
      components: { agents: './agents' },
    });

    expect(result.manifestKind).toBe('marketplace-definition');
    expect(result.manifest).toEqual(
      expect.objectContaining({
        name: 'definition-only',
        version: '1.2.3',
        agents: [path.join(root, 'agents')],
        interface: expect.objectContaining({ displayName: 'Definition Only' }),
      }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('parses plugin mcpServers', async () => {
    const root = await makePlugin(
      {
        'pythinker.plugin.json': JSON.stringify({
          name: 'demo',
          mcpServers: {
            finance: {
              command: './bin/finance-mcp',
              args: ['--stdio'],
              cwd: './bin',
              env: { FINANCE_API_KEY: 'x' },
            },
            docs: {
              url: 'https://example.com/mcp',
              headers: { 'X-Test': '1' },
            },
            events: {
              transport: 'sse',
              url: 'https://example.com/sse',
              headers: { 'X-Events': '1' },
            },
          },
        }),
      },
      { dirs: ['bin'] },
    );
    await writeFile(path.join(root, 'bin', 'finance-mcp'), '#!/bin/sh\n', 'utf8');
    const result = await parseManifest(root);
    expect(result.manifest?.mcpServers?.['finance']).toEqual({
      transport: 'stdio',
      command: path.join(root, 'bin', 'finance-mcp'),
      args: ['--stdio'],
      cwd: path.join(root, 'bin'),
      env: { FINANCE_API_KEY: 'x' },
    });
    expect(result.manifest?.mcpServers?.['docs']).toEqual({
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { 'X-Test': '1' },
    });
    expect(result.manifest?.mcpServers?.['events']).toEqual({
      transport: 'sse',
      url: 'https://example.com/sse',
      headers: { 'X-Events': '1' },
    });
  });

  it('warns and skips invalid plugin mcpServers entries', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({
        name: 'demo',
        mcpServers: {
          bad: { command: '/tmp/unsafe' },
        },
      }),
    });
    const result = await parseManifest(root);
    expect(result.manifest?.mcpServers).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('must be a PATH command or start with "./"'),
      }),
    );
  });

  it('parses and confines plugin LSP server declarations', async () => {
    const root = await makePlugin(
      {
        'pythinker.plugin.json': JSON.stringify({
          name: 'demo',
          lspServers: {
            typescript: {
              command: './bin/typescript-language-server',
              args: ['--stdio'],
              extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
              env: { NODE_ENV: 'development' },
              initializationOptions: { preferences: { quotePreference: 'single' } },
              settings: { typescript: { format: { enable: true } } },
              workspaceFolder: './workspace',
              startupTimeout: 5_000,
            },
          },
        }),
      },
      { dirs: ['bin', 'workspace'] },
    );
    await writeFile(path.join(root, 'bin', 'typescript-language-server'), '#!/bin/sh\n', 'utf8');

    const result = await parseManifest(root);

    expect(result.manifest?.lspServers?.['typescript']).toEqual({
      command: path.join(root, 'bin', 'typescript-language-server'),
      args: ['--stdio'],
      extensionToLanguage: { '.ts': 'typescript', '.tsx': 'typescriptreact' },
      env: { NODE_ENV: 'development' },
      initializationOptions: { preferences: { quotePreference: 'single' } },
      settings: { typescript: { format: { enable: true } } },
      workspaceFolder: path.join(root, 'workspace'),
      startupTimeout: 5_000,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('warns and skips plugin LSP commands outside the plugin', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({
        name: 'demo',
        lspServers: {
          unsafe: {
            command: '/tmp/unsafe-language-server',
            extensionToLanguage: { '.ts': 'typescript' },
          },
        },
      }),
    });

    const result = await parseManifest(root);

    expect(result.manifest?.lspServers).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('must be a PATH command or start with "./"'),
      }),
    );
  });

  it('reads top-level displayName from a Claude plugin manifest', async () => {
    const root = await makePlugin(
      {
        '.claude-plugin/plugin.json': JSON.stringify({
          name: 'demo',
          displayName: 'Claude Demo',
        }),
      },
      { dirs: ['skills'] },
    );

    const result = await parseManifest(root);

    expect(result.manifest?.interface?.displayName).toBe('Claude Demo');
  });

  it.each([
    ['skills', 'skills', 'error'],
    ['agents', 'agents', 'warn'],
    ['output-styles', 'outputStyles', 'warn'],
  ] as const)(
    'skips a default %s directory symlink that resolves outside the plugin',
    async (directory, manifestField, severity) => {
      const root = await makePlugin({
        'pythinker.plugin.json': JSON.stringify({ name: 'demo' }),
      });
      const outside = await mkdtemp(path.join(tmpdir(), 'pythinker-plugin-outside-'));
      await symlink(outside, path.join(root, directory));

      const result = await parseManifest(root);

      expect(result.manifest?.[manifestField]).toEqual([]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity,
          message: expect.stringContaining(`"${manifestField}" path resolves outside the plugin`),
        }),
      );
    },
  );

  it('skips a root SKILL.md symlink that resolves outside the plugin', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({ name: 'demo' }),
    });
    const outside = await mkdtemp(path.join(tmpdir(), 'pythinker-plugin-outside-'));
    const outsideSkill = path.join(outside, 'SKILL.md');
    await writeFile(outsideSkill, '---\nname: outside\n---\nbody', 'utf8');
    await symlink(outsideSkill, path.join(root, 'SKILL.md'));

    const result = await parseManifest(root);

    expect(result.manifest?.skills).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('"skills" path resolves outside the plugin'),
      }),
    );
  });

  it('captures interface.displayName and shortDescription', async () => {
    const root = await makePlugin({
      'pythinker.plugin.json': JSON.stringify({
        name: 'demo',
        interface: { displayName: 'Demo', shortDescription: 'A demo.' },
      }),
    });
    const result = await parseManifest(root);
    expect(result.manifest?.interface?.displayName).toBe('Demo');
    expect(result.manifest?.interface?.shortDescription).toBe('A demo.');
  });
});
