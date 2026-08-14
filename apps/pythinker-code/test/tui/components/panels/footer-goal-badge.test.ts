import { afterEach, describe, expect, it, vi } from 'vitest';

import { FooterComponent, footerStatusFromAppState } from '#/tui/components/chrome/footer';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  createFooterState,
  reduceFooterState,
  selectStatusBarExtras,
} from '#/tui/runtime/footer/footer-model';
import type { GoalSnapshot } from '@pymodel/pythinker-code-sdk';
import type { AppState } from '#/tui/types';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    model: 'k2',
    workDir: '/tmp/proj',
    sessionId: 'sess_1',
    permissionMode: 'manual',
    planMode: false,
thinkingLevel: 'off',
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 200_000,
    isCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: 'test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    statusLine: DEFAULT_STATUS_LINE_CONFIG,
    availableModels: {},
    ...overrides,
  } as AppState;
}

function goal(overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    goalId: 'g1',
    objective: 'Ship it',
    status: 'active',
    turnsUsed: 7,
    tokensUsed: 1234,
    wallClockMs: 245_000, // 4m05s
    budget: {
      turnBudget: null,
      tokenBudget: null,
      wallClockBudgetMs: null,
    },
    ...overrides,
  } as GoalSnapshot;
}

function goalExtras(
  state: AppState,
  observedAtMs = Date.now(),
  clockMs = Date.now(),
): string {
  const snapshot = state.goal;
  const footerState = reduceFooterState(
    createFooterState(footerStatusFromAppState(state, null)),
    {
      type: 'goal.updated',
      goal:
        snapshot === null || snapshot === undefined
          ? null
          : {
              status: snapshot.status,
              turnsUsed: snapshot.turnsUsed,
              turnBudget: snapshot.budget.turnBudget,
              wallClockMs: snapshot.wallClockMs,
              observedAtMs,
            },
    },
  );
  return selectStatusBarExtras(footerState, clockMs, state.statusLine).join(' ');
}

describe('FooterComponent — goal badge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('omits the badge when there is no goal', () => {
    expect(goalExtras(baseState({ goal: null }))).not.toMatch(/goal/);
  });

  it('shows status, elapsed, and a raw turn count for an unbounded active goal', () => {
    const out = goalExtras(baseState({ goal: goal() }));
    expect(out).toContain('[goal');
    expect(out).toContain('active');
    expect(out).toContain('4m');
    expect(out).toContain('7 turns');
    // No N/M when no turn budget is set.
    expect(out).not.toMatch(/\d+\/\d+ turns/);
  });

  it('keeps counting elapsed time for an active goal between snapshots', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const state = baseState({ goal: goal({ wallClockMs: 0, turnsUsed: 0 }) });
    expect(goalExtras(state, 0, 0)).toContain('0s');
    vi.setSystemTime(2_500);
    expect(goalExtras(state, 0, 2_500)).toContain('3s');
  });

  it('requests a repaint while an active goal timer is visible', () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();

    new FooterComponent(baseState({ goal: goal({ wallClockMs: 0 }) }), onRefresh);

    vi.advanceTimersByTime(1_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows used/limit turns only when a turn budget is set', () => {
    const out = goalExtras(
      baseState({ goal: goal({ budget: { turnBudget: 20, tokenBudget: null, wallClockBudgetMs: null } } as Partial<GoalSnapshot>) }),
    );
    expect(out).toContain('7/20 turns');
  });

  it('shows a paused badge', () => {
    expect(goalExtras(baseState({ goal: goal({ status: 'paused' }) }))).toContain('paused');
  });

  it('shows a blocked badge (resumable, still present)', () => {
    const out = goalExtras(baseState({ goal: goal({ status: 'blocked' }) }));
    expect(out).toContain('[goal');
    expect(out).toContain('blocked');
  });

  it('hides the badge for a completed goal', () => {
    expect(goalExtras(baseState({ goal: goal({ status: 'complete' }) }))).not.toMatch(/goal/);
  });

  it('clears selection when the selected goal disappears', () => {
    const footer = new FooterComponent(baseState({ goal: goal() }));
    footer.selectFirst();
    expect(footer.selectedActionId()).toBe('goal');

    footer.setState(baseState({ goal: null }));

    expect(footer.selectedActionId()).toBeNull();
  });

  it('singularizes a single turn', () => {
    const out = goalExtras(baseState({ goal: goal({ turnsUsed: 1 }) }));
    expect(out).toContain('1 turn');
    expect(out).not.toContain('1 turns');
  });
});
