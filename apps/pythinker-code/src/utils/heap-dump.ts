import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { getHeapSnapshot, getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';

export type HeapDumpResult =
  | { readonly success: true; readonly heapPath: string; readonly diagPath: string }
  | { readonly success: false; readonly error: string };

export async function performHeapDump(
  sessionId: string,
  version: string,
  outputDirectory = join(homedir(), 'Desktop'),
): Promise<HeapDumpResult> {
  try {
    const diagnostics = await captureMemoryDiagnostics(sessionId, version);
    const filename = safeFilename(sessionId);
    const heapPath = join(outputDirectory, `${filename}.heapsnapshot`);
    const diagPath = join(outputDirectory, `${filename}-diagnostics.json`);

    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    await writeFile(diagPath, JSON.stringify(diagnostics, null, 2), { mode: 0o600 });
    await pipeline(getHeapSnapshot(), createWriteStream(heapPath, { mode: 0o600 }));

    return { success: true, heapPath, diagPath };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function captureMemoryDiagnostics(sessionId: string, version: string): Promise<object> {
  const memory = process.memoryUsage();
  const heap = getHeapStatistics();
  const resource = process.resourceUsage();
  const uptimeSeconds = process.uptime();
  const nativeMemory = memory.rss - memory.heapUsed;
  const mbPerHour = uptimeSeconds > 0
    ? (memory.rss / uptimeSeconds * 3600) / (1024 * 1024)
    : 0;
  const activeHandles = processInternalCount('_getActiveHandles');
  const activeRequests = processInternalCount('_getActiveRequests');
  const openFileDescriptors = await optionalDirectoryCount('/proc/self/fd');
  const potentialLeaks: string[] = [];

  if (heap.number_of_detached_contexts > 0) {
    potentialLeaks.push(
      `${String(heap.number_of_detached_contexts)} detached context(s) - possible context leak`,
    );
  }
  if (activeHandles !== undefined && activeHandles > 100) {
    potentialLeaks.push(`${String(activeHandles)} active handles - possible timer or socket leak`);
  }
  if (nativeMemory > memory.heapUsed) {
    potentialLeaks.push('Native memory exceeds heap memory');
  }
  if (mbPerHour > 100) {
    potentialLeaks.push(`High average memory growth: ${mbPerHour.toFixed(1)} MB/hour`);
  }
  if (openFileDescriptors !== undefined && openFileDescriptors > 500) {
    potentialLeaks.push(`${String(openFileDescriptors)} open file descriptors`);
  }

  return {
    timestamp: new Date().toISOString(),
    sessionId,
    version,
    trigger: 'manual',
    uptimeSeconds,
    memoryUsage: memory,
    memoryGrowthRate: {
      bytesPerSecond: uptimeSeconds > 0 ? memory.rss / uptimeSeconds : 0,
      mbPerHour,
    },
    v8HeapStats: {
      heapSizeLimit: heap.heap_size_limit,
      mallocedMemory: heap.malloced_memory,
      peakMallocedMemory: heap.peak_malloced_memory,
      detachedContexts: heap.number_of_detached_contexts,
      nativeContexts: heap.number_of_native_contexts,
    },
    v8HeapSpaces: safeHeapSpaceStatistics(),
    resourceUsage: {
      maxRSS: resource.maxRSS * 1024,
      userCPUTime: resource.userCPUTime,
      systemCPUTime: resource.systemCPUTime,
    },
    activeHandles,
    activeRequests,
    openFileDescriptors,
    analysis: {
      potentialLeaks,
      recommendation: potentialLeaks.length === 0
        ? 'No obvious leak indicators. Inspect the heap snapshot for retained objects.'
        : `${String(potentialLeaks.length)} potential leak indicator(s) found.`,
    },
    smapsRollup: await optionalFile('/proc/self/smaps_rollup'),
    platform: process.platform,
    nodeVersion: process.version,
  };
}

function safeHeapSpaceStatistics(): readonly object[] | undefined {
  try {
    return getHeapSpaceStatistics().map((space) => ({
      name: space.space_name,
      size: space.space_size,
      used: space.space_used_size,
      available: space.space_available_size,
    }));
  } catch {
    return undefined;
  }
}

function processInternalCount(
  name: '_getActiveHandles' | '_getActiveRequests',
): number | undefined {
  const method = (
    process as typeof process & Partial<Record<typeof name, () => readonly unknown[]>>
  )[name];
  return typeof method === 'function' ? method.call(process).length : undefined;
}

async function optionalDirectoryCount(path: string): Promise<number | undefined> {
  try {
    return (await readdir(path)).length;
  } catch {
    return undefined;
  }
}

async function optionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

function safeFilename(sessionId: string): string {
  const filename = sessionId.replaceAll(/[^a-zA-Z0-9._-]+/gu, '-');
  return filename.length > 0 ? filename : 'pythinker-code';
}
