export type TasksFilter = 'all' | 'active';

export type BackgroundTaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'killed'
  | 'lost';

export interface TaskRow {
  readonly taskId: string;
  readonly description: string;
  readonly status: BackgroundTaskStatus;
  readonly startedAt: number;
  readonly endedAt: number | null;
}

export interface TasksBrowserRow {
  readonly taskId: string;
  readonly description: string;
  readonly status: BackgroundTaskStatus;
  readonly statusLabel: string;
}

export interface TasksBrowserViewModel {
  readonly rows: readonly TasksBrowserRow[];
  readonly selectedIndex: number;
  readonly filter: TasksFilter;
  readonly stopPendingTaskId: string | undefined;
}

export type TasksBrowserKeyEvent =
  | { readonly kind: 'up' }
  | { readonly kind: 'down' }
  | { readonly kind: 'toggle-filter' }
  | { readonly kind: 'refresh' }
  | { readonly kind: 'stop' }
  | { readonly kind: 'open' }
  | { readonly kind: 'cancel' };

export type TasksBrowserKeyResult =
  | { readonly type: 'consumed' }
  | { readonly type: 'select'; readonly taskId: string }
  | { readonly type: 'refresh' }
  | { readonly type: 'open'; readonly taskId: string }
  | { readonly type: 'cancel' }
  | { readonly type: 'stop-armed'; readonly taskId: string }
  | { readonly type: 'stop-ignored'; readonly taskId: string };

export type StopPromptKeyResult =
  | { readonly type: 'confirmed'; readonly taskId: string }
  | { readonly type: 'cancelled' };

const STATUS_LABEL: Record<BackgroundTaskStatus, string> = {
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  timed_out: 'timed out',
  killed: 'killed',
  lost: 'lost',
};

function isTerminal(status: BackgroundTaskStatus): boolean {
  return status !== 'running';
}

function visibleTasks(tasks: readonly TaskRow[], filter: TasksFilter): readonly TaskRow[] {
  if (filter === 'all') {
    return tasks;
  }
  return tasks.filter((task) => !isTerminal(task.status));
}

function compareTasks(a: TaskRow, b: TaskRow): number {
  const aTerminal = isTerminal(a.status);
  const bTerminal = isTerminal(b.status);

  if (aTerminal !== bTerminal) {
    return aTerminal ? 1 : -1;
  }
  if (!aTerminal) {
    return a.startedAt - b.startedAt;
  }
  return (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt);
}

export class TasksBrowserModel {
  private tasks: readonly TaskRow[];
  private filter: TasksFilter;
  private sortedVisible: readonly TaskRow[];
  private selectedIndex = 0;
  private stopPendingTaskId: string | undefined;

  constructor(tasks: readonly TaskRow[], filter?: TasksFilter) {
    this.tasks = tasks;
    this.filter = filter ?? 'all';
    this.sortedVisible = visibleTasks(this.tasks, this.filter).toSorted(compareTasks);
  }

  setTasks(tasks: readonly TaskRow[]): void {
    const previousSelectedTaskId = this.sortedVisible[this.selectedIndex]?.taskId;
    this.tasks = tasks;
    this.recomputeSortedVisible();
    this.preserveSelection(previousSelectedTaskId);

    if (this.stopPendingTaskId !== undefined) {
      const pendingTask = this.tasks.find((task) => task.taskId === this.stopPendingTaskId);
      if (!pendingTask || isTerminal(pendingTask.status)) {
        this.stopPendingTaskId = undefined;
      }
    }
  }

  handleKey(event: TasksBrowserKeyEvent): TasksBrowserKeyResult {
    switch (event.kind) {
      case 'up':
        if (this.sortedVisible.length === 0) {
          return { type: 'consumed' };
        }
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        return { type: 'select', taskId: this.sortedVisible[this.selectedIndex]!.taskId };
      case 'down':
        if (this.sortedVisible.length === 0) {
          return { type: 'consumed' };
        }
        this.selectedIndex = Math.min(this.sortedVisible.length - 1, this.selectedIndex + 1);
        return { type: 'select', taskId: this.sortedVisible[this.selectedIndex]!.taskId };
      case 'toggle-filter': {
        const previousSelectedTaskId = this.sortedVisible[this.selectedIndex]?.taskId;
        this.filter = this.filter === 'all' ? 'active' : 'all';
        this.recomputeSortedVisible();
        this.preserveSelection(previousSelectedTaskId);
        return { type: 'consumed' };
      }
      case 'refresh':
        return { type: 'refresh' };
      case 'stop': {
        const task = this.sortedVisible[this.selectedIndex];
        if (!task) {
          return { type: 'consumed' };
        }
        if (isTerminal(task.status)) {
          return { type: 'stop-ignored', taskId: task.taskId };
        }
        this.stopPendingTaskId = task.taskId;
        return { type: 'stop-armed', taskId: task.taskId };
      }
      case 'open': {
        const task = this.sortedVisible[this.selectedIndex];
        return task ? { type: 'open', taskId: task.taskId } : { type: 'consumed' };
      }
      case 'cancel':
        return { type: 'cancel' };
    }
  }

  isStopPending(): boolean {
    return this.stopPendingTaskId !== undefined;
  }

  handleStopPromptKey(char: string): StopPromptKeyResult {
    if (this.stopPendingTaskId === undefined) {
      return { type: 'cancelled' };
    }

    const taskId = this.stopPendingTaskId;
    this.stopPendingTaskId = undefined;
    return char === 'y' || char === 'Y'
      ? { type: 'confirmed', taskId }
      : { type: 'cancelled' };
  }

  toViewModel(): TasksBrowserViewModel {
    return {
      rows: this.sortedVisible.map((task) => ({
        taskId: task.taskId,
        description: task.description,
        status: task.status,
        statusLabel: STATUS_LABEL[task.status],
      })),
      selectedIndex: this.selectedIndex,
      filter: this.filter,
      stopPendingTaskId: this.stopPendingTaskId,
    };
  }

  private recomputeSortedVisible(): void {
    this.sortedVisible = visibleTasks(this.tasks, this.filter).toSorted(compareTasks);
  }

  private preserveSelection(previousSelectedTaskId: string | undefined): void {
    if (previousSelectedTaskId !== undefined) {
      const newIndex = this.sortedVisible.findIndex(
        (task) => task.taskId === previousSelectedTaskId,
      );
      if (newIndex !== -1) {
        this.selectedIndex = newIndex;
        return;
      }
    }

    this.selectedIndex =
      this.sortedVisible.length === 0
        ? 0
        : Math.min(Math.max(this.selectedIndex, 0), this.sortedVisible.length - 1);
  }
}
