import { describe, expect, it } from 'vitest';

import {
  TasksBrowserModel,
  type BackgroundTaskStatus,
  type TaskRow,
} from '../../../src/tui/presentation/tasks-browser-model';

function task(
  taskId: string,
  status: BackgroundTaskStatus = 'running',
  startedAt = 0,
  endedAt: number | null = null,
): TaskRow {
  return {
    taskId,
    description: `Description for ${taskId}`,
    status,
    startedAt,
    endedAt,
  };
}

function rowIds(model: TasksBrowserModel): string[] {
  return model.toViewModel().rows.map((row) => row.taskId);
}

describe('TasksBrowserModel', () => {
  it('maps every status to its exact label and exposes the current view model', () => {
    const statuses: BackgroundTaskStatus[] = [
      'running',
      'completed',
      'failed',
      'timed_out',
      'killed',
      'lost',
    ];
    const model = new TasksBrowserModel(
      statuses.map((status, index) => task(status, status, index, index + 10)),
    );

    expect(
      Object.fromEntries(model.toViewModel().rows.map((row) => [row.status, row.statusLabel])),
    ).toEqual({
      running: 'running',
      completed: 'completed',
      failed: 'failed',
      timed_out: 'timed out',
      killed: 'killed',
      lost: 'lost',
    });
    expect(model.toViewModel()).toMatchObject({
      selectedIndex: 0,
      filter: 'all',
      stopPendingTaskId: undefined,
    });
  });

  it('treats every status except running as terminal and active filtering removes all of them', () => {
    const model = new TasksBrowserModel(
      [
        task('completed', 'completed'),
        task('running-a', 'running', 2),
        task('failed', 'failed'),
        task('lost', 'lost'),
        task('timed-out', 'timed_out'),
        task('killed', 'killed'),
        task('running-b', 'running', 1),
      ],
      'active',
    );

    expect(rowIds(model)).toEqual(['running-b', 'running-a']);
  });

  it('keeps all-filter input order before sorting and uses a stable comparator for ties', () => {
    const model = new TasksBrowserModel([
      task('running-first', 'running', 5),
      task('running-second', 'running', 5),
      task('terminal-first', 'failed', 1, 20),
      task('terminal-second', 'lost', 2, 20),
    ]);

    expect(rowIds(model)).toEqual([
      'running-first',
      'running-second',
      'terminal-first',
      'terminal-second',
    ]);
  });

  it('sorts running tasks first by ascending start and terminal tasks by descending end fallback', () => {
    const model = new TasksBrowserModel([
      task('terminal-old', 'completed', 2, 20),
      task('running-late', 'running', 9),
      task('terminal-fallback', 'failed', 30, null),
      task('running-early', 'running', 3),
      task('terminal-new', 'lost', 1, 40),
    ]);

    expect(rowIds(model)).toEqual([
      'running-early',
      'running-late',
      'terminal-new',
      'terminal-fallback',
      'terminal-old',
    ]);
  });

  it('initializes the requested filter, selection, and stop state', () => {
    const model = new TasksBrowserModel([task('terminal', 'completed')], 'active');

    expect(model.toViewModel()).toEqual({
      rows: [],
      selectedIndex: 0,
      filter: 'active',
      stopPendingTaskId: undefined,
    });
    expect(model.isStopPending()).toBe(false);
  });

  it('preserves selection by task id across task updates', () => {
    const model = new TasksBrowserModel([
      task('first', 'running', 1),
      task('selected', 'running', 2),
    ]);
    model.handleKey({ kind: 'down' });

    model.setTasks([
      task('selected', 'running', 3),
      task('new-first', 'running', 1),
      task('new-last', 'running', 4),
    ]);

    expect(model.toViewModel().selectedIndex).toBe(1);
    expect(model.toViewModel().rows[1]?.taskId).toBe('selected');
  });

  it('clamps selection when the selected task disappears and handles an empty replacement', () => {
    const model = new TasksBrowserModel([
      task('first', 'running', 1),
      task('second', 'running', 2),
      task('third', 'running', 3),
    ]);
    model.handleKey({ kind: 'down' });
    model.handleKey({ kind: 'down' });

    model.setTasks([task('only', 'running')]);
    expect(model.toViewModel().selectedIndex).toBe(0);
    expect(rowIds(model)).toEqual(['only']);

    model.setTasks([]);
    expect(model.toViewModel().selectedIndex).toBe(0);
  });

  it('clears a pending stop when its task becomes terminal', () => {
    const model = new TasksBrowserModel([task('pending')]);
    model.handleKey({ kind: 'stop' });

    model.setTasks([task('pending', 'failed', 0, 10)]);

    expect(model.isStopPending()).toBe(false);
    expect(model.toViewModel().stopPendingTaskId).toBeUndefined();
  });

  it('clears a pending stop when its task is removed', () => {
    const model = new TasksBrowserModel([task('pending'), task('other')]);
    model.handleKey({ kind: 'stop' });

    model.setTasks([task('other')]);

    expect(model.isStopPending()).toBe(false);
  });

  it('preserves a pending stop when its task remains non-terminal in the full task list', () => {
    const model = new TasksBrowserModel([task('pending'), task('other')], 'active');
    model.handleKey({ kind: 'stop' });

    model.setTasks([task('other', 'running', 1), task('pending', 'running', 2)]);

    expect(model.isStopPending()).toBe(true);
    expect(model.toViewModel().stopPendingTaskId).toBe('pending');
  });

  it('returns select at both up and down boundaries without moving past them', () => {
    const model = new TasksBrowserModel([
      task('first', 'running', 1),
      task('last', 'running', 2),
    ]);

    expect(model.handleKey({ kind: 'up' })).toEqual({ type: 'select', taskId: 'first' });
    expect(model.toViewModel().selectedIndex).toBe(0);
    expect(model.handleKey({ kind: 'down' })).toEqual({ type: 'select', taskId: 'last' });
    expect(model.handleKey({ kind: 'down' })).toEqual({ type: 'select', taskId: 'last' });
    expect(model.toViewModel().selectedIndex).toBe(1);
  });

  it('consumes up and down on an empty list without changing state', () => {
    const model = new TasksBrowserModel([]);
    const before = model.toViewModel();

    expect(model.handleKey({ kind: 'up' })).toEqual({ type: 'consumed' });
    expect(model.handleKey({ kind: 'down' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel()).toEqual(before);
  });

  it('preserves selection across a filter flip when the selected task remains visible', () => {
    const model = new TasksBrowserModel([
      task('running-first', 'running', 1),
      task('running-selected', 'running', 2),
      task('terminal', 'completed', 0, 5),
    ]);
    model.handleKey({ kind: 'down' });

    expect(model.handleKey({ kind: 'toggle-filter' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel().filter).toBe('active');
    expect(model.toViewModel().selectedIndex).toBe(1);
    expect(model.toViewModel().rows[1]?.taskId).toBe('running-selected');
  });

  it('clamps selection to zero when a filter flip removes the selected task', () => {
    const model = new TasksBrowserModel([
      task('running', 'running', 1),
      task('terminal', 'completed', 0, 5),
    ]);
    model.handleKey({ kind: 'down' });

    model.handleKey({ kind: 'toggle-filter' });

    expect(rowIds(model)).toEqual(['running']);
    expect(model.toViewModel().selectedIndex).toBe(0);
  });

  it('returns refresh without changing any state', () => {
    const model = new TasksBrowserModel([task('running')], 'active');
    model.handleKey({ kind: 'stop' });
    const before = model.toViewModel();

    expect(model.handleKey({ kind: 'refresh' })).toEqual({ type: 'refresh' });
    expect(model.toViewModel()).toEqual(before);
  });

  it('arms the selected running task and consumes stop on an empty list', () => {
    const model = new TasksBrowserModel([task('running')]);

    expect(model.handleKey({ kind: 'stop' })).toEqual({
      type: 'stop-armed',
      taskId: 'running',
    });
    expect(model.isStopPending()).toBe(true);

    const emptyModel = new TasksBrowserModel([]);
    expect(emptyModel.handleKey({ kind: 'stop' })).toEqual({ type: 'consumed' });
    expect(emptyModel.isStopPending()).toBe(false);
  });

  it('ignores stop on a selected terminal task without mutating pending state', () => {
    const model = new TasksBrowserModel([task('terminal', 'lost', 0, 2)]);
    expect(model.isStopPending()).toBe(false);

    expect(model.handleKey({ kind: 'stop' })).toEqual({
      type: 'stop-ignored',
      taskId: 'terminal',
    });
    expect(model.isStopPending()).toBe(false);
    expect(model.toViewModel().stopPendingTaskId).toBeUndefined();
  });

  it('opens the selected task or consumes open when empty without changing state', () => {
    const model = new TasksBrowserModel([task('first'), task('second', 'running', 1)]);
    model.handleKey({ kind: 'down' });
    const before = model.toViewModel();

    expect(model.handleKey({ kind: 'open' })).toEqual({ type: 'open', taskId: 'second' });
    expect(model.toViewModel()).toEqual(before);
    expect(new TasksBrowserModel([]).handleKey({ kind: 'open' })).toEqual({
      type: 'consumed',
    });
  });

  it('returns cancel without changing state', () => {
    const model = new TasksBrowserModel([task('running')]);
    model.handleKey({ kind: 'stop' });
    const before = model.toViewModel();

    expect(model.handleKey({ kind: 'cancel' })).toEqual({ type: 'cancel' });
    expect(model.toViewModel()).toEqual(before);
  });

  it('reports pending state and confirms only exact lowercase or uppercase y', () => {
    for (const char of ['y', 'Y']) {
      const model = new TasksBrowserModel([task(`task-${char}`)]);
      model.handleKey({ kind: 'stop' });

      expect(model.isStopPending()).toBe(true);
      expect(model.handleStopPromptKey(char)).toEqual({
        type: 'confirmed',
        taskId: `task-${char}`,
      });
      expect(model.isStopPending()).toBe(false);
    }
  });

  it('cancels every non-y stop prompt input and always clears pending state', () => {
    for (const char of ['n', 'unrelated', 'Escape', '']) {
      const model = new TasksBrowserModel([task('pending')]);
      model.handleKey({ kind: 'stop' });

      expect(model.handleStopPromptKey(char)).toEqual({ type: 'cancelled' });
      expect(model.isStopPending()).toBe(false);
    }
  });

  it('harmlessly cancels a stop prompt key when no stop is pending', () => {
    const model = new TasksBrowserModel([task('running')]);
    const before = model.toViewModel();

    expect(model.handleStopPromptKey('y')).toEqual({ type: 'cancelled' });
    expect(model.toViewModel()).toEqual(before);
  });

  it('projects only renderer-neutral row fields from the latest sorted tasks', () => {
    const source = task('task-1', 'timed_out', 4, null);
    const model = new TasksBrowserModel([source]);

    expect(model.toViewModel()).toEqual({
      rows: [
        {
          taskId: 'task-1',
          description: 'Description for task-1',
          status: 'timed_out',
          statusLabel: 'timed out',
        },
      ],
      selectedIndex: 0,
      filter: 'all',
      stopPendingTaskId: undefined,
    });
  });
});
