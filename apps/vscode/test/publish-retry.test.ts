import { describe, expect, it, vi } from 'vitest';

// @ts-expect-error -- plain .mjs build script, no type declarations
import { classifyError, publishEachTarget, SUMMARY_LIMIT, summaryLine, withRetry } from '../scripts/publish-retry.mjs';

const TARGETS = ['darwin-x64', 'darwin-arm64', 'linux-x64'];
const FILES = TARGETS.map((target) => `/tmp/${target}.vsix`);

// Backoff is real time; every retry test overrides it so the suite stays fast.
const FAST = { backoffMs: [0, 0] };

describe('classifyError', () => {
  it('separates the three failure kinds that need different handling', () => {
    // The exact string the Marketplace returned mid-publish on 2026-08-05.
    expect(classifyError(new Error('Request timeout: /_apis/gallery/publishers/example'))).toBe('transient');
    expect(classifyError(new Error('connect ECONNRESET 13.107.42.16:443'))).toBe('transient');
    expect(classifyError(new Error('Response code 503 (Service Unavailable)'))).toBe('transient');

    // The exact string the Entra credential path returned.
    expect(classifyError(new Error('{"message":"The requested operation is not allowed."}'))).toBe('auth');
    expect(classifyError(new Error('Response code 401 (Unauthorized)'))).toBe('auth');

    expect(classifyError(new Error('Extension entrypoint(s) missing'))).toBe('fatal');
  });
});

describe('withRetry', () => {
  it('retries a transient failure and returns the eventual success', async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error('Request timeout'))
      .mockResolvedValueOnce('published');

    await expect(withRetry(action, { label: 'test', ...FAST })).resolves.toBe('published');
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and rethrows the last error', async () => {
    const action = vi.fn().mockRejectedValue(new Error('Request timeout'));

    await expect(withRetry(action, { label: 'test', attempts: 3, ...FAST })).rejects.toThrow('Request timeout');
    expect(action).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient failure', async () => {
    const action = vi.fn().mockRejectedValue(new Error('Response code 401 (Unauthorized)'));

    await expect(withRetry(action, { label: 'test', ...FAST })).rejects.toThrow('401');
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('summaryLine', () => {
  /**
   * The exact shape `runLocalCli` throws, and the exact reason the 0.12.0 release
   * printed six `FAILED <target>: Local ovsx exited with code 1:` lines with no
   * cause: the summary kept only the wrapper line and dropped the output after it.
   */
  it('keeps the registry error that follows the CLI wrapper line', () => {
    const error = new Error(
      'Local ovsx exited with code 1:\nERROR  Unknown namespace: pythoughts\n',
    );

    const line = summaryLine(error);

    expect(line).toContain('Unknown namespace: pythoughts');
    expect(line).toContain('exited with code 1');
  });

  it('caps a long error whether or not it has a second line', () => {
    // The cap used to bind only to the joined branch, so a registry answering
    // with one long JSON line printed in full.
    expect(summaryLine(new Error('x'.repeat(500)))).toHaveLength(SUMMARY_LIMIT);
    expect(summaryLine(new Error(`wrapper:\n${'y'.repeat(500)}`))).toHaveLength(SUMMARY_LIMIT);
  });

  it('leaves a single-line error alone and survives a blank one', () => {
    expect(summaryLine(new Error('Response code 401 (Unauthorized)')))
      .toBe('Response code 401 (Unauthorized)');
    // A CLI that failed without writing anything: every line is blank.
    expect(summaryLine('  \n  \n')).toBe('');
  });
});

describe('publishEachTarget', () => {
  it('reports the underlying cause for a failed target, not just the wrapper', async () => {
    const publishOne = vi.fn().mockRejectedValue(
      new Error('Local ovsx exited with code 1:\nERROR  Unknown namespace: pythoughts'),
    );
    const logged: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logged.push(args.join(' '));
    });

    try {
      await expect(
        publishEachTarget({ targets: TARGETS, files: FILES, registry: 'Open VSX', publishOne }),
      ).rejects.toThrow('3 of 3 target(s) failed');
    } finally {
      log.mockRestore();
    }

    const failures = logged.filter((line) => line.includes('FAILED'));
    expect(failures).toHaveLength(3);
    for (const failure of failures) {
      expect(failure).toContain('Unknown namespace: pythoughts');
    }
  });

  it('keeps publishing after one target fails, so a flake cannot strand the rest', async () => {
    const publishOne = vi.fn(async (_file: string, target: string) => {
      if (target === 'darwin-arm64') throw new Error('Extension rejected');
      return 'published';
    });

    await expect(
      publishEachTarget({ targets: TARGETS, files: FILES, registry: 'Marketplace', publishOne }),
    ).rejects.toThrow('1 of 3 target(s) failed');

    // The point of the change: linux-x64 is attempted even though darwin-arm64 died.
    expect(publishOne.mock.calls.map((call) => call[1])).toEqual(TARGETS);
  });

  it('stops immediately on an auth failure instead of hammering every target', async () => {
    const publishOne = vi.fn().mockRejectedValue(new Error('Response code 401 (Unauthorized)'));

    await expect(
      publishEachTarget({ targets: TARGETS, files: FILES, registry: 'Marketplace', publishOne }),
    ).rejects.toThrow('3 of 3 target(s) failed');

    expect(publishOne).toHaveBeenCalledTimes(1);
  });

  it('treats an already-published target as success, so a re-run completes', async () => {
    const publishOne = vi.fn(async (_file: string, target: string) =>
      target === 'darwin-x64' ? 'skipped' : 'published',
    );

    const result = await publishEachTarget({
      targets: TARGETS,
      files: FILES,
      registry: 'Marketplace',
      publishOne,
    });

    expect(result).toEqual({ published: ['darwin-arm64', 'linux-x64'], skipped: ['darwin-x64'] });
  });
});
