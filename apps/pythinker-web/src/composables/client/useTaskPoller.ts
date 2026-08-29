import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import { getPythinkerWebApi } from '../../api';
import type { AppTask } from '../../api/types';
import { keepLiveSubagents } from '../../lib/taskMerge';
import type { ExtendedState } from '../usePythinkerWebClient';

const TASK_OUTPUT_POLL_INTERVAL_MS = 1000;
const TASK_OUTPUT_POLL_BYTES = 4096;
const TASK_OUTPUT_FINAL_BYTES = 32 * 1024;

export interface UseTaskPoller {
  taskClock: Readonly<Ref<number>>;
  loadTasksForSession: (sessionId: string) => Promise<void>;
  dispose: () => void;
}

function sameArray(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function sameRecord(left: object, right: object): boolean {
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
  for (const key of keys) {
    const leftValue = leftRecord[key];
    const rightValue = rightRecord[key];
    if (key === 'outputLines' && Array.isArray(leftValue) && Array.isArray(rightValue)) {
      if (!sameArray(leftValue, rightValue)) return false;
    } else if (key === 'routing' && leftValue && rightValue) {
      if (!sameRecord(leftValue as object, rightValue as object)) return false;
    } else if (!Object.is(leftValue, rightValue)) {
      return false;
    }
  }
  return true;
}

function stabilizeTasks(next: AppTask[], existing: AppTask[]): AppTask[] {
  const existingById = new Map(existing.map((task) => [task.id, task] as const));
  const stable = next.map((task) => {
    const previous = existingById.get(task.id);
    return previous && sameRecord(task, previous) ? previous : task;
  });
  return stable.length === existing.length && stable.every((task, index) => task === existing[index])
    ? existing
    : stable;
}

function mergeRestTasks(taskList: AppTask[], existing: AppTask[]): AppTask[] {
  const existingById = new Map(existing.map((task) => [task.id, task] as const));
  return taskList.map((fresh) => {
    const old = existingById.get(fresh.id);
    return {
      ...fresh,
      outputLines: old?.outputLines,
      text: old?.text,
      outputPreview: fresh.outputPreview ?? old?.outputPreview,
      outputBytes: fresh.outputBytes ?? old?.outputBytes,
    };
  });
}

function isTerminal(task: AppTask): boolean {
  return task.status !== 'running';
}

export function useTaskPoller(
  rawState: ExtendedState,
  activeAppTasks: ComputedRef<AppTask[]>,
): UseTaskPoller {
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let finalRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let taskClockTimer: ReturnType<typeof setInterval> | null = null;
  let pollController: AbortController | null = null;
  let loadController: AbortController | null = null;
  let polledSessionId: string | undefined;
  let outputSessionId: string | undefined;
  const fetchedTerminalTaskOutputIds = new Set<string>();
  const taskClock = ref(0);

  function selectOutputSession(sessionId: string | undefined): void {
    if (outputSessionId === sessionId) return;
    outputSessionId = sessionId;
    fetchedTerminalTaskOutputIds.clear();
  }

  function applyTaskList(sessionId: string, taskList: AppTask[]): void {
    const existing = rawState.tasksBySession[sessionId] ?? [];
    const merged = keepLiveSubagents(mergeRestTasks(taskList, existing), existing);
    const stable = stabilizeTasks(merged, existing);
    if (stable === existing) return;
    rawState.tasksBySession = { ...rawState.tasksBySession, [sessionId]: stable };
  }

  function markTerminalOutputsFetched(taskList: AppTask[]): void {
    for (const task of taskList) {
      if (isTerminal(task)) fetchedTerminalTaskOutputIds.add(task.id);
    }
  }

  function needsTerminalOutput(taskList: AppTask[]): boolean {
    return taskList.some(
      (task) => isTerminal(task) && !fetchedTerminalTaskOutputIds.has(task.id),
    );
  }

  async function loadTasksForSession(sessionId: string): Promise<void> {
    if (rawState.activeSessionId !== sessionId) return;
    selectOutputSession(sessionId);
    loadController?.abort();
    const controller = new AbortController();
    loadController = controller;
    try {
      const taskList = await getPythinkerWebApi().listTasks(sessionId, {
        withOutput: true,
        outputBytes: TASK_OUTPUT_FINAL_BYTES,
        outputStatus: 'all',
        signal: controller.signal,
      });
      if (controller.signal.aborted || rawState.activeSessionId !== sessionId) return;
      markTerminalOutputsFetched(taskList);
      applyTaskList(sessionId, taskList);
    } catch {
      return;
    } finally {
      if (loadController === controller) loadController = null;
    }
  }

  async function pollTaskOutputForSession(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const api = getPythinkerWebApi();
      let taskList = await api.listTasks(sessionId, {
        withOutput: true,
        outputBytes: TASK_OUTPUT_POLL_BYTES,
        outputStatus: 'running',
        signal,
      });
      if (signal.aborted || rawState.activeSessionId !== sessionId) return;

      if (needsTerminalOutput(taskList)) {
        taskList = await api.listTasks(sessionId, {
          withOutput: true,
          outputBytes: TASK_OUTPUT_FINAL_BYTES,
          outputStatus: 'all',
          signal,
        });
        if (signal.aborted || rawState.activeSessionId !== sessionId) return;
        markTerminalOutputsFetched(taskList);
      }

      applyTaskList(sessionId, taskList);
    } catch {
      return;
    }
  }

  function hasRunningTask(sessionId: string): boolean {
    return (rawState.tasksBySession[sessionId] ?? []).some((task) => task.status === 'running');
  }

  function schedulePoll(sessionId: string, delayMs: number): void {
    if (pollTimer !== null) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void runPoll(sessionId);
    }, delayMs);
  }

  async function runPoll(sessionId: string): Promise<void> {
    if (
      polledSessionId !== sessionId ||
      rawState.activeSessionId !== sessionId ||
      !hasRunningTask(sessionId)
    ) {
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // Idle while hidden; `visibilitychange` below resumes with an immediate poll.
      return;
    }

    const controller = new AbortController();
    pollController = controller;
    await pollTaskOutputForSession(sessionId, controller.signal);
    if (pollController === controller) pollController = null;
    if (
      !controller.signal.aborted &&
      polledSessionId === sessionId &&
      rawState.activeSessionId === sessionId &&
      hasRunningTask(sessionId)
    ) {
      schedulePoll(sessionId, TASK_OUTPUT_POLL_INTERVAL_MS);
    }
  }

  function onVisibilityChange(): void {
    if (document.visibilityState !== 'visible' || polledSessionId === undefined) return;
    if (pollTimer !== null || pollController !== null) return;
    void runPoll(polledSessionId);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  function stopTaskOutputPolling(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollController?.abort();
    pollController = null;
    polledSessionId = undefined;
  }

  function startTaskOutputPolling(sessionId: string): void {
    if (polledSessionId === sessionId) return;
    stopTaskOutputPolling();
    selectOutputSession(sessionId);
    polledSessionId = sessionId;
    void runPoll(sessionId);
  }

  const stopTaskClockWatch = watch(
    () => activeAppTasks.value.some((task) => task.status === 'running'),
    (hasRunning) => {
      if (hasRunning && taskClockTimer === null) {
        taskClockTimer = setInterval(() => {
          taskClock.value = (taskClock.value + 1) % Number.MAX_SAFE_INTEGER;
        }, 1000);
      } else if (!hasRunning && taskClockTimer !== null) {
        clearInterval(taskClockTimer);
        taskClockTimer = null;
      }
    },
    { immediate: true },
  );

  const stopPollingWatch = watch(
    [
      () => rawState.activeSessionId,
      () => {
        const sessionId = rawState.activeSessionId;
        return sessionId === undefined ? false : hasRunningTask(sessionId);
      },
    ],
    ([sessionId, hasRunning], [previousSessionId, previousHasRunning]) => {
      if (finalRefreshTimer !== null) {
        clearTimeout(finalRefreshTimer);
        finalRefreshTimer = null;
      }
      if (sessionId !== previousSessionId) {
        loadController?.abort();
        loadController = null;
        selectOutputSession(sessionId);
      }
      if (sessionId !== undefined && hasRunning) {
        startTaskOutputPolling(sessionId);
        return;
      }

      stopTaskOutputPolling();
      if (sessionId === undefined || !previousHasRunning) return;
      const tasks = rawState.tasksBySession[sessionId] ?? [];
      if (!needsTerminalOutput(tasks)) return;
      finalRefreshTimer = setTimeout(() => {
        finalRefreshTimer = null;
        if (rawState.activeSessionId === sessionId && !hasRunningTask(sessionId)) {
          void loadTasksForSession(sessionId);
        }
      }, 1500);
    },
    { immediate: true },
  );

  function dispose(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
    stopTaskClockWatch();
    stopPollingWatch();
    stopTaskOutputPolling();
    loadController?.abort();
    loadController = null;
    if (finalRefreshTimer !== null) clearTimeout(finalRefreshTimer);
    finalRefreshTimer = null;
    if (taskClockTimer !== null) clearInterval(taskClockTimer);
    taskClockTimer = null;
    fetchedTerminalTaskOutputIds.clear();
  }

  return {
    taskClock: computed(() => taskClock.value),
    loadTasksForSession,
    dispose,
  };
}
