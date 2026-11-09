import { ToolAccesses } from '#/tool/toolContract';

export interface ToolCallTask<Result> {
  readonly accesses: ToolAccesses;
  readonly start: () => Promise<{
    readonly result: Promise<Result>;
    readonly effectsSettled?: Promise<unknown>;
  }>;
}

export interface OutstandingEffect {
  readonly accesses: ToolAccesses;
  readonly settled: Promise<unknown>;
}

export const DEFAULT_TOOL_CONCURRENCY = 16;

interface ScheduledToolCallTask<Result> extends ToolCallTask<Result> {
  readonly result: ControlledPromise<Result>;
}

interface ActiveEntry {
  readonly accesses: ToolAccesses;
}

type ControlledPromise<Result> = Promise<Result> & {
  readonly resolve: (value: Result | PromiseLike<Result>) => void;
  readonly reject: (reason?: unknown) => void;
};

export class ToolScheduler<Result> {
  private readonly activeTasks: ActiveEntry[] = [];
  private queuedTasks: Array<ScheduledToolCallTask<Result>> = [];

  constructor(
    outstanding: Iterable<OutstandingEffect> = [],
    private readonly maxConcurrency: number = DEFAULT_TOOL_CONCURRENCY,
  ) {
    for (const effect of outstanding) {
      const entry: ActiveEntry = { accesses: effect.accesses };
      this.activeTasks.push(entry);
      void effect.settled.then(
        () => this.finish(entry),
        () => this.finish(entry),
      );
    }
  }

  get running(): number {
    return this.activeTasks.length;
  }

  private get atCapacity(): boolean {
    return this.activeTasks.length >= this.maxConcurrency;
  }

  add(task: ToolCallTask<Result>): Promise<Result> {
    const result = createControlledPromise<Result>();
    void result.catch(() => undefined);

    const scheduledTask: ScheduledToolCallTask<Result> = { ...task, result };
    if (this.atCapacity || this.isBlocked(task, this.queuedTasks)) {
      this.queuedTasks.push(scheduledTask);
    } else {
      this.start(scheduledTask);
    }

    return result;
  }

  private isBlocked(
    task: ToolCallTask<Result>,
    queuedBefore: readonly ToolCallTask<Result>[],
  ): boolean {
    return (
      this.conflictsWithAny(task, this.activeTasks) || this.conflictsWithAny(task, queuedBefore)
    );
  }

  private conflictsWithAny(
    task: ToolCallTask<Result>,
    candidates: readonly ActiveEntry[],
  ): boolean {
    return candidates.some((candidate) =>
      ToolAccesses.conflict(task.accesses, candidate.accesses),
    );
  }

  private start(task: ScheduledToolCallTask<Result>): void {
    this.activeTasks.push(task);
    let started: ReturnType<ToolCallTask<Result>['start']>;
    try {
      started = task.start();
    } catch (error) {
      task.result.reject(error);
      this.finish(task);
      return;
    }

    void started
      .then(
        ({ result, effectsSettled }) => {
          result.then(task.result.resolve, task.result.reject);
          return Promise.allSettled([result, effectsSettled ?? result]);
        },
        (error) => {
          task.result.reject(error);
        },
      )
      .finally(() => {
        this.finish(task);
      });
  }

  private finish(task: ActiveEntry): void {
    const index = this.activeTasks.indexOf(task);
    if (index >= 0) this.activeTasks.splice(index, 1);
    this.startQueuedTasks();
  }

  private startQueuedTasks(): void {
    const stillQueued: Array<ScheduledToolCallTask<Result>> = [];
    for (const task of this.queuedTasks) {
      if (this.atCapacity || this.isBlocked(task, stillQueued)) {
        stillQueued.push(task);
      } else {
        this.start(task);
      }
    }
    this.queuedTasks = stillQueued;
  }
}

function createControlledPromise<Result>(): ControlledPromise<Result> {
  let resolve!: (value: Result | PromiseLike<Result>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Result>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  }) as ControlledPromise<Result>;
  return Object.assign(promise, { resolve, reject });
}
