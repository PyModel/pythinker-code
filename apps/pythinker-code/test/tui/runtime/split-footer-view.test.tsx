import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STATUS_LINE_CONFIG,
  type StatusLineConfig,
} from '#/tui/config';
import {
  createFooterState,
  foldFooterEvents,
  selectFooterViewModel,
  type FooterEvent,
  type FooterStatus,
} from '#/tui/runtime/footer/footer-model';
import { renderFooterRows } from '../../../src/tui/runtime/footer/split-footer-view';

const CLOCK_MS = 300_000;

function workflowStatus(): Partial<FooterStatus> {
  return {
    model: 'DeepSeek V4 Flash',
    thinkingLevel: 'max',
    cwd: '/Users/example/work/pythinker-code',
    homeDir: '/Users/example',
    dynamicWorkflowMode: true,
    contextUsage: 0.05,
    git: {
      branch: 'main',
      dirty: false,
      ahead: 15,
      behind: 0,
      diffAdded: 0,
      diffDeleted: 0,
      pullRequest: null,
    },
    tokenSpeed: 75.7,
    tokenSpeedEstimated: false,
    elapsedMs: 252_000,
  } as Partial<FooterStatus>;
}

function footerViewModel(
  events: readonly FooterEvent[] = [],
  statusLine: StatusLineConfig = DEFAULT_STATUS_LINE_CONFIG,
) {
  const state = foldFooterEvents(
    createFooterState(),
    [
      { type: 'status.updated', changes: workflowStatus() },
      ...events,
    ] satisfies readonly FooterEvent[],
  );
  return selectFooterViewModel(state, CLOCK_MS, statusLine);
}

function rows(
  events: readonly FooterEvent[] = [],
  statusLine: StatusLineConfig = DEFAULT_STATUS_LINE_CONFIG,
) {
  return renderFooterRows(footerViewModel(events, statusLine), 120);
}

function statusConfig(
  overrides: Partial<StatusLineConfig>,
): StatusLineConfig {
  return { ...DEFAULT_STATUS_LINE_CONFIG, ...overrides };
}

describe('split footer row layout', () => {
  it('renders the default composer and status rows in the required hierarchy', () => {
    expect(rows()).toEqual([
      '❯ [Composer]',
      '  DeepSeek V4 Flash · max · 75.7 t/s    ▱▱▱▱▱▱▱▱ 5% · main ↑15 · workflow · elapsed 04:12',
    ]);
  });

  it('renders YOLO at the start of a red second status row beneath the model', () => {
    const events: readonly FooterEvent[] = [
      {
        type: 'status.updated',
        changes: { permissionMode: 'yolo' },
      },
    ];
    const viewModel = footerViewModel(events);
    const rendered = renderFooterRows(viewModel, 120);

    expect(viewModel.rows.at(-1)).toMatchObject({ emphasis: 'danger' });
    expect(rendered).toHaveLength(3);
    expect(rendered[1]).toContain('DeepSeek V4 Flash');
    expect(rendered[1]).not.toContain('yolo');
    expect(rendered[2]).toBe('  yolo');
  });

  it('renders a representative mixed configuration in shared item order', () => {
    const rendered = rows(
      [],
      statusConfig({
        showModel: false,
        showContextBar: false,
        showModes: false,
      }),
    );

    expect(rendered).toEqual([
      '❯ [Composer]',
      '  main ↑15    elapsed 04:12',
    ]);
  });

  it('retains the composer and an empty status row when all items are hidden', () => {
    const rendered = rows([], {
      showModel: false,
      showEffort: false,
      showTokenSpeed: false,
      showContextBar: false,
      showGit: false,
      showModes: false,
      showElapsed: false,
      showGoal: false,
      showBackgroundTasks: false,
    });

    expect(rendered).toEqual(['❯ [Composer]', '']);
  });

  it('adds one activity row without restoring the fixed four-row footer', () => {
    const rendered = rows([
      {
        type: 'status.updated',
        changes: { dynamicWorkflowMode: false },
      },
      {
        type: 'activity.updated',
        activity: {
          phase: 'thinking',
          label: 'Thinking through the change',
          spinnerActive: true,
          spinnerFrame: '⠹',
        },
      },
    ]);

    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toContain('Thinking through the change');
    expect(rendered.slice(1)).toEqual([
      '❯ [Composer]',
      '  DeepSeek V4 Flash · max · 75.7 t/s    ▱▱▱▱▱▱▱▱ 5% · main ↑15 · elapsed 04:12',
    ]);
  });
});
