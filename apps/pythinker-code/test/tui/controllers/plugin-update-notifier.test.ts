import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginSummary } from '@pymodel/pythinker-code-sdk';

import {
  PluginUpdateNotifier,
  type PluginUpdateNotifierSession,
} from '#/tui/controllers/plugin-update-notifier';
import type { PluginMarketplace } from '#/utils/plugin-marketplace';

const DATASOURCE_TOOL = 'mcp__plugin-example-data_data__call_data_source_tool';

function makePluginSummary(): PluginSummary {
  return {
    id: 'example-data',
    displayName: 'Example Data',
    version: '3.3.0',
    enabled: true,
    state: 'ok',
    skillCount: 0,
    mcpServerCount: 1,
    enabledMcpServerCount: 1,
    hookCount: 0,
    commandCount: 0,
    hasErrors: false,
    source: 'zip-url',
    originalSource:
      'https://plugins.example.com/pythinker-code/plugins/official/example-data.zip',
  };
}

function makeMarketplace(source: string): PluginMarketplace {
  return {
    source,
    plugins: [
      {
        id: 'example-data',
        displayName: 'Example Data',
        source:
          'https://plugins.example.com/pythinker-code/plugins/official/example-data.zip',
        tier: 'official',
        version: '3.4.0',
      },
    ],
  };
}

describe('PluginUpdateNotifier', () => {
  let tempDir: string;
  let session: PluginUpdateNotifierSession;
  let notify: ReturnType<typeof vi.fn<(message: string) => void>>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'plugin-update-notifier-'));
    session = {
      listMcpServers: vi.fn(async () => [{ name: 'plugin-example-data:data' }]),
      listPlugins: vi.fn(async () => [makePluginSummary()]),
    };
    notify = vi.fn();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function notifier(marketplace: PluginMarketplace): PluginUpdateNotifier {
    return new PluginUpdateNotifier({
      getSession: () => session,
      workDir: tempDir,
      notify,
      loadMarketplace: async () => marketplace,
      stateFile: join(tempDir, 'plugin-notices.json'),
    });
  }

  it('ignores non-plugin tool names without touching the session', async () => {
    await notifier(makeMarketplace('')).handleMcpToolCompleted('mcp__github__create_issue');

    expect(session.listMcpServers).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify for a Kimi marketplace source', async () => {
    await notifier(
      makeMarketplace('https://plugins.example.com/pythinker-code/plugins/marketplace.json'),
    ).handlePluginCommandCompleted('example-data');

    expect(session.listPlugins).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not notify for a former Kimi official install in the built-in catalog', async () => {
    await notifier(makeMarketplace('')).handlePluginCommandCompleted('example-data');

    expect(session.listPlugins).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('resolves a plugin MCP tool but does not notify for its former official install', async () => {
    await notifier(makeMarketplace('')).handleMcpToolCompleted(DATASOURCE_TOOL);

    expect(session.listMcpServers).toHaveBeenCalled();
    expect(session.listPlugins).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
