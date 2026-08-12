import { describe, expect, it } from 'vitest';

import { FooterComponent } from '#/tui/components/chrome/footer';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  createFooterState,
  reduceFooterState,
  selectStatusBarExtras,
} from '#/tui/runtime/footer/footer-model';
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

function backgroundExtras(bashTasks: number, agentTasks: number): string {
  const state = reduceFooterState(createFooterState(), {
    type: 'background-counts.updated',
    counts: { bashTasks, agentTasks },
  });
  return selectStatusBarExtras(state, Date.now(), DEFAULT_STATUS_LINE_CONFIG).join(' ');
}

describe('FooterComponent — background task / agent badges', () => {
  it('omits both badges when counts are 0', () => {
    const footer = new FooterComponent(baseState());
    expect(footer.actionItems()).toEqual([]);
    expect(backgroundExtras(0, 0)).toBe('▱▱▱▱▱▱▱▱ 0%');
  });

  it('renders the task badge alone when only bash tasks are running', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 0 });
    const out = backgroundExtras(1, 0);
    expect(out).toMatch(/\[1 task running\]/u);
    expect(out).not.toMatch(/agents? running/u);
  });

  it('renders the agent badge alone when only agent tasks are running', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 0, agentTasks: 1 });
    const out = backgroundExtras(0, 1);
    expect(out).toMatch(/\[1 agent running\]/u);
    expect(out).not.toMatch(/tasks? running/u);
  });

  it('renders both badges side by side when both are non-zero', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 2, agentTasks: 3 });
    const out = backgroundExtras(2, 3);
    expect(out).toMatch(/\[2 tasks running\]/);
    expect(out).toMatch(/\[3 agents running\]/);
    // Task badge appears before agent badge in the line.
    expect(out.indexOf('2 tasks')).toBeLessThan(out.indexOf('3 agents'));
  });

  it('pluralizes correctly across both badges', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 1 });
    const out = backgroundExtras(1, 1);
    expect(out).toMatch(/\[1 task running\]/);
    expect(out).toMatch(/\[1 agent running\]/);
  });

  it('updates badges live via setBackgroundCounts', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 2, agentTasks: 1 });
    expect(footer.actionItems().map((item) => item.id)).toEqual(['shell-tasks', 'agents']);
    footer.setBackgroundCounts({ bashTasks: 0, agentTasks: 0 });
    expect(footer.actionItems()).toEqual([]);
  });

  it('clears selection when the selected task badge disappears', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 1, agentTasks: 1 });
    footer.selectFirst();
    expect(footer.selectedActionId()).toBe('shell-tasks');

    footer.setBackgroundCounts({ bashTasks: 0, agentTasks: 1 });

    expect(footer.selectedActionId()).toBeNull();
  });

  it('clamps negative counts to 0', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: -5, agentTasks: -2 });
    expect(footer.actionItems()).toEqual([]);
  });

  it('does not render status badges in the footer at any width', () => {
    const footer = new FooterComponent(baseState());
    footer.setBackgroundCounts({ bashTasks: 4, agentTasks: 3 });
    expect(footer.render(20)).toEqual([]);
  });
});
