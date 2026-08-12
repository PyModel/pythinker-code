import { visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FooterComponent, footerStatusFromAppState } from '#/tui/components/chrome/footer';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  createFooterState,
  foldFooterEvents,
  selectFooterViewModel,
} from '#/tui/runtime/footer/footer-model';
import type { AppState } from '#/tui/types';
import type { GitStatusCache } from '#/utils/git/git-status';

const gitMocks = vi.hoisted(() => {
  const onChangeCallbacks: Array<() => void> = [];
  const createGitStatusCache = vi.fn(
    (
      _workDir: string,
      options: { readonly onChange?: () => void } = {},
    ): GitStatusCache => {
      if (options.onChange !== undefined) {
        onChangeCallbacks.push(options.onChange);
      }
      return { getStatus: () => null };
    },
  );
  return { createGitStatusCache, onChangeCallbacks };
});

vi.mock('../../../../src/utils/git/git-status', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../src/utils/git/git-status.js')
  >('../../../../src/utils/git/git-status.js');
  return {
    ...actual,
    createGitStatusCache: gitMocks.createGitStatusCache,
  };
});

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

const appState: AppState = {
  version: '1.2.3',
  workDir: '/Users/example/work/pythinker-code',
  sessionId: 'ses-1',
  sessionTitle: null,
  model: 'DeepSeek V4 Flash',
  permissionMode: 'manual',
  thinkingLevel: 'max',
  contextUsage: 0.05,
  contextTokens: 0,
  maxContextTokens: 0,
  isCompacting: false,
  isReplaying: false,
  streamingPhase: 'composing',
  streamingStartTime: Date.parse('2026-08-02T00:00:00.000Z'),
  planMode: false,
  dynamicWorkflowMode: true,
  theme: 'dark',
  editorCommand: null,
  notifications: { enabled: true, condition: 'unfocused' },
  upgrade: { autoInstall: true },
  statusLine: DEFAULT_STATUS_LINE_CONFIG,
  availableModels: {},
  availableProviders: {},
  mcpServersSummary: null,
};

function statusLine(
  overrides: Partial<AppState['statusLine']> = {},
): AppState['statusLine'] {
  return { ...DEFAULT_STATUS_LINE_CONFIG, ...overrides };
}

const activeGoal: NonNullable<AppState['goal']> = {
  goalId: 'goal-1',
  objective: 'Ship it',
  status: 'active',
  turnsUsed: 1,
  tokensUsed: 0,
  wallClockMs: 0,
  budget: {
    turnBudget: null,
    tokenBudget: null,
    wallClockBudgetMs: null,
    remainingTokens: null,
    remainingTurns: null,
    remainingWallClockMs: null,
    tokenBudgetReached: false,
    turnBudgetReached: false,
    wallClockBudgetReached: false,
    overBudget: false,
  },
};

describe('FooterComponent', () => {
  const previousChalkLevel = chalk.level;

  beforeEach(() => {
    chalk.level = 3;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T00:04:12.000Z'));
    gitMocks.createGitStatusCache.mockClear();
    gitMocks.onChangeCallbacks.length = 0;
  });

  afterEach(() => {
    chalk.level = previousChalkLevel;
    vi.useRealTimers();
  });

  it('does not render shared status rows', () => {
    const footer = new FooterComponent(appState);

    expect(footer.render(160)).toEqual([]);
  });

  it('renders validation rows but suppresses activity and shared status rows', () => {
    const footer = new FooterComponent(appState);
    const activity = selectFooterViewModel(
      foldFooterEvents(createFooterState(), [
        {
          type: 'activity.updated',
          activity: {
            phase: 'waiting',
            label: 'Waiting for response',
            spinnerActive: true,
            spinnerFrame: '⠋',
          },
        },
      ]),
      Date.now(),
      DEFAULT_STATUS_LINE_CONFIG,
    );
    footer.setViewModel(activity);

    expect(footer.render(120).map(stripAnsi)).toEqual([]);

    const validation = selectFooterViewModel(
      foldFooterEvents(createFooterState(), [
        {
          type: 'validation.updated',
          validation: { level: 'error', message: 'Fix the request' },
        },
      ]),
      Date.now(),
      DEFAULT_STATUS_LINE_CONFIG,
    );
    footer.setViewModel(validation);

    expect(footer.render(120).map(stripAnsi)).toEqual(['error: Fix the request']);
  });

  it('omits elapsed for an idle workflow after its completed turn', () => {
    const completedWorkflow = footerStatusFromAppState(
      { ...appState, streamingPhase: 'idle' },
      null,
    );
    const missingStart = footerStatusFromAppState(
      { ...appState, streamingPhase: 'waiting', streamingStartTime: 0 },
      null,
    );

    expect(completedWorkflow.elapsedMs).toBeNull();
    expect(missingStart.elapsedMs).toBeNull();
  });

  it('refreshes active elapsed with the existing footer interval and stops when idle', () => {
    const onRefresh = vi.fn();
    const footer = new FooterComponent(
      { ...appState, streamingPhase: 'waiting' },
      onRefresh,
    );

    vi.advanceTimersByTime(3_000);
    expect(onRefresh).toHaveBeenCalledTimes(3);

    footer.syncAppState({ ...appState, streamingPhase: 'idle' });
    vi.advanceTimersByTime(2_000);
    expect(onRefresh).toHaveBeenCalledTimes(3);

    footer.dispose();
  });

  it('uses one footer freshness interval when goal and elapsed are active', () => {
    const onRefresh = vi.fn();
    const footer = new FooterComponent(
      { ...appState, goal: activeGoal, streamingPhase: 'waiting' },
      onRefresh,
    );

    vi.advanceTimersByTime(10_000);
    expect(onRefresh).toHaveBeenCalledTimes(10);

    footer.dispose();
    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(10);
  });

  it('keeps the shared timer only while a visible goal or elapsed display needs it', () => {
    const onRefresh = vi.fn();
    const activeState = {
      ...appState,
      goal: activeGoal,
      streamingPhase: 'waiting' as const,
    };
    const footer = new FooterComponent(activeState, onRefresh);

    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    footer.syncAppState({
      ...activeState,
      statusLine: statusLine({ showGoal: false }),
    });
    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);

    footer.syncAppState({
      ...activeState,
      statusLine: statusLine({ showElapsed: false }),
    });
    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(3);

    footer.syncAppState({
      ...activeState,
      statusLine: statusLine({ showGoal: false, showElapsed: false }),
    });
    vi.advanceTimersByTime(2_000);
    expect(onRefresh).toHaveBeenCalledTimes(3);

    footer.syncAppState({
      ...activeState,
      statusLine: statusLine({ showGoal: false }),
    });
    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(4);

    footer.dispose();
  });

  it('keeps hidden goal and background badges out of footer actions and selection', () => {
    const footer = new FooterComponent({ ...appState, goal: activeGoal });
    footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 1 });

    expect(footer.actionItems().map((item) => item.id)).toEqual([
      'goal',
      'shell-tasks',
      'agents',
    ]);
    footer.selectFirst();
    expect(footer.selectedActionId()).toBe('goal');

    footer.syncAppState({
      ...appState,
      goal: activeGoal,
      statusLine: statusLine({ showGoal: false }),
    });
    expect(footer.selectedActionId()).toBeNull();
    expect(footer.actionItems().map((item) => item.id)).toEqual([
      'shell-tasks',
      'agents',
    ]);

    footer.selectFirst();
    expect(footer.selectedActionId()).toBe('shell-tasks');
    footer.syncAppState({
      ...appState,
      goal: activeGoal,
      statusLine: statusLine({
        showGoal: false,
        showBackgroundTasks: false,
      }),
    });
    expect(footer.selectedActionId()).toBeNull();
    expect(footer.actionItems()).toEqual([]);

    footer.dispose();
  });

  it('keeps fallback transient hints visible when every status item is hidden', () => {
    const footer = new FooterComponent({
      ...appState,
      statusLine: {
        showModel: false,
        showEffort: false,
        showTokenSpeed: false,
        showContextBar: false,
        showGit: false,
        showModes: false,
        showElapsed: false,
        showGoal: false,
        showBackgroundTasks: false,
      },
    });
    footer.setTransientHint('Press Ctrl-C again to exit');

    const rows = footer.render(40).map(stripAnsi);
    expect(rows).toEqual(['Press Ctrl-C again to exit']);
    expect(rows.every((row) => visibleWidth(row) <= 40)).toBe(true);

    footer.dispose();
  });

  it('does not query a retained Git cache after visibility turns off', () => {
    const getStatus = vi.fn(() => null);
    gitMocks.createGitStatusCache.mockImplementationOnce(() => ({ getStatus }));
    const state: AppState = {
      ...appState,
      statusLine: statusLine({ showGit: true }),
    };
    const footer = new FooterComponent(state);

    expect(footer.getGitStatus()).toBeNull();
    const visibleQueryCount = getStatus.mock.calls.length;
    expect(visibleQueryCount).toBeGreaterThan(0);

    state.statusLine.showGit = false;
    expect(footer.getGitStatus()).toBeNull();
    expect(getStatus).toHaveBeenCalledTimes(visibleQueryCount);

    footer.dispose();
  });

  it('avoids Git cache work while hidden and recreates usable status when re-enabled', () => {
    const onRefresh = vi.fn();
    gitMocks.createGitStatusCache.mockImplementation(
      (workDir, options: { readonly onChange?: () => void } = {}) => {
        if (options.onChange !== undefined) {
          gitMocks.onChangeCallbacks.push(options.onChange);
        }
        return {
          getStatus: () => ({
            branch: workDir.endsWith('second') ? 'second' : 'main',
            dirty: false,
            ahead: 0,
            behind: 0,
            diffAdded: 0,
            diffDeleted: 0,
            pullRequest: null,
          }),
        };
      },
    );
    const hiddenState = {
      ...appState,
      statusLine: statusLine({ showGit: false }),
    };
    const footer = new FooterComponent(hiddenState, onRefresh);

    expect(gitMocks.createGitStatusCache).not.toHaveBeenCalled();
    expect(footer.getGitStatus()).toBeNull();

    footer.syncAppState({
      ...hiddenState,
      statusLine: statusLine({ showGit: true }),
    });
    expect(gitMocks.createGitStatusCache).toHaveBeenCalledTimes(1);
    expect(footer.getGitStatus()?.branch).toBe('main');

    footer.syncAppState({
      ...hiddenState,
      workDir: '/tmp/second',
      statusLine: statusLine({ showGit: true }),
    });
    expect(gitMocks.createGitStatusCache).toHaveBeenCalledTimes(2);
    expect(footer.getGitStatus()?.branch).toBe('second');

    const staleOnChange = gitMocks.onChangeCallbacks.at(-1);
    footer.syncAppState(hiddenState);
    onRefresh.mockClear();
    staleOnChange?.();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(footer.getGitStatus()).toBeNull();

    footer.dispose();
  });
});
