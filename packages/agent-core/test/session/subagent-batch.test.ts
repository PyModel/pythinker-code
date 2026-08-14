import { createControlledPromise } from '@antfu/utils';
import { APIProviderRateLimitError } from '@pymodel/kosong';
import { describe, expect, it, vi } from 'vitest';

import {
  type QueuedSubagentTask,
  type RunSubagentOptions,
  type SpawnSubagentOptions,
  type SubagentHandle,
} from '../../src/session/subagent-host';
import {
  SubagentBatch,
  type SubagentBatchLauncher,
  type SubagentResult,
  type SubagentSuspendedEvent,
} from '../../src/session/subagent-batch';
import { userCancellationReason } from '../../src/utils/abort';

const signal = new AbortController().signal;

describe('SubagentBatch scheduling contract', () => {
  it('normal phase starts five tasks immediately, then one task every 700ms', async () => {
    vi.useFakeTimers();
    try {
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(
        Array.from({ length: 9 }, (_, index) => queuedTask(index + 1)),
        { signal },
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(699);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(6);

      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(7);

      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(8);

      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(9);

      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(9);

      attempts.forEach((attempt, index) => {
        attempt.outcome.resolve({
          task: attempt.task,
          agentId: `agent-${String(index + 1)}`,
          status: 'completed',
          result: `result ${String(index + 1)}`,
        });
      });
      const results = await running;

      expect(results).toHaveLength(9);
      expect(results.every((result) => result.status === 'completed')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps live attempts at the concurrency limit and completes all tasks in order', async () => {
    vi.useFakeTimers();
    try {
      const { runBatch, attempts } = createMockBatchRunner({}, 2);
      const running = runBatch(
        Array.from({ length: 6 }, (_, index) => queuedTask(index + 1)),
        { signal },
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(2);

      // Each completion frees a slot for the next queued task; at most two
      // attempts are ever live at once.
      attempts[0]!.outcome.resolve({
        task: attempts[0]!.task,
        agentId: 'agent-1',
        status: 'completed',
        result: 'completed 1',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(3);
      expect(attempts[2]!.task.data).toBe(3);

      attempts[1]!.outcome.resolve({
        task: attempts[1]!.task,
        agentId: 'agent-2',
        status: 'completed',
        result: 'completed 2',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(4);
      expect(attempts[3]!.task.data).toBe(4);

      attempts[2]!.outcome.resolve({
        task: attempts[2]!.task,
        agentId: 'agent-3',
        status: 'completed',
        result: 'completed 3',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      expect(attempts[4]!.task.data).toBe(5);

      attempts[3]!.outcome.resolve({
        task: attempts[3]!.task,
        agentId: 'agent-4',
        status: 'completed',
        result: 'completed 4',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      // The initial launch limit of 5 is exhausted, so task 6 starts when
      // the ramp timer fires with a free slot.
      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(6);
      expect(attempts[5]!.task.data).toBe(6);

      attempts[4]!.outcome.resolve({
        task: attempts[4]!.task,
        agentId: 'agent-5',
        status: 'completed',
        result: 'completed 5',
      });
      attempts[5]!.outcome.resolve({
        task: attempts[5]!.task,
        agentId: 'agent-6',
        status: 'completed',
        result: 'completed 6',
      });
      await vi.advanceTimersByTimeAsync(0);

      const results = await running;
      expect(results.map((result) => result.task.data)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(results.every((result) => result.status === 'completed')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('falls back to the default limit for a %s concurrency limit', async (_label, limit) => {
    vi.useFakeTimers();
    try {
      // NaN survives Math.trunc and Math.max, and `running < NaN` is always
      // false, so the batch would launch nothing and never finish.
      const { runBatch, attempts } = createMockBatchRunner({}, limit);
      const running = runBatch([queuedTask(1), queuedTask(2)], { signal });

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(2);

      for (const [index, attempt] of attempts.entries()) {
        attempt.outcome.resolve({
          task: attempt.task,
          agentId: `agent-${String(index + 1)}`,
          status: 'completed',
          result: `completed ${String(index + 1)}`,
        });
      }
      await vi.advanceTimersByTimeAsync(0);

      const results = await running;
      expect(results.map((result) => result.task.data)).toEqual([1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms the launch timer while the concurrency cap blocks the ramp', async () => {
    vi.useFakeTimers();
    try {
      const { runBatch, attempts } = createMockBatchRunner({}, 2);
      const running = runBatch(
        Array.from({ length: 6 }, (_, index) => queuedTask(index + 1)),
        { signal },
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(2);

      attempts[0]!.outcome.resolve({
        task: attempts[0]!.task,
        agentId: 'agent-1',
        status: 'completed',
        result: 'completed 1',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(3);
      expect(attempts[2]!.task.data).toBe(3);

      // The t=0 timer fires while both slots are full. The batch must re-arm
      // it rather than drop the wakeup; a dropped wakeup is only replaced by
      // the next completion, which shifts every later launch one timer period
      // later and strands the last task behind the exhausted initial launch
      // limit.
      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(1);
      attempts[1]!.outcome.resolve({
        task: attempts[1]!.task,
        agentId: 'agent-2',
        status: 'completed',
        result: 'completed 2',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(4);
      expect(attempts[3]!.task.data).toBe(4);

      // Second blocked fire at t=1400 (re-armed from t=700).
      await vi.advanceTimersByTimeAsync(699);
      expect(attempts).toHaveLength(4);

      await vi.advanceTimersByTimeAsync(1);
      attempts[2]!.outcome.resolve({
        task: attempts[2]!.task,
        agentId: 'agent-3',
        status: 'completed',
        result: 'completed 3',
      });
      attempts[3]!.outcome.resolve({
        task: attempts[3]!.task,
        agentId: 'agent-4',
        status: 'completed',
        result: 'completed 4',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      expect(attempts[4]!.task.data).toBe(5);

      // Task 6 can no longer be started by a completion (the initial launch
      // limit of 5 is exhausted), so it depends entirely on the re-armed
      // timer firing after a slot frees.
      await vi.advanceTimersByTimeAsync(698);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(6);
      expect(attempts[5]!.task.data).toBe(6);

      attempts[4]!.outcome.resolve({
        task: attempts[4]!.task,
        agentId: 'agent-5',
        status: 'completed',
        result: 'completed 5',
      });
      attempts[5]!.outcome.resolve({
        task: attempts[5]!.task,
        agentId: 'agent-6',
        status: 'completed',
        result: 'completed 6',
      });
      await vi.advanceTimersByTimeAsync(0);

      const results = await running;
      expect(results.map((result) => result.task.data)).toEqual([1, 2, 3, 4, 5, 6]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limit phase starts when the first provider rate limit stops the normal ramp', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(Array.from({ length: 9 }, (_, index) => queuedTask(index + 1)), {
        signal: controller.signal,
      });
      void running.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      attempts.forEach((attempt) => {
        attempt.markReady();
      });

      attempts[0]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-1' });
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(5);

      attempts[1]!.outcome.resolve({
        task: attempts[1]!.task,
        agentId: 'agent-2',
        status: 'completed',
        result: 'completed 2',
      });
      await vi.advanceTimersByTimeAsync(3000);
      expect(attempts).toHaveLength(6);
      expect(attempts[5]!.task.data).toBe(1);
      expect(attempts[5]!.retryAgentId).toBe('agent-1');

      controller.abort();
      await expect(running).rejects.toThrowErrorMatchingInlineSnapshot(`[AbortError: This operation was aborted]`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('user cancellation returns completed, started, and not-started task results', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(Array.from({ length: 6 }, (_, index) => queuedTask(index + 1)), {
        signal: controller.signal,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      attempts[0]!.outcome.resolve({
        task: attempts[0]!.task,
        agentId: 'agent-1',
        status: 'completed',
        result: 'completed 1',
      });
      await vi.advanceTimersByTimeAsync(0);

      controller.abort(userCancellationReason());
      const results = await running;

      expect(results.map((result) => ({
        data: result.task.data,
        agentId: result.agentId,
        status: result.status,
        state: result.state,
        result: result.result,
        error: result.error,
      }))).toEqual([
        {
          data: 1,
          agentId: 'agent-1',
          status: 'completed',
          state: undefined,
          result: 'completed 1',
          error: undefined,
        },
        {
          data: 2,
          agentId: 'agent-2',
          status: 'aborted',
          state: 'started',
          result: undefined,
          error: 'The user manually interrupted this subagent batch before this subagent finished.',
        },
        {
          data: 3,
          agentId: 'agent-3',
          status: 'aborted',
          state: 'started',
          result: undefined,
          error: 'The user manually interrupted this subagent batch before this subagent finished.',
        },
        {
          data: 4,
          agentId: 'agent-4',
          status: 'aborted',
          state: 'started',
          result: undefined,
          error: 'The user manually interrupted this subagent batch before this subagent finished.',
        },
        {
          data: 5,
          agentId: 'agent-5',
          status: 'aborted',
          state: 'started',
          result: undefined,
          error: 'The user manually interrupted this subagent batch before this subagent finished.',
        },
        {
          data: 6,
          agentId: undefined,
          status: 'aborted',
          state: 'not_started',
          result: undefined,
          error: 'The user manually interrupted this subagent batch before this subagent was started.',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('normal phase keeps processing completions while waiting for the next launch', async () => {
    vi.useFakeTimers();
    try {
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(
        Array.from({ length: 6 }, (_, index) => queuedTask(index + 1)),
        { signal },
      );

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      attempts[0]!.outcome.resolve({
        task: attempts[0]!.task,
        agentId: 'agent-1',
        status: 'completed',
        result: 'completed 1',
      });

      await vi.advanceTimersByTimeAsync(699);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(6);

      attempts.slice(1).forEach((attempt, index) => {
        attempt.outcome.resolve({
          task: attempt.task,
          agentId: `agent-${String(index + 2)}`,
          status: 'completed',
          result: `completed ${String(index + 2)}`,
        });
      });
      await expect(running).resolves.toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limit phase requeues 429 tasks, emits suspended, and throttles launches', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const onSuspended = vi.fn();
      const { runBatch, attempts } = createMockBatchRunner({ onSuspended });
      const running = runBatch(Array.from({ length: 8 }, (_, index) => queuedTask(index + 1)), {
        signal: controller.signal,
      });
      void running.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      attempts.forEach((attempt) => {
        attempt.markReady();
      });
      attempts[0]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-1' });
      attempts[1]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-2' });
      await vi.advanceTimersByTimeAsync(0);
      expect(onSuspended).toHaveBeenCalledTimes(2);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(500);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(2500);
      expect(attempts).toHaveLength(6);
      expect(attempts[5]!.task.data).toBe(2);
      expect(attempts[5]!.retryAgentId).toBe('agent-2');

      controller.abort();
      await expect(running).rejects.toThrowErrorMatchingInlineSnapshot(`[AbortError: This operation was aborted]`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the only unfinished task on provider rate limit instead of suspending forever', async () => {
    vi.useFakeTimers();
    try {
      const onSuspended = vi.fn();
      const { runBatch, attempts } = createMockBatchRunner({ onSuspended });
      const running = runBatch(Array.from({ length: 2 }, (_, index) => queuedTask(index + 1)), {
        signal,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(2);
      attempts.forEach((attempt) => {
        attempt.markReady();
      });

      attempts[0]!.outcome.resolve({
        task: attempts[0]!.task,
        agentId: 'agent-1',
        status: 'completed',
        result: 'completed 1',
      });
      await vi.advanceTimersByTimeAsync(0);

      attempts[1]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-2' });
      await expect(running).resolves.toMatchObject([
        {
          task: { data: 1 },
          agentId: 'agent-1',
          status: 'completed',
          result: 'completed 1',
        },
        {
          task: { data: 2 },
          agentId: 'agent-2',
          status: 'failed',
          state: 'started',
          error: 'Rate limited',
        },
      ]);
      expect(onSuspended).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limit capacity blocks launches while active attempts fill all slots', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(Array.from({ length: 12 }, (_, index) => queuedTask(index + 1)), {
        signal: controller.signal,
      });
      void running.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      attempts.slice(0, 5).forEach((attempt) => {
        attempt.markReady();
      });

      for (let count = 6; count <= 12; count += 1) {
        await vi.advanceTimersByTimeAsync(700);
        expect(attempts).toHaveLength(count);
        attempts[count - 1]!.markReady();
      }

      attempts.slice(0, 12).forEach((attempt) => {
        attempt.markReady();
      });

      for (let index = 0; index < 1; index += 1) {
        attempts[index]!.outcome.resolve({
          type: 'rate_limited',
          agentId: `agent-${String(index + 1)}`,
        });
      }
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(3000);
      expect(attempts).toHaveLength(12);

      controller.abort();
      await expect(running).rejects.toThrowErrorMatchingInlineSnapshot(`[AbortError: This operation was aborted]`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limit recovery adds one capacity slot after three quiet minutes with queued work', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(Array.from({ length: 6 }, (_, index) => queuedTask(index + 1)), {
        signal: controller.signal,
      });
      void running.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      attempts.forEach((attempt) => {
        attempt.markReady();
      });

      attempts[0]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-1' });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(2000);
      attempts[1]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-2' });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(2000);
      attempts[2]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-3' });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(2000);
      attempts[3]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-4' });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(179_999);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(6);
      expect(attempts[5]!.task.data).toBe(4);
      expect(attempts[5]!.retryAgentId).toBe('agent-4');

      controller.abort();
      await expect(running).rejects.toThrowErrorMatchingInlineSnapshot(`[AbortError: This operation was aborted]`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limit phase keeps launches bounded after repeated 429s', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(Array.from({ length: 8 }, (_, index) => queuedTask(index + 1)), {
        signal: controller.signal,
      });
      void running.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      attempts.forEach((attempt) => {
        attempt.markReady();
      });

      for (let index = 0; index < 3; index += 1) {
        attempts[index]!.outcome.resolve({
          type: 'rate_limited',
          agentId: `agent-${String(index + 1)}`,
        });
        await vi.advanceTimersByTimeAsync(0);
      }

      await vi.advanceTimersByTimeAsync(3000);
      expect(attempts).toHaveLength(6);
      expect(attempts[5]!.task.data).toBe(3);
      expect(attempts[5]!.retryAgentId).toBe('agent-3');

      await vi.advanceTimersByTimeAsync(3000);
      expect(attempts).toHaveLength(7);
      expect(attempts[6]!.task.data).toBe(2);
      expect(attempts[6]!.retryAgentId).toBe('agent-2');

      controller.abort();
      await expect(running).rejects.toThrowErrorMatchingInlineSnapshot(`[AbortError: This operation was aborted]`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limit phase schedules another launch after starting while capacity remains', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(Array.from({ length: 8 }, (_, index) => queuedTask(index + 1)), {
        signal: controller.signal,
      });
      void running.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      attempts.forEach((attempt) => {
        attempt.markReady();
      });

      attempts[0]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-1' });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      attempts[1]!.outcome.resolve({
        task: attempts[1]!.task,
        agentId: 'agent-2',
        status: 'completed',
        result: 'completed 2',
      });
      attempts[2]!.outcome.resolve({
        task: attempts[2]!.task,
        agentId: 'agent-3',
        status: 'completed',
        result: 'completed 3',
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(2_999);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(6);
      expect(attempts[5]!.task.data).toBe(1);
      expect(attempts[5]!.retryAgentId).toBe('agent-1');

      await vi.advanceTimersByTimeAsync(2_999);
      expect(attempts).toHaveLength(6);

      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(7);
      expect(attempts[6]!.task.data).toBe(6);
      expect(attempts[6]!.retryAgentId).toBeUndefined();

      controller.abort();
      await expect(running).rejects.toThrowErrorMatchingInlineSnapshot(`[AbortError: This operation was aborted]`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('task timeout fails only that task', async () => {
    vi.useFakeTimers();
    try {
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch([{ ...queuedTask(1), timeout: 10_000 }], { signal });

      await vi.advanceTimersByTimeAsync(0);
      attempts[0]!.markReady();

      await vi.advanceTimersByTimeAsync(9999);
      expect(attempts).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await expect(running).resolves.toMatchObject([
        {
          task: { data: 1 },
          agentId: 'agent-1',
          status: 'failed',
          state: 'started',
          error: 'Subagent timed out.',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves a task without a timeout running past 30 minutes', async () => {
    vi.useFakeTimers();
    try {
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch([queuedTask(1)], { signal });

      await vi.advanceTimersByTimeAsync(0);
      attempts[0]!.markReady();
      await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

      attempts[0]!.outcome.resolve({
        task: attempts[0]!.task,
        agentId: 'agent-1',
        status: 'completed',
        result: 'completed after 31 minutes',
      });
      await expect(running).resolves.toMatchObject([
        {
          task: { data: 1 },
          status: 'completed',
          result: 'completed after 31 minutes',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not spend task timeout while the task is queued', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const { runBatch, attempts } = createMockBatchRunner();
      const running = runBatch(
        [
          ...Array.from({ length: 5 }, (_, index) => queuedTask(index + 1)),
          { ...queuedTask(6), timeout: 1000 },
        ],
        { signal },
      );
      void running.finally(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(699);
      expect(attempts).toHaveLength(5);

      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(6);

      await vi.advanceTimersByTimeAsync(999);
      expect(settled).toBe(false);

      attempts.slice(0, 5).forEach((attempt, index) => {
        attempt.outcome.resolve({
          task: attempt.task,
          agentId: `agent-${String(index + 1)}`,
          status: 'completed',
          result: `completed ${String(index + 1)}`,
        });
      });
      await vi.advanceTimersByTimeAsync(1);

      await expect(running).resolves.toMatchObject([
        { task: { data: 1 }, status: 'completed' },
        { task: { data: 2 }, status: 'completed' },
        { task: { data: 3 }, status: 'completed' },
        { task: { data: 4 }, status: 'completed' },
        { task: { data: 5 }, status: 'completed' },
        {
          task: { data: 6 },
          agentId: 'agent-6',
          status: 'failed',
          state: 'started',
          error: 'Subagent timed out.',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rate-limit phase continues launching after rate-limited attempts settle', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const { runBatch, attempts } = createMockBatchRunner({
        readyDelay: (attemptIndex) => (attemptIndex >= 7 ? 100 : undefined),
      });

      const running = runBatch(
        Array.from({ length: 9 }, (_, index) => queuedTask(index + 1)),
        { signal: controller.signal },
      );
      void running.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(5);
      attempts.slice(0, 5).forEach((attempt) => {
        attempt.markReady();
      });

      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(6);

      await vi.advanceTimersByTimeAsync(700);
      expect(attempts).toHaveLength(7);

      attempts[5]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-6' });
      attempts[6]!.outcome.resolve({ type: 'rate_limited', agentId: 'agent-7' });
      attempts[0]!.outcome.resolve({
        task: attempts[0]!.task,
        agentId: 'agent-1',
        status: 'completed',
        result: 'completed 1',
      });
      attempts[1]!.outcome.resolve({
        task: attempts[1]!.task,
        agentId: 'agent-2',
        status: 'completed',
        result: 'completed 2',
      });
      await vi.advanceTimersByTimeAsync(12_000);
      expect(attempts).toHaveLength(8);
      expect(attempts[7]!.task.data).toBe(7);
      expect(attempts[7]!.retryAgentId).toBe('agent-7');

      controller.abort();
      await expect(running).rejects.toThrowErrorMatchingInlineSnapshot(`[AbortError: This operation was aborted]`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries a task model and effort through spawn, resume, and retry attempts', async () => {
    vi.useFakeTimers();
    try {
      const { runBatch, attempts } = createMockBatchRunner();
      const resumeTask: QueuedSubagentTask<number> = {
        ...routedTask(2),
        kind: 'resume',
        resumeAgentId: 'agent-2',
      };
      const running = runBatch([routedTask(1), resumeTask, routedTask(3)], { signal });
      void running.catch(() => {});

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toHaveLength(3);
      attempts.forEach((attempt) => {
        attempt.markReady();
      });

      // Rate-limit one attempt so the batch re-launches it through the retry
      // path, which is the third way a child can be started. Another task has
      // to finish first to free the shrunken capacity, and a third has to stay
      // unfinished so the rate-limited one suspends instead of failing.
      const rateLimitedAgentId = `agent-${String(attempts[0]!.task.data)}`;
      attempts[0]!.outcome.resolve({ type: 'rate_limited', agentId: rateLimitedAgentId });
      attempts[1]!.outcome.resolve({ task: attempts[1]!.task, status: 'completed', result: 'done' });
      await vi.advanceTimersByTimeAsync(3000);
      expect(attempts).toHaveLength(4);
      expect(attempts[3]!.retryAgentId).toBe(rateLimitedAgentId);

      // A workflow routed to a cheaper model must reach every child however it
      // was started; dropping it on any path silently runs that child on the
      // parent's model.
      for (const attempt of attempts) {
        expect(attempt.runOptions.modelAlias).toBe('implementer-model');
        expect(attempt.runOptions.thinkingLevel).toBe('medium');
      }

      attempts.slice(2).forEach((attempt) => {
        attempt.outcome.resolve({ task: attempt.task, status: 'completed', result: 'done' });
      });
      await vi.advanceTimersByTimeAsync(0);
      await running;
    } finally {
      vi.useRealTimers();
    }
  });
});

type MockAttemptOutcome<T> =
  | SubagentResult<T>
  | {
      readonly type: 'rate_limited';
      readonly agentId: string;
    };

type MockAttemptRecord = {
  readonly task: QueuedSubagentTask<number>;
  readonly runOptions: RunSubagentOptions;
  readonly retryAgentId?: string;
  readonly markReady: () => void;
  readonly outcome: ReturnType<typeof createControlledPromise<MockAttemptOutcome<number>>>;
};

type MockBatchRunnerOptions = {
  readonly onSuspended?: (event: SubagentSuspendedEvent) => void;
  readonly readyDelay?: (attemptIndex: number) => number | undefined;
};

function createMockBatchRunner(
  options: MockBatchRunnerOptions = {},
  concurrencyLimit?: number,
): {
  readonly runBatch: <T>(
    tasks: readonly QueuedSubagentTask<T>[],
    options?: { readonly signal?: AbortSignal },
  ) => Promise<Array<SubagentResult<T>>>;
  readonly attempts: MockAttemptRecord[];
} {
  const attempts: MockAttemptRecord[] = [];
  let activeTasks: readonly QueuedSubagentTask<unknown>[] = [];

  const createHandle = <T,>(
    runOptions: RunSubagentOptions,
    agentId: string,
    profileName: string,
    resumed: boolean,
    retryAgentId?: string,
  ): SubagentHandle => {
    const task = findMockTask<T>(activeTasks, runOptions);
    const outcome = createControlledPromise<MockAttemptOutcome<T>>();
    const markReady = () => {
      runOptions.onReady?.();
    };
    const attemptIndex = attempts.length;
    attempts.push({
      task: task as unknown as QueuedSubagentTask<number>,
      runOptions,
      retryAgentId,
      markReady,
      outcome: outcome as unknown as MockAttemptRecord['outcome'],
    });

    const delay = options.readyDelay?.(attemptIndex);
    if (delay !== undefined) setTimeout(markReady, delay);

    return {
      agentId,
      profileName,
      resumed,
      completion: completionFromMockOutcome(outcome, runOptions.signal),
    };
  };

  const host = {
    spawn: async (spawnOptions: SpawnSubagentOptions) => {
      const task = findMockTask(activeTasks, spawnOptions);
      return createHandle(
        spawnOptions,
        mockAgentId(task, attempts.length),
        spawnOptions.profileName,
        false,
      );
    },
    resume: async (agentId: string, runOptions: RunSubagentOptions) =>
      createHandle(runOptions, agentId, 'subagent', true),
    retry: async (agentId: string, runOptions: RunSubagentOptions) =>
      createHandle(runOptions, agentId, 'subagent', true, agentId),
    suspended: (event: SubagentSuspendedEvent) => {
      options.onSuspended?.(event);
    },
  } satisfies SubagentBatchLauncher;

  return {
    runBatch: <T,>(
      tasks: readonly QueuedSubagentTask<T>[],
      runOptions?: { readonly signal?: AbortSignal },
    ) => {
      activeTasks = tasks.map((task) => ({
        ...task,
        signal: task.signal ?? runOptions?.signal,
      }));
      return new SubagentBatch(host, activeTasks as readonly QueuedSubagentTask<T>[], concurrencyLimit).run();
    },
    attempts,
  };
}

function findMockTask<T>(
  tasks: readonly QueuedSubagentTask<unknown>[],
  options: RunSubagentOptions,
): QueuedSubagentTask<T> {
  const task = tasks.find(
    (candidate) =>
      candidate.prompt === options.prompt &&
      candidate.parentToolCallId === options.parentToolCallId,
  );
  if (task === undefined) {
    throw new Error(`No mock queued task for prompt "${options.prompt}"`);
  }
  return task as QueuedSubagentTask<T>;
}

function mockAgentId(task: QueuedSubagentTask<unknown>, attemptIndex: number): string {
  if (typeof task.data === 'number') return `agent-${String(task.data)}`;
  return `agent-${String(attemptIndex + 1)}`;
}

function completionFromMockOutcome<T>(
  outcome: ReturnType<typeof createControlledPromise<MockAttemptOutcome<T>>>,
  signal: AbortSignal,
): SubagentHandle['completion'] {
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(signal.reason ?? new Error('Aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    outcome.then(
      (result) => {
        signal.removeEventListener('abort', abort);
        if (isMockRateLimitOutcome(result)) {
          reject(new APIProviderRateLimitError('Rate limited', result.agentId));
          return;
        }
        if (result.status === 'completed') {
          resolve({ result: result.result ?? '', usage: result.usage });
          return;
        }
        reject(new Error(result.error ?? result.status));
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

function isMockRateLimitOutcome<T>(
  outcome: MockAttemptOutcome<T>,
): outcome is Extract<MockAttemptOutcome<T>, { readonly type: 'rate_limited' }> {
  return 'type' in outcome && outcome.type === 'rate_limited';
}

function routedTask(index: number): QueuedSubagentTask<number> {
  return { ...queuedTask(index), modelAlias: 'implementer-model', thinkingLevel: 'medium' };
}

function queuedTask(index: number): QueuedSubagentTask<number> {
  return {
    kind: 'spawn',
    data: index,
    profileName: 'coder',
    parentToolCallId: 'call_dynamic_workflow',
    prompt: `Review item-${String(index)}`,
    description: `Review #${String(index)}`,
    runInBackground: false,
  };
}
