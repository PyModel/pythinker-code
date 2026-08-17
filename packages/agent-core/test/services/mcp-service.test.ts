import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ICoreProcessService } from '../../src/services';
import {
  McpServerAlreadyExistsError,
  McpServerNotFoundError,
  McpServerValidationError,
  McpService,
} from '../../src/services';

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'pythinker-mcp-service-'));
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function makeService(): McpService {
  return new McpService(
    {
      _serviceBrand: undefined,
      rpc: { listSessions: async () => [] },
      ready: async () => undefined,
      dispose: () => undefined,
    } as unknown as ICoreProcessService,
    {
      _serviceBrand: undefined,
      homeDir: join(testRoot, 'home'),
      configPath: join(testRoot, 'home', 'config.toml'),
    },
  );
}

async function mcpJson(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(testRoot, 'home', 'mcp.json'), 'utf8')) as Record<string, unknown>;
}

async function writeMcpJson(value: Record<string, unknown>): Promise<void> {
  await mkdir(join(testRoot, 'home'), { recursive: true });
  const path = join(testRoot, 'home', 'mcp.json');
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('McpService user-global persistence', () => {
  it('creates the user-global file and writes a server entry', async () => {
    await makeService().create('local_server', { command: 'node', args: ['server.mjs'] });

    const file = await mcpJson();
    expect(file['mcpServers']).toEqual({
      local_server: { transport: 'stdio', command: 'node', args: ['server.mjs'] },
    });
  });

  it('rejects an existing id without changing the entry', async () => {
    await writeMcpJson({ mcpServers: { existing: { command: 'old' } } });
    const service = makeService();

    await expect(service.create('existing', { command: 'new' })).rejects.toBeInstanceOf(
      McpServerAlreadyExistsError,
    );
    expect((await mcpJson())['mcpServers']).toEqual({
      existing: { command: 'old' },
    });
  });

  it('updates one entry and preserves siblings and unrelated keys', async () => {
    await writeMcpJson({
      metadata: { keep: true },
      mcpServers: {
        sibling: { command: 'sibling' },
        target: { command: 'old' },
      },
    });

    await makeService().update('target', { command: 'new', args: ['--updated'] });

    expect(await mcpJson()).toEqual({
      metadata: { keep: true },
      mcpServers: {
        sibling: { command: 'sibling' },
        target: { transport: 'stdio', command: 'new', args: ['--updated'] },
      },
    });
  });

  it('removes only the requested entry', async () => {
    await writeMcpJson({
      mcpServers: {
        keep_me: { command: 'keep' },
        remove_me: { command: 'remove' },
      },
    });

    await makeService().remove('remove_me');

    expect((await mcpJson())['mcpServers']).toEqual({ keep_me: { command: 'keep' } });
  });

  it('raises not-found for an id absent from the user-global file', async () => {
    await writeMcpJson({ mcpServers: {} });

    await expect(makeService().remove('missing')).rejects.toBeInstanceOf(McpServerNotFoundError);
    await expect(makeService().update('missing', { command: 'node' })).rejects.toBeInstanceOf(
      McpServerNotFoundError,
    );
  });

  it('rejects a malformed server definition', async () => {
    await expect(makeService().create('bad', { url: 'not a url' })).rejects.toBeInstanceOf(
      McpServerValidationError,
    );
  });

  it('rejects unsafe ids before writing a file', async () => {
    await expect(makeService().create('bad/name', { command: 'node' })).rejects.toBeInstanceOf(
      McpServerValidationError,
    );
  });

  it('preserves underscores and hyphens in server names', async () => {
    const service = makeService();
    await service.create('under_score', { command: 'under' });
    await service.create('hyphen-name', { command: 'hyphen' });

    expect(Object.keys((await mcpJson())['mcpServers'] as Record<string, unknown>)).toEqual([
      'under_score',
      'hyphen-name',
    ]);
  });
});
