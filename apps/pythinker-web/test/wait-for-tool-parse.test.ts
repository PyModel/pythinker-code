import { describe, expect, it } from 'vitest';
import { parseWaitForOutput } from '../src/components/chat/tool-calls/waitForToolParse';

describe('parseWaitForOutput', () => {
  it('parses a completed wait with a finished task', () => {
    const view = parseWaitForOutput([
      'wait_status: completed',
      'task_id: bash-abc123',
      'waited_ms: 8300',
      'timeout_ms: 600000',
      '',
      '[finished]',
      'task_id: bash-abc123',
      'status: completed',
      'description: pnpm test passed',
      'output_path: /tmp/x/output.log',
      'terminal_reason: completed',
      '',
      '[output]',
      '✓ 42 tests passed',
    ]);
    expect(view).toMatchObject({
      status: 'completed',
      waitedMs: 8300,
      taskId: 'bash-abc123',
      finishedStatus: 'completed',
      finishedDescription: 'pnpm test passed',
      extraCount: 0,
      runningCount: 0,
      runningSamples: [],
    });
  });

  it('counts tasks finished during the wait and still-running samples', () => {
    const view = parseWaitForOutput([
      'wait_status: completed',
      'task_id: bash-main',
      'waited_ms: 1200',
      '',
      '[finished]',
      'task_id: bash-main',
      'status: failed',
      'description: build broke',
      '',
      '[completed_during_wait]',
      'task_id: bash-extra-1',
      'description: sync done',
      '---',
      'task_id: bash-extra-2',
      'description: lint done',
      'Use TaskOutput with one of the task_id values above to read the full output.',
      '',
      '[still_running]',
      'active_background_tasks: 2',
      'task_id: bash-run-1',
      'description: installing deps',
      'task_id: bash-run-2',
      'description: running e2e',
    ]);
    expect(view).toMatchObject({
      status: 'completed',
      finishedStatus: 'failed',
      extraCount: 2,
      runningCount: 2,
      runningSamples: ['installing deps', 'running e2e'],
    });
  });

  it('parses a timed-out wait with still-running tasks (not an error)', () => {
    const view = parseWaitForOutput([
      'wait_status: timed_out',
      'task_id: bash-slow',
      'waited_ms: 30000',
      'timeout_ms: 30000',
      'The wait ended before the task finished.',
      '',
      '[still_running]',
      'active_background_tasks: 1',
      'task_id: bash-slow',
      'description: still fetching',
    ]);
    expect(view).toMatchObject({
      status: 'timed_out',
      waitedMs: 30000,
      taskId: 'bash-slow',
      extraCount: 0,
      runningCount: 1,
      runningSamples: ['still fetching'],
    });
  });

  it('parses the no-tasks outcome', () => {
    const view = parseWaitForOutput(['wait_status: no_tasks', 'waited_ms: 0']);
    expect(view).toMatchObject({ status: 'no_tasks', waitedMs: 0, runningCount: 0 });
  });

  it('caps still-running samples at three', () => {
    const lines = [
      'wait_status: timed_out',
      'waited_ms: 1000',
      '',
      '[still_running]',
      'active_background_tasks: 5',
    ];
    for (let i = 1; i <= 5; i++) {
      lines.push(`task_id: bash-${i}`, `description: task ${i}`);
    }
    const view = parseWaitForOutput(lines);
    expect(view).toMatchObject({ status: 'timed_out', runningCount: 5 });
    expect(view?.runningSamples).toEqual(['task 1', 'task 2', 'task 3']);
  });

  it('returns undefined for unrecognized output (error fallback)', () => {
    expect(parseWaitForOutput(['kaboom'])).toBeUndefined();
    expect(parseWaitForOutput([])).toBeUndefined();
    expect(parseWaitForOutput(undefined)).toBeUndefined();
  });

  it('tolerates a trailing empty output line', () => {
    const view = parseWaitForOutput(['wait_status: no_tasks', 'waited_ms: 10', '']);
    expect(view).toMatchObject({ status: 'no_tasks', waitedMs: 10 });
  });
});