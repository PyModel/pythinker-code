import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { performHeapDump, type HeapDumpResult } from '#/utils/heap-dump';

const v8Mocks = vi.hoisted(() => ({
  getHeapSnapshot: vi.fn(),
  getHeapSpaceStatistics: vi.fn(),
  getHeapStatistics: vi.fn(),
}));

vi.mock('node:v8', () => v8Mocks);

const outputDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(outputDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('performHeapDump', () => {
  it('writes a private heap snapshot and memory diagnostics', async () => {
    v8Mocks.getHeapSnapshot.mockReturnValue(Readable.from(['heap snapshot']));
    v8Mocks.getHeapStatistics.mockReturnValue({
      heap_size_limit: 1024,
      malloced_memory: 128,
      peak_malloced_memory: 256,
      number_of_detached_contexts: 0,
      number_of_native_contexts: 1,
    });
    v8Mocks.getHeapSpaceStatistics.mockReturnValue([
      {
        space_name: 'old_space',
        space_size: 512,
        space_used_size: 384,
        space_available_size: 128,
        physical_space_size: 512,
      },
    ]);
    const outputDirectory = join(
      tmpdir(),
      `pythinker-heap-dump-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    outputDirectories.push(outputDirectory);

    const result = await performHeapDump('session/unsafe', '1.2.3', outputDirectory);

    expect(result).toMatchObject({
      success: true,
      heapPath: join(outputDirectory, 'session-unsafe.heapsnapshot'),
      diagPath: join(outputDirectory, 'session-unsafe-diagnostics.json'),
    });
    const successful = result as Extract<HeapDumpResult, { success: true }>;
    expect(await readFile(successful.heapPath, 'utf8')).toBe('heap snapshot');
    expect(JSON.parse(await readFile(successful.diagPath, 'utf8'))).toMatchObject({
      sessionId: 'session/unsafe',
      version: '1.2.3',
      trigger: 'manual',
      v8HeapStats: {
        heapSizeLimit: 1024,
        detachedContexts: 0,
      },
      v8HeapSpaces: [{ name: 'old_space', size: 512, used: 384, available: 128 }],
    });
    expect((await stat(successful.heapPath)).mode & 0o777).toBe(0o600);
    expect((await stat(successful.diagPath)).mode & 0o777).toBe(0o600);
  });
});
