import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PluginSummary } from '@pymodel/pythinker-code-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANTHROPIC_PLUGIN_MARKETPLACE_URL,
  PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL,
  PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV,
} from '#/constant/app';
import {
  computeMarketplaceEntryStatus,
  computeUpdateStatus,
  loadPluginMarketplace,
  type PluginMarketplaceEntry,
} from '#/utils/plugin-marketplace';

const REPO_ROOT = join(import.meta.dirname, '../../../..');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const NEXT_SHA = '89abcdef0123456789abcdef0123456789abcdef';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('computeUpdateStatus', () => {
  it('reports not-installed when the plugin is absent', () => {
    expect(computeUpdateStatus('1.0.0', undefined, false)).toEqual({ kind: 'not-installed' });
  });

  it('reports an update when the marketplace version is newer', () => {
    expect(computeUpdateStatus('5.1.0', '5.0.0', true)).toEqual({
      kind: 'update', local: '5.0.0', latest: '5.1.0',
    });
  });

  it('reports up-to-date when versions match', () => {
    expect(computeUpdateStatus('5.1.0', '5.1.0', true)).toEqual({
      kind: 'up-to-date', version: '5.1.0',
    });
  });

  it('does not offer a downgrade when the local version is ahead', () => {
    expect(computeUpdateStatus('3.1.1', '3.2.0', true)).toEqual({
      kind: 'up-to-date', version: '3.2.0',
    });
  });

  it('never reports an update for non-semver versions', () => {
    expect(computeUpdateStatus('latest', '5.0.0', true).kind).toBe('up-to-date');
    expect(computeUpdateStatus('5.1.0', 'dev', true).kind).toBe('up-to-date');
  });

  it('shows only a known local version', () => {
    expect(computeUpdateStatus(undefined, '5.0.0', true)).toEqual({
      kind: 'up-to-date', version: '5.0.0',
    });
    expect(computeUpdateStatus('5.1.0', undefined, true)).toEqual({
      kind: 'up-to-date', version: undefined,
    });
  });
});

describe('computeMarketplaceEntryStatus', () => {
  it('compares immutable GitHub SHAs before semver', () => {
    const installed = pluginSummary({ installedSha: SHA });
    expect(computeMarketplaceEntryStatus(
      marketplaceEntry({ effectiveSha: NEXT_SHA }),
      installed,
    )).toEqual({ kind: 'update', local: SHA, latest: NEXT_SHA });
    expect(computeMarketplaceEntryStatus(
      marketplaceEntry({ effectiveSha: SHA }),
      installed,
    )).toEqual({ kind: 'up-to-date', version: '1.0.0' });
  });

  it('does not invent an update for an unpinned HEAD source', () => {
    expect(computeMarketplaceEntryStatus(marketplaceEntry(), pluginSummary())).toEqual({
      kind: 'up-to-date', version: '1.0.0',
    });
  });
});

describe('loadPluginMarketplace', () => {
  it('loads a local Pythinker marketplace and preserves relative sources', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pythinker-plugin-marketplace-'));
    const file = join(dir, 'marketplace.json');
    await writeFile(file, JSON.stringify({
      version: '1',
      plugins: [{
        id: 'pythinker-datasource',
        tier: 'official',
        displayName: 'Pythinker Datasource',
        version: '1.0.0',
        description: 'Datasource tools',
        source: './pythinker-datasource',
        keywords: ['data'],
      }],
    }), 'utf8');

    const marketplace = await loadPluginMarketplace({ workDir: '/tmp/work', source: file });

    expect(marketplace).toEqual(expect.objectContaining({
      format: 'pythinker', source: file, name: 'Pythinker', version: '1',
    }));
    expect(marketplace.plugins[0]).toEqual(expect.objectContaining({
      id: 'pythinker-datasource',
      displayName: 'Pythinker Datasource',
      tier: 'official',
      source: join(dir, 'pythinker-datasource'),
      keywords: ['data'],
      install: expect.objectContaining({ kind: 'supported' }),
    }));
  });

  it('recognizes a named Pythinker marketplace by its id-based entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pythinker-plugin-marketplace-'));
    const file = join(dir, 'marketplace.json');
    await writeFile(file, JSON.stringify({
      name: 'Example Pythinker Marketplace',
      owner: { name: 'Example Owner' },
      plugins: [{ id: 'demo', name: 'Demo', source: './demo' }],
    }), 'utf8');

    const marketplace = await loadPluginMarketplace({ workDir: '/tmp/work', source: file });

    expect(marketplace.format).toBe('pythinker');
    expect(marketplace.name).toBe('Example Pythinker Marketplace');
    expect(marketplace.plugins[0]).toEqual(expect.objectContaining({
      id: 'demo',
      source: join(dir, 'demo'),
      install: expect.objectContaining({ kind: 'supported' }),
    }));
  });

  it('includes Superpowers in the repository marketplace fixture', async () => {
    const marketplace = await loadPluginMarketplace({
      workDir: REPO_ROOT,
      source: join(REPO_ROOT, 'plugins/marketplace.json'),
    });

    expect(marketplace.plugins).toContainEqual(expect.objectContaining({
      id: 'superpowers',
      displayName: 'Superpowers',
      tier: 'curated',
      source: join(REPO_ROOT, 'plugins/curated/superpowers'),
    }));
  });

  it('loads the Pythinker alias through the environment override', async () => {
    vi.stubEnv(PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL_ENV, PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL);
    const fetchImpl = marketplaceFetch({
      plugins: [{ id: 'datasource', source: './official/datasource.zip' }],
    });

    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work', source: 'pythinker', fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL,
      { signal: expect.any(AbortSignal) },
    );
    expect(marketplace.sourceLabel).toBe('Pythinker');
    expect(marketplace.plugins[0]?.source).toBe(
      new URL('./official/datasource.zip', PYTHINKER_CODE_PLUGIN_MARKETPLACE_URL).toString(),
    );
  });

  it('times out a remote request with one overall deadline', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: unknown, init?: RequestInit) => {
      if (init?.signal === undefined) throw new Error('missing marketplace abort signal');
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;

    const loading = loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'https://example.test/marketplace.json',
      fetchImpl,
      fetchTimeoutMs: 25,
    });
    const timedOut = expect(loading).rejects.toThrow(/timed out after 25ms/i);
    await vi.advanceTimersByTimeAsync(25);

    await timedOut;
  });

  it('keeps the deadline active while reading the response body', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: () => new Promise<string>((_resolve, reject) => {
        setTimeout(() => reject(new Error('body remained pending')), 50);
      }),
    })) as unknown as typeof fetch;

    const loading = loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'https://example.test/marketplace.json',
      fetchImpl,
      fetchTimeoutMs: 25,
    });
    const timedOut = expect(loading).rejects.toThrow(/timed out after 25ms/i);
    await vi.advanceTimersByTimeAsync(50);

    await timedOut;
  });

  it('loads the Anthropic alias as a GitHub marketplace', async () => {
    const fetchImpl = marketplaceFetch(claudeCatalog([
      { name: 'review', source: './plugins/review' },
    ]));

    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work', source: 'anthropic', fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      ANTHROPIC_PLUGIN_MARKETPLACE_URL,
      { signal: expect.any(AbortSignal) },
    );
    expect(marketplace).toEqual(expect.objectContaining({
      format: 'claude',
      name: 'example-marketplace',
      sourceLabel: 'Anthropic official',
      owner: { name: 'Example Owner', email: undefined, url: undefined },
    }));
    expect(marketplace.plugins[0]).toEqual(expect.objectContaining({
      id: 'review',
      source: 'https://github.com/anthropics/claude-plugins-official/tree/HEAD',
      repositorySubdirectory: 'plugins/review',
      declaredRef: 'HEAD',
      install: {
        kind: 'supported',
        source: 'https://github.com/anthropics/claude-plugins-official/tree/HEAD',
        options: expect.objectContaining({
          repositorySubdirectory: 'plugins/review',
          definition: expect.objectContaining({ id: 'review' }),
        }),
      },
    }));
  });

  it('loads owner/repo and GitHub tree marketplace locations', async () => {
    const fetchImpl = marketplaceFetch(claudeCatalog([]));
    await loadPluginMarketplace({ workDir: '/tmp/does-not-exist', source: 'acme/plugins', fetchImpl });
    await loadPluginMarketplace({
      workDir: '/tmp/work', source: 'https://github.com/acme/plugins/tree/v2', fetchImpl,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://raw.githubusercontent.com/acme/plugins/HEAD/.claude-plugin/marketplace.json',
      { signal: expect.any(AbortSignal) },
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://raw.githubusercontent.com/acme/plugins/v2/.claude-plugin/marketplace.json',
      { signal: expect.any(AbortSignal) },
    );
  });

  it('normalizes current Claude GitHub source variants and metadata', async () => {
    const fetchImpl = marketplaceFetch(claudeCatalog([
      {
        name: 'subdir-plugin',
        displayName: 'Subdir Plugin',
        description: 'Useful tools',
        author: { name: 'Acme', url: 'https://example.com' },
        category: 'development',
        keywords: ['tools'],
        tags: ['community-managed'],
        homepage: 'https://example.com/plugin',
        strict: false,
        defaultEnabled: false,
        source: {
          source: 'git-subdir',
          url: 'https://github.com/acme/plugins.git',
          path: 'plugins/subdir',
          ref: 'main',
          sha: SHA,
        },
        skills: ['./skills'],
        mcpServers: './.mcp.json',
        hooks: './hooks.json',
      },
      {
        name: 'legacy-url-path',
        source: {
          source: 'url',
          url: 'https://github.com/acme/legacy.git',
          path: 'claude/plugin',
          sha: NEXT_SHA,
        },
      },
      { name: 'github-source', source: { source: 'github', repo: 'acme/simple', ref: 'v1' } },
      { name: 'npm-source', source: { source: 'npm', package: '@acme/plugin' } },
    ]));

    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work', source: 'https://example.com/marketplace.json', fetchImpl,
    });
    const [subdir, legacy, github, npm] = marketplace.plugins;

    expect(subdir).toEqual(expect.objectContaining({
      id: 'subdir-plugin',
      displayName: 'Subdir Plugin',
      author: { name: 'Acme', email: undefined, url: 'https://example.com' },
      category: 'development',
      keywords: ['tools'],
      tags: ['community-managed'],
      strict: false,
      defaultEnabled: false,
      declaredRef: 'main',
      effectiveSha: SHA,
      repositorySubdirectory: 'plugins/subdir',
      supportedComponents: ['skills', 'mcpServers'],
      unsupportedComponents: ['hooks'],
      install: {
        kind: 'supported',
        source: `https://github.com/acme/plugins/tree/${SHA}`,
        options: expect.objectContaining({
          repositorySubdirectory: 'plugins/subdir',
          definition: expect.objectContaining({
            id: 'subdir-plugin',
            strict: false,
            defaultEnabled: false,
            unsupportedComponents: ['hooks'],
          }),
        }),
      },
    }));
    expect(legacy).toEqual(expect.objectContaining({
      source: `https://github.com/acme/legacy/tree/${NEXT_SHA}`,
      repositorySubdirectory: 'claude/plugin',
    }));
    expect(github).toEqual(expect.objectContaining({
      source: 'https://github.com/acme/simple/tree/v1', declaredRef: 'v1',
    }));
    expect(npm?.install).toEqual({
      kind: 'unsupported', reason: 'npm plugin sources are not supported.',
    });
  });

  it('prepends catalog pluginRoot to local relative Claude plugin sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-marketplace-'));
    await mkdir(join(root, '.claude-plugin'));
    await writeFile(
      join(root, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        ...claudeCatalog([{ name: 'local-plugin', source: 'formatter' }]),
        metadata: { pluginRoot: './plugins' },
      }),
      'utf8',
    );

    const marketplace = await loadPluginMarketplace({ workDir: '/tmp/work', source: root });

    expect(marketplace.plugins[0]).toEqual(expect.objectContaining({
      source: join(root, 'plugins/formatter'),
      repositorySubdirectory: undefined,
      install: expect.objectContaining({ kind: 'supported' }),
    }));
  });

  it('prepends catalog pluginRoot to GitHub-relative Claude plugin sources', async () => {
    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'acme/catalog',
      fetchImpl: marketplaceFetch({
        ...claudeCatalog([{ name: 'formatter', source: 'formatter' }]),
        metadata: { pluginRoot: './plugins' },
      }),
    });

    expect(marketplace.plugins[0]).toEqual(expect.objectContaining({
      source: 'https://github.com/acme/catalog/tree/HEAD',
      repositorySubdirectory: 'plugins/formatter',
      install: expect.objectContaining({ kind: 'supported' }),
    }));
  });

  it.each([
    'git://example.test/acme/plugin.git',
    'git+https://example.test/acme/plugin.git',
  ])('keeps generic Git source %s visible but unavailable', async (source) => {
    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'https://example.com/.claude-plugin/marketplace.json',
      fetchImpl: marketplaceFetch(claudeCatalog([{ name: 'generic-git', source }])),
    });

    expect(marketplace.plugins[0]?.install).toEqual({
      kind: 'unsupported',
      reason: 'Generic Git plugin sources are not supported.',
    });
  });

  it('keeps direct-URL relative plugins visible but unavailable', async () => {
    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'https://example.com/.claude-plugin/marketplace.json',
      fetchImpl: marketplaceFetch(claudeCatalog([{ name: 'relative', source: './plugin' }])),
    });

    expect(marketplace.plugins[0]?.install).toEqual({
      kind: 'unsupported',
      reason: 'Relative Claude plugin sources require a GitHub repository or local marketplace directory.',
    });
  });

  it.each([
    ['missing marketplace name', { owner: { name: 'Owner' }, plugins: [{ name: 'demo', source: './demo' }] }, /must define "name"/],
    ['missing owner', { name: 'catalog', plugins: [{ name: 'demo', source: './demo' }] }, /owner.*name/],
    ['missing plugin name', claudeCatalog([{ source: './demo' }]), /must define "name"/],
    ['duplicate plugin names', claudeCatalog([{ name: 'Demo', source: './a' }, { name: 'demo', source: './b' }]), /duplicate plugin name/],
    ['invalid SHA', claudeCatalog([{ name: 'demo', source: { source: 'url', url: 'https://github.com/acme/demo.git', sha: 'abc' } }]), /40-character hexadecimal SHA/],
    ['traversing path', claudeCatalog([{ name: 'demo', source: '../demo' }]), /stay inside its repository/],
    ['backslash path', claudeCatalog([{ name: 'demo', source: '.\\demo' }]), /absolute or unsafe/],
  ])('rejects %s', async (_name, catalog, error) => {
    await expect(loadPluginMarketplace({
      workDir: '/tmp/work', source: 'acme/catalog', fetchImpl: marketplaceFetch(catalog),
    })).rejects.toThrow(error as RegExp);
  });

  it('encodes object GitHub refs without flattening valid multi-segment refs', async () => {
    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'https://example.com/.claude-plugin/marketplace.json',
      fetchImpl: marketplaceFetch(claudeCatalog([
        {
          name: 'reserved-ref',
          source: { source: 'github', repo: 'acme/plugin', ref: 'release#1' },
        },
        {
          name: 'multi-segment-ref',
          source: { source: 'github', repo: 'acme/plugin', ref: 'feature/release 1' },
        },
      ])),
    });

    expect(marketplace.plugins[0]).toEqual(expect.objectContaining({
      source: 'https://github.com/acme/plugin/tree/release%231',
      declaredRef: 'release#1',
    }));
    expect(new URL(marketplace.plugins[0]!.source).hash).toBe('');
    expect(marketplace.plugins[1]).toEqual(expect.objectContaining({
      source: 'https://github.com/acme/plugin/tree/feature/release%201',
      declaredRef: 'feature/release 1',
    }));
  });

  it('decodes and safely re-encodes GitHub tree refs for catalogs and plugins', async () => {
    const fetchImpl = marketplaceFetch(claudeCatalog([
      { name: 'encoded-ref', source: 'https://github.com/acme/plugin/tree/release%231' },
    ]));
    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'https://github.com/acme/catalog/tree/feature/release%201',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/acme/catalog/feature/release%201/.claude-plugin/marketplace.json',
      { signal: expect.any(AbortSignal) },
    );
    expect(marketplace.plugins[0]).toEqual(expect.objectContaining({
      source: 'https://github.com/acme/plugin/tree/release%231',
      declaredRef: 'release#1',
    }));
  });

  it.each(['feature//x', 'feature/./x', 'feature/../x'])(
    'rejects unsafe object GitHub ref %s',
    async (ref) => {
      await expect(loadPluginMarketplace({
        workDir: '/tmp/work',
        source: 'https://example.com/.claude-plugin/marketplace.json',
        fetchImpl: marketplaceFetch(claudeCatalog([
          { name: 'unsafe-ref', source: { source: 'github', repo: 'acme/plugin', ref } },
        ])),
      })).rejects.toThrow(/GitHub ref must not contain empty/);
    },
  );

  it.each([
    'feature//x',
    'feature/./x',
    'feature/../x',
    'feature/%2E%2E/x',
    'feature%2F%2E%2E%2Fx',
  ])('keeps unsafe GitHub URL ref %s visible as unsupported', async (ref) => {
    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'https://example.com/.claude-plugin/marketplace.json',
      fetchImpl: marketplaceFetch(claudeCatalog([
        { name: 'unsafe-ref', source: `https://github.com/acme/plugin/tree/${ref}` },
      ])),
    });

    expect(marketplace.plugins[0]?.install).toEqual({
      kind: 'unsupported',
      reason: 'Only GitHub-backed Claude plugin sources are supported.',
    });
  });

  it('keeps malformed percent-encoded GitHub refs visible as unsupported', async () => {
    const marketplace = await loadPluginMarketplace({
      workDir: '/tmp/work',
      source: 'https://example.com/.claude-plugin/marketplace.json',
      fetchImpl: marketplaceFetch(claudeCatalog([
        { name: 'malformed-ref', source: 'https://github.com/acme/plugin/tree/%zz' },
      ])),
    });

    expect(marketplace.plugins[0]?.install).toEqual({
      kind: 'unsupported',
      reason: 'Only GitHub-backed Claude plugin sources are supported.',
    });
  });

  it('rejects unknown Pythinker marketplace tier values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pythinker-plugin-marketplace-'));
    const file = join(dir, 'marketplace.json');
    await writeFile(file, JSON.stringify({
      plugins: [{ id: 'demo', tier: 'community', source: './demo' }],
    }), 'utf8');

    await expect(loadPluginMarketplace({ workDir: '/tmp/work', source: file })).rejects.toThrow(
      /"tier" must be one of/,
    );
  });
});

function claudeCatalog(plugins: readonly unknown[]): Record<string, unknown> {
  return {
    name: 'example-marketplace',
    description: 'Example catalog',
    owner: { name: 'Example Owner' },
    plugins,
  };
}

function marketplaceFetch(catalog: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(catalog),
  })) as unknown as typeof fetch;
}

function marketplaceEntry(
  overrides: Partial<PluginMarketplaceEntry> = {},
): PluginMarketplaceEntry {
  return {
    id: 'demo',
    displayName: 'Demo',
    source: 'https://github.com/acme/demo/tree/HEAD',
    sourceLabel: 'acme/demo@HEAD',
    marketplaceName: 'example',
    marketplaceOwner: 'Example',
    tier: undefined,
    version: '1.0.0',
    description: undefined,
    author: undefined,
    homepage: undefined,
    repository: 'https://github.com/acme/demo',
    license: undefined,
    category: undefined,
    keywords: undefined,
    tags: undefined,
    strict: undefined,
    defaultEnabled: undefined,
    supportedComponents: [],
    unsupportedComponents: [],
    declaredRef: 'HEAD',
    effectiveSha: undefined,
    github: { owner: 'acme', repo: 'demo' },
    repositorySubdirectory: undefined,
    install: { kind: 'unsupported', reason: 'not used by this test' },
    ...overrides,
  };
}

function pluginSummary(options: { installedSha?: string } = {}): PluginSummary {
  return {
    id: 'demo',
    displayName: 'Demo',
    version: '1.0.0',
    description: undefined,
    enabled: true,
    state: 'ok',
    source: 'github',
    originalSource: 'https://github.com/acme/demo/tree/HEAD',
    skillCount: 0,
    mcpServerCount: 0,
    enabledMcpServerCount: 0,
    hasErrors: false,
    github: {
      owner: 'acme',
      repo: 'demo',
      ref: options.installedSha === undefined
        ? { kind: 'branch', value: 'HEAD' }
        : { kind: 'sha', value: options.installedSha },
      installedSha: options.installedSha,
    },
  } as PluginSummary;
}
