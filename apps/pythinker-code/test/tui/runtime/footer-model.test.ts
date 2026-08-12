import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STATUS_LINE_CONFIG,
  type StatusLineConfig,
} from '#/tui/config';
import {
  createFooterState,
  foldFooterEvents,
  formatStatusRow,
  selectFooterViewModel as selectFooterViewModelBase,
  selectStatusBarExtras,
  type FooterEvent,
  type FooterStatus,
  type FooterStatusRowViewModel,
  type FooterUpdate,
} from '#/tui/runtime/footer/footer-model';

const CLOCK_MS = 90_000;

function selectFooterViewModel(
  state: Parameters<typeof selectFooterViewModelBase>[0],
  clockMs: number,
  statusLine: StatusLineConfig = DEFAULT_STATUS_LINE_CONFIG,
) {
  return selectFooterViewModelBase(state, clockMs, statusLine);
}

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

function configurableState() {
  return foldFooterEvents(
    createFooterState({
      ...workflowStatus(),
      sessionSpendUsd: 1.25,
      permissionMode: 'auto',
      planMode: true,
    }),
    [
      {
        type: 'goal.updated',
        goal: {
          status: 'active',
          turnsUsed: 2,
          turnBudget: 5,
          wallClockMs: 3_000,
          observedAtMs: CLOCK_MS,
        },
      },
      {
        type: 'background-counts.updated',
        counts: { bashTasks: 2, agentTasks: 3 },
      },
    ],
  );
}

function statusConfig(
  overrides: Partial<StatusLineConfig> = {},
): StatusLineConfig {
  return { ...DEFAULT_STATUS_LINE_CONFIG, ...overrides };
}

function hideAllStatusItems(): StatusLineConfig {
  return {
    showModel: false,
    showEffort: false,
    showTokenSpeed: false,
    showContextBar: false,
    showGit: false,
    showModes: false,
    showElapsed: false,
    showGoal: false,
    showBackgroundTasks: false,
  };
}

function mainStatusRow(
  statusLine: StatusLineConfig = DEFAULT_STATUS_LINE_CONFIG,
): FooterStatusRowViewModel {
  const row = selectFooterViewModel(configurableState(), CLOCK_MS, statusLine).rows.find(
    (candidate) => candidate.kind === 'status' && candidate.emphasis !== 'danger',
  );
  if (row?.kind !== 'status') throw new Error('Expected a status row');
  return row;
}

describe('footer model', () => {
  it('builds one ordered composer and status hierarchy without persistent chrome noise', () => {
    const state = foldFooterEvents(createFooterState(), [
      { type: 'status.updated', changes: workflowStatus() },
    ] satisfies readonly FooterEvent[]);

    const viewModel = selectFooterViewModel(state, CLOCK_MS);

    expect(viewModel.rows).toEqual([
      {
        kind: 'composer',
        slot: {
          kind: 'composer-slot',
          marker: '❯',
          placeholder: 'Composer',
          textLength: 0,
        },
      },
      {
        kind: 'status',
        items: [
          'DeepSeek V4 Flash · max · 75.7 t/s',
          '▱▱▱▱▱▱▱▱ 5%',
          'main ↑15',
          'workflow',
          'elapsed 04:12',
        ],
        modelName: 'DeepSeek V4 Flash',
      },
    ]);
    expect(viewModel.rows).toHaveLength(2);
    expect(JSON.stringify(viewModel.rows)).not.toContain('/Users/example');
    expect(JSON.stringify(viewModel.rows)).not.toContain('shift+tab');
  });

  it('uses validation before activity as the only optional third footer row', () => {
    const state = foldFooterEvents(createFooterState(), [
      { type: 'status.updated', changes: workflowStatus() },
      {
        type: 'activity.updated',
        activity: {
          phase: 'thinking',
          label: 'Thinking through the change',
          spinnerActive: true,
          spinnerFrame: '⠹',
        },
      },
      {
        type: 'validation.updated',
        validation: { level: 'warning', message: 'Review the selected model' },
      },
    ] satisfies readonly FooterEvent[]);

    const rows = selectFooterViewModel(state, CLOCK_MS).rows;

    expect(rows).toHaveLength(3);
    expect(rows[0]?.kind).toBe('validation');
    expect(rows.slice(1).map((row) => row.kind)).toEqual(['composer', 'status']);
  });

  it('keeps visible non-workflow activity while workflow mode is enabled', () => {
    const state = foldFooterEvents(createFooterState(), [
      { type: 'status.updated', changes: workflowStatus() },
      {
        type: 'activity.updated',
        activity: {
          phase: 'tool',
          label: 'Refreshing git status',
          spinnerActive: true,
          spinnerFrame: '⠹',
        },
      },
    ] satisfies readonly FooterEvent[]);

    const rows = selectFooterViewModel(state, CLOCK_MS).rows;

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      kind: 'activity',
      primary: '⠹ Refreshing git status',
    });
  });

  it('omits elapsed time when the runtime has no active start timestamp', () => {
    const state = foldFooterEvents(createFooterState(), [
      {
        type: 'status.updated',
        changes: {
          ...workflowStatus(),
          elapsedMs: null,
        } as Partial<FooterStatus>,
      },
    ] satisfies readonly FooterEvent[]);

    const rows = selectFooterViewModel(state, CLOCK_MS).rows;
    const status = rows.at(-1);

    expect(status).toMatchObject({ kind: 'status' });
    expect(JSON.stringify(status)).not.toContain('elapsed');
  });

  it('shows positive session spend without model rates', () => {
    const state = createFooterState({
      model: 'Priced Model',
      sessionSpendUsd: 0.125,
    });

    const status = selectFooterViewModel(state, CLOCK_MS).rows.at(-1);

    expect(status).toMatchObject({
      kind: 'status',
      items: [
        'Priced Model',
        '$0.13',
        '▱▱▱▱▱▱▱▱ 0%',
      ],
    });
  });

  it('shows session spend when the active model has no catalog rates', () => {
    const state = createFooterState({
      model: 'Unpriced Model',
      sessionSpendUsd: 12.34,
    });

    const status = selectFooterViewModel(state, CLOCK_MS).rows.at(-1);

    expect(status).toMatchObject({
      kind: 'status',
      items: ['Unpriced Model', '$12.34', '▱▱▱▱▱▱▱▱ 0%'],
    });
  });

  it.each([undefined, 0])(
    'omits session spend when it is %s',
    (sessionSpendUsd) => {
      const status = selectFooterViewModel(
        createFooterState({ model: 'Priced Model', sessionSpendUsd }),
        CLOCK_MS,
      ).rows.at(-1);

      expect(status).toMatchObject({
        kind: 'status',
        items: ['Priced Model', '▱▱▱▱▱▱▱▱ 0%'],
      });
    },
  );

  it('uses stable precision without rounding the stored spend', () => {
    const sessionSpendUsd = 0.009999999999999_998;
    const state = createFooterState({
      model: 'Priced Model',
      sessionSpendUsd,
    });

    const status = selectFooterViewModel(state, CLOCK_MS).rows.at(-1);

    expect(state.status.sessionSpendUsd).toBe(sessionSpendUsd);
    expect(status).toMatchObject({
      kind: 'status',
      items: expect.arrayContaining(['$0.01']),
    });
  });

  it('does not render a small positive spend as zero', () => {
    const status = selectFooterViewModel(
      createFooterState({ model: 'Priced Model', sessionSpendUsd: 0.004 }),
      CLOCK_MS,
    ).rows.at(-1);

    expect(status).toMatchObject({
      kind: 'status',
      items: expect.arrayContaining(['$0.004']),
    });
  });

  it('keeps all-true status configuration byte-for-byte compatible', () => {
    expect(mainStatusRow()).toEqual({
      kind: 'status',
      items: [
        'DeepSeek V4 Flash · max · 75.7 t/s',
        '$1.25',
        '▱▱▱▱▱▱▱▱ 5%',
        'main ↑15',
        'workflow auto plan',
        'elapsed 04:12',
        '[goal ● active · 3s · 2/5 turns]',
        '[2 tasks running]',
        '[3 agents running]',
      ],
      modelName: 'DeepSeek V4 Flash',
    });
  });

  it('projects status-bar extras in priority order without the model and modes items', () => {
    const state = foldFooterEvents(
      createFooterState({
        model: 'DeepSeek V4 Flash',
        contextUsage: 0.05,
        dynamicWorkflowMode: true,
        git: workflowStatus().git,
        tokenSpeed: 75.7,
        tokenSpeedEstimated: true,
      }),
      [
        {
          type: 'update.updated',
          update: { version: '0.11.0', state: 'available', percent: null },
        },
      ],
    );
    expect(selectStatusBarExtras(state, CLOCK_MS, DEFAULT_STATUS_LINE_CONFIG)).toEqual(
      ['▱▱▱▱▱▱▱▱ 5%', 'main ↑15', '↑ v0.11.0'],
    );
  });

  it('hides model metadata and spend together when the model item is disabled', () => {
    const row = mainStatusRow(statusConfig({ showModel: false }));

    expect(row.modelName).toBeNull();
    expect(row.items).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining('DeepSeek V4 Flash'),
        '$1.25',
      ]),
    );
  });

  it('hides effort and token speed independently while retaining the model', () => {
    expect(
      mainStatusRow(statusConfig({ showEffort: false })).items[0],
    ).toBe('DeepSeek V4 Flash · 75.7 t/s');
    expect(
      mainStatusRow(statusConfig({ showTokenSpeed: false })).items[0],
    ).toBe('DeepSeek V4 Flash · max');
    expect(
      mainStatusRow(
        statusConfig({ showEffort: false, showTokenSpeed: false }),
      ).items[0],
    ).toBe('DeepSeek V4 Flash');
  });

  it('shows requested Fast mode beside the model and hides it with mode badges', () => {
    const state = createFooterState({
      model: 'GPT-5.6 Sol',
      fastMode: true,
    });

    const visible = selectFooterViewModel(
      state,
      CLOCK_MS,
      DEFAULT_STATUS_LINE_CONFIG,
    ).rows.at(-1);
    const hidden = selectFooterViewModel(
      state,
      CLOCK_MS,
      statusConfig({ showModes: false }),
    ).rows.at(-1);

    expect(visible).toMatchObject({
      kind: 'status',
      items: expect.arrayContaining(['GPT-5.6 Sol · ↯ fast']),
    });
    expect(hidden).toMatchObject({
      kind: 'status',
      items: expect.arrayContaining(['GPT-5.6 Sol']),
    });
  });

  it.each([
    ['showContextBar', '▱▱▱▱▱▱▱▱ 5%'],
    ['showGit', 'main ↑15'],
    ['showModes', 'workflow auto plan'],
    ['showElapsed', 'elapsed 04:12'],
    ['showGoal', '[goal ● active · 3s · 2/5 turns]'],
  ] as const)('hides %s independently', (key, hiddenItem) => {
    const row = mainStatusRow(statusConfig({ [key]: false }));

    expect(row.items).not.toContain(hiddenItem);
    expect(row.items).toContain('DeepSeek V4 Flash · max · 75.7 t/s');
  });

  it('uses one toggle for both background badge kinds', () => {
    const row = mainStatusRow(
      statusConfig({ showBackgroundTasks: false }),
    );

    expect(row.items).not.toEqual(
      expect.arrayContaining(['[2 tasks running]', '[3 agents running]']),
    );
  });

  it('uses showModes for the dedicated YOLO row', () => {
    const state = createFooterState({
      model: 'DeepSeek V4 Flash',
      permissionMode: 'yolo',
    });

    expect(selectFooterViewModel(state, CLOCK_MS).rows).toHaveLength(3);
    expect(
      selectFooterViewModel(
        state,
        CLOCK_MS,
        statusConfig({ showModes: false }),
      ).rows,
    ).toHaveLength(2);
  });

  it('retains an empty status row when every status item is hidden', () => {
    const viewModel = selectFooterViewModel(
      configurableState(),
      CLOCK_MS,
      hideAllStatusItems(),
    );
    const row = viewModel.rows.at(-1);

    expect(viewModel.rows.map((candidate) => candidate.kind)).toEqual([
      'composer',
      'status',
    ]);
    expect(row).toEqual({ kind: 'status', items: [], modelName: null });
    expect(row?.kind === 'status' ? formatStatusRow(row.items) : null).toBe('');
  });

  it('joins mixed status items without orphaned or doubled separators', () => {
    const statusLine = {
      ...hideAllStatusItems(),
      showGit: true,
      showElapsed: true,
    };
    const text = formatStatusRow(mainStatusRow(statusLine).items);

    expect(text).toBe('  main ↑15    elapsed 04:12');
    expect(text).not.toMatch(/(^|·)\s*·|·\s*$/u);
  });

  it('keeps transient hints independent from an all-hidden status line', () => {
    const state = foldFooterEvents(configurableState(), [
      {
        type: 'transient-hint.updated',
        hint: 'Press Ctrl-C again to exit',
      },
    ]);
    const viewModel = selectFooterViewModel(
      state,
      CLOCK_MS,
      hideAllStatusItems(),
    );

    expect(viewModel.rows).toEqual([
      {
        kind: 'validation',
        level: 'info',
        message: 'Press Ctrl-C again to exit',
      },
      {
        kind: 'composer',
        slot: {
          kind: 'composer-slot',
          marker: '❯',
          placeholder: 'Composer',
          textLength: 0,
        },
      },
      { kind: 'status', items: [], modelName: null },
    ]);
  });

  it('keeps the footer model independent of rendering and ambient runtime modules', () => {
    const source = readFileSync(
      new URL('../../../src/tui/runtime/footer/footer-model.ts', import.meta.url),
      'utf8',
    );
    const importSources = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1] ?? '',
    );

    expect(importSources).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/theme|render|terminal|(?:^|\/)io(?:\/|$)|clock/i),
      ]),
    );
    expect(source).not.toMatch(
      /FooterModelCostRates|modelCostRates|formatModelRates|isValidRate|formatRate/,
    );
  });

  describe('update status row', () => {
    function statusRowWithUpdate(
      update: FooterUpdate,
      statusLine: StatusLineConfig = hideAllStatusItems(),
    ): FooterStatusRowViewModel {
      const state = foldFooterEvents(createFooterState(), [
        { type: 'update.updated', update },
      ] satisfies readonly FooterEvent[]);
      const row = selectFooterViewModel(state, CLOCK_MS, statusLine).rows.find(
        (candidate) => candidate.kind === 'status',
      );
      if (row?.kind !== 'status') throw new Error('Expected a status row');
      return row;
    }

    it.each([
      [
        'available',
        { version: '0.11.0', state: 'available', percent: null },
        '↑ v0.11.0',
      ],
      [
        'required',
        { version: '0.11.0', state: 'required', percent: null },
        '↑ v0.11.0 required',
      ],
      [
        'downloading with percent',
        { version: '0.11.0', state: 'downloading', percent: 42 },
        '↓ v0.11.0 ▰▰▰▱▱▱▱▱ 42%',
      ],
      [
        'downloading without percent',
        { version: '0.11.0', state: 'downloading', percent: null },
        '↓ v0.11.0',
      ],
      [
        'waiting',
        { version: '0.11.0', state: 'waiting', percent: null },
        '↓ v0.11.0 waiting',
      ],
      [
        'ready',
        { version: '0.11.0', state: 'ready', percent: null },
        '↑ v0.11.0 restart to apply',
      ],
      [
        'failed',
        { version: '0.11.0', state: 'failed', percent: null },
        '↑ v0.11.0 failed',
      ],
    ] as const)('renders %s first in the status row', (_name, update, expected) => {
      expect(statusRowWithUpdate(update).items).toEqual([expected]);
    });

    it.each([
      [0, '↓ v0.11.0 ▱▱▱▱▱▱▱▱ 0%'],
      [100, '↓ v0.11.0 ▰▰▰▰▰▰▰▰ 100%'],
      [-5, '↓ v0.11.0 ▱▱▱▱▱▱▱▱ 0%'],
      [150, '↓ v0.11.0 ▰▰▰▰▰▰▰▰ 100%'],
    ] as const)('clamps percent %s into the eight-cell bar', (percent, expected) => {
      const items = statusRowWithUpdate({
        version: '0.11.0',
        state: 'downloading',
        percent,
      }).items;

      expect(items).toEqual([expected]);
    });

    it('adds no item for an empty update and leaves the status row unchanged', () => {
      const state = foldFooterEvents(createFooterState(), [
        { type: 'update.updated', update: { version: null, state: null, percent: null } },
      ] satisfies readonly FooterEvent[]);
      const base = selectFooterViewModel(createFooterState(), CLOCK_MS).rows.at(-1);
      const updated = selectFooterViewModel(state, CLOCK_MS).rows.at(-1);

      expect(updated).toEqual(base);
    });

    it('adds no item when the version is null', () => {
      const row = statusRowWithUpdate({
        version: null,
        state: 'available',
        percent: null,
      });

      expect(row.items).toEqual([]);
    });

    it('keeps the update under the composer and out of the activity row', () => {
      const state = foldFooterEvents(createFooterState(), [
        {
          type: 'activity.updated',
          activity: {
            phase: 'thinking',
            label: 'Thinking through the change',
            spinnerActive: true,
            spinnerFrame: '⠹',
          },
        },
        {
          type: 'update.updated',
          update: { version: '0.11.0', state: 'downloading', percent: 42 },
        },
      ] satisfies readonly FooterEvent[]);
      const rows = selectFooterViewModel(state, CLOCK_MS).rows;

      expect(rows.map((row) => row.kind)).toEqual(['activity', 'composer', 'status']);
      expect(rows[0]).toMatchObject({
        kind: 'activity',
        primary: '⠹ Thinking through the change',
        indicators: [],
      });
      expect(rows[2]).toMatchObject({
        kind: 'status',
        items: ['↓ v0.11.0 ▰▰▰▱▱▱▱▱ 42%', '▱▱▱▱▱▱▱▱ 0%'],
      });
    });
  });
});
