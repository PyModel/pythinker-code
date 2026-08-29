// Scenario: terminal-output backfill for background tasks (useTaskPoller).
// Responsibilities: folded background-subagent rows must receive the output
// fetched under their REST task id, and a transient getTask failure must not
// permanently suppress later backfills.
// Wiring: the composable is real; daemon requests are stubbed.
// Run: pnpm --filter @pymodel/pythinker-web exec vitest run test/task-poller.test.ts

import { computed, nextTick, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppTask } from '../src/api/types';
import { createInitialState } from '../src/api/daemon/eventReducer';
import { useTaskPoller } from '../src/composables/client/useTaskPoller';
import type { ExtendedState } from '../src/composables/usePythinkerWebClient';

const apiMock = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getPythinkerWebApi: () => apiMock,
}));

function createState(tasks: AppTask[]): ExtendedState {
  return reactive({
    ...createInitialState(),
    activeSessionId: 'sess_1',
    tasksBySession: { sess_1: tasks },
  }) as unknown as ExtendedState;
}

function subagent(id: string, overrides: Partial<AppTask> = {}): AppTask {
  return {
    id,
    sessionId: 'sess_1',
    kind: 'subagent',
    description: `task ${id}`,
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The same background subagent as seen on the two channels: WS keys it by
    agent id, REST by background-task id (`backgroundTaskId` links them).
    The live row is already completed so the poller's 1s output polling does
    not start racing the one-off backfill under test. */
function liveRow(): AppTask {
  return subagent('agent-1', {
    runInBackground: true,
    backgroundTaskId: 'task-9',
    status: 'completed',
    completedAt: '2026-01-01T00:01:00.000Z',
  });
}
function restRow(overrides: Partial<AppTask> = {}): AppTask {
  return subagent('task-9', {
    runInBackground: true,
    status: 'completed',
    completedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  });
}

describe('useTaskPoller terminal-output backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attaches output fetched under the REST id to the folded agent-id row', async () => {
    const state = createState([liveRow()]);
    apiMock.listTasks.mockResolvedValue([
      restRow({ outputPreview: 'final result', outputBytes: 2048 }),
    ]);

    const poller = useTaskPoller(state, computed(() => []));
    await poller.loadTasksForSession('sess_1');

    expect(apiMock.listTasks).toHaveBeenCalledWith(
      'sess_1',
      expect.objectContaining({ withOutput: true }),
    );
    expect(apiMock.getTask).not.toHaveBeenCalled();
    const rows = state.tasksBySession['sess_1'] ?? [];
    expect(rows.map((t) => t.id)).toEqual(['agent-1']);
    expect(rows[0]?.status).toBe('completed');
    expect(rows[0]?.outputPreview).toBe('final result');
    expect(rows[0]?.outputBytes).toBe(2048);
  });

  it('loads every terminal output through one bounded list request', async () => {
    const state = createState([liveRow()]);
    apiMock.listTasks.mockResolvedValue([
      restRow({ outputPreview: 'final result', outputBytes: 2048 }),
      restRow({ id: 'task-10', outputPreview: 'second result', outputBytes: 1024 }),
    ]);

    const poller = useTaskPoller(state, computed(() => []));
    await poller.loadTasksForSession('sess_1');

    expect(apiMock.listTasks).toHaveBeenCalledTimes(1);
    expect(apiMock.getTask).not.toHaveBeenCalled();
  });

  it('retries the load after a transient list failure', async () => {
    const state = createState([liveRow()]);
    apiMock.listTasks
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue([restRow({ outputPreview: 'final result', outputBytes: 2048 })]);

    const poller = useTaskPoller(state, computed(() => []));
    await poller.loadTasksForSession('sess_1');
    expect(state.tasksBySession['sess_1']?.[0]?.outputPreview).toBeUndefined();

    await poller.loadTasksForSession('sess_1');
    expect(apiMock.listTasks).toHaveBeenCalledTimes(2);
    expect(state.tasksBySession['sess_1']?.[0]?.outputPreview).toBe('final result');
  });

  it('uses one request for a polling cycle regardless of running-task count', async () => {
    vi.useFakeTimers();
    const running = Array.from({ length: 22 }, (_, index) =>
      subagent(`task-${index}`, { outputPreview: `tail ${index}` }),
    );
    const state = createState(running);
    apiMock.listTasks.mockResolvedValue(running.map((task) => ({ ...task })));

    useTaskPoller(state, computed(() => state.tasksBySession['sess_1'] ?? []));
    await nextTick();
    await Promise.resolve();

    expect(apiMock.listTasks).toHaveBeenCalledTimes(1);
    expect(apiMock.getTask).not.toHaveBeenCalled();
  });

  it('does not overlap a slow poll with later timer ticks', async () => {
    vi.useFakeTimers();
    const running = [subagent('task-1')];
    const state = createState(running);
    let resolvePoll!: (tasks: AppTask[]) => void;
    apiMock.listTasks.mockReturnValue(
      new Promise<AppTask[]>((resolve) => {
        resolvePoll = resolve;
      }),
    );

    useTaskPoller(state, computed(() => state.tasksBySession['sess_1'] ?? []));
    await nextTick();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(apiMock.listTasks).toHaveBeenCalledTimes(1);
    resolvePoll(running);
    await Promise.resolve();
  });

  it('aborts the active poll when the session changes', async () => {
    vi.useFakeTimers();
    const state = createState([subagent('task-1')]);
    let requestSignal: AbortSignal | undefined;
    apiMock.listTasks.mockImplementation(
      (_sessionId: string, input?: { signal?: AbortSignal }) => {
        requestSignal = input?.signal;
        return new Promise<AppTask[]>(() => {});
      },
    );

    useTaskPoller(state, computed(() => state.tasksBySession['sess_1'] ?? []));
    await nextTick();
    state.activeSessionId = 'sess_2';
    await nextTick();

    expect(requestSignal).toBeDefined();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not let a stale session load cancel the active session load', async () => {
    const state = createState([]);
    state.tasksBySession['sess_2'] = [];
    let resolveActive!: (tasks: AppTask[]) => void;
    let activeSignal: AbortSignal | undefined;
    apiMock.listTasks.mockImplementation(
      (sessionId: string, input?: { signal?: AbortSignal }) => {
        if (sessionId === 'sess_2') {
          activeSignal = input?.signal;
          return new Promise<AppTask[]>((resolve) => {
            resolveActive = resolve;
          });
        }
        return Promise.resolve([]);
      },
    );

    const poller = useTaskPoller(state, computed(() => []));
    state.activeSessionId = 'sess_2';
    await nextTick();
    const activeLoad = poller.loadTasksForSession('sess_2');
    await poller.loadTasksForSession('sess_1');

    expect(apiMock.listTasks).toHaveBeenCalledTimes(1);
    expect(activeSignal?.aborted).toBe(false);

    resolveActive([subagent('task-2', { sessionId: 'sess_2', status: 'completed' })]);
    await activeLoad;
    expect(state.tasksBySession['sess_2']?.map((task) => task.id)).toEqual(['task-2']);
  });

  it('keeps the task-array reference when a poll returns equal data', async () => {
    vi.useFakeTimers();
    const running = [subagent('task-1', { outputPreview: 'same output' })];
    const state = createState(running);
    const initial = state.tasksBySession['sess_1'];
    apiMock.listTasks.mockResolvedValue(running.map((task) => ({ ...task })));

    useTaskPoller(state, computed(() => state.tasksBySession['sess_1'] ?? []));
    await nextTick();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();

    expect(state.tasksBySession['sess_1']).toBe(initial);
  });
});
