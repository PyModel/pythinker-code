/**
 * Footer/status bar — a renderer-neutral operational status row for pi-tui.
 * The editor owns the composer row and the activity pane owns legacy activity.
 * This component renders validation and the shared footer status row beneath it.
 */

import type { Component } from '@earendil-works/pi-tui';
import { truncateToWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';

import {
  createFooterState,
  reduceFooterState,
  selectFooterViewModel,
  type FooterBackgroundCounts,
  type FooterGitStatus,
  type FooterGoal,
  type FooterState,
  type FooterStatus,
  type FooterViewModel,
  type FooterViewModelRow,
} from '#/tui/runtime/footer/footer-model';
import type { AppState } from '#/tui/types';
import {
  createGitStatusCache,
  formatGitBadgeBase,
  formatPullRequestBadge,
  type GitStatus,
  type GitStatusCache,
} from '#/utils/git/git-status';

const FOOTER_FRESHNESS_INTERVAL_MS = 1_000;

export type FooterActionId = 'goal' | 'shell-tasks' | 'agents';

export interface FooterActionItem {
  readonly id: FooterActionId;
  readonly label: string;
}

/**
 * Maps live app state into the shared footer reducer's status fields. Token
 * speed is event-owned and intentionally omitted so status refreshes retain it.
 */
export function footerStatusFromAppState(
  state: AppState,
  git: GitStatus | null,
  now = Date.now(),
): Partial<FooterStatus> {
  const model = state.availableModels[state.model];
  return {
    model: model?.displayName ?? model?.model ?? state.model,
    thinkingLevel: state.thinkingLevel,
    cwd: state.workDir,
    homeDir: process.env['HOME'] ?? null,
    git: footerGitStatus(git),
    permissionMode: state.permissionMode,
    planMode: state.planMode,
    dynamicWorkflowMode: state.dynamicWorkflowMode,
    // Only surface fast mode when the active model supports it.
    fastMode: state.fastMode === true && state.fastModeSupported === true,
    contextUsage: state.contextUsage,
    contextTokens: state.contextTokens,
    maxContextTokens: state.maxContextTokens,
    elapsedMs: hasActiveElapsed(state) ? Math.max(0, now - state.streamingStartTime) : null,
  };
}

function hasActiveElapsed(
  state: Pick<AppState, 'streamingPhase' | 'streamingStartTime'>,
): boolean {
  return state.streamingStartTime > 0 && state.streamingPhase !== 'idle';
}

function footerGitStatus(status: GitStatus | null): FooterGitStatus | null {
  if (status === null) return null;
  return {
    branch: status.branch,
    dirty: status.dirty,
    ahead: status.ahead,
    behind: status.behind,
    diffAdded: status.diffAdded,
    diffDeleted: status.diffDeleted,
    pullRequest:
      status.pullRequest === null ? null : { number: status.pullRequest.number },
  };
}

/** Retained for the legacy git-status caller and its coloured PR link. */
export function formatFooterGitBadge(status: GitStatus, colors: { readonly textDim: string; readonly primary: string }): string {
  const base = chalk.hex(colors.textDim)(formatGitBadgeBase(status));
  if (status.pullRequest === null) return base;

  const pullRequest = chalk.hex(colors.primary)(
    formatPullRequestBadge(status.pullRequest, { linkPullRequest: true }),
  );
  return `${base} ${pullRequest}`;
}

/**
 * Footer chrome: renders the shared footer status rows and keeps the git
 * cache, goal clock, and freshness timer aligned with the reducer-owned model.
 */
export class FooterComponent implements Component {
  private state: AppState;
  private onRefresh: () => void;
  private gitCache: GitStatusCache | null = null;
  private gitCacheWorkDir: string;
  private gitCacheGeneration = 0;
  private fallbackState: FooterState;
  private viewModel: FooterViewModel;
  private hasSharedViewModel = false;
  private goalSnapshotKey: string | null = null;
  private goalObservedAtMs = Date.now();
  private freshnessTimer: ReturnType<typeof setInterval> | null = null;
  private backgroundBashTaskCount = 0;
  private backgroundAgentCount = 0;
  private selectedAction: FooterActionId | null = null;

  constructor(state: AppState, onRefresh: () => void = () => {}) {
    this.state = state;
    this.onRefresh = onRefresh;
    this.gitCacheWorkDir = state.workDir;
    this.syncGitCache();
    this.syncGoalClock(state.goal);
    this.syncFooterFreshnessTimer();
    this.fallbackState = createFooterState(footerStatusFromAppState(state, this.getGitStatus()));
    this.fallbackState = reduceFooterState(this.fallbackState, {
      type: 'goal.updated',
      goal: this.footerGoal(),
    });
    this.viewModel = selectFooterViewModel(
      this.fallbackState,
      Date.now(),
      this.state.statusLine,
    );
  }

  /** Lets the host turn cache, goal, and elapsed freshness into one reducer projection. */
  setRefreshHandler(onRefresh: () => void): void {
    this.onRefresh = onRefresh;
  }

  setState(state: AppState): void {
    this.syncAppState(state);
    this.updateFallback({
      type: 'status.updated',
      changes: footerStatusFromAppState(state, this.getGitStatus()),
    });
    this.updateFallback({ type: 'goal.updated', goal: this.footerGoal() });
  }

  /** Updates cache/timer/action inputs without independently folding production footer state. */
  syncAppState(state: AppState): void {
    this.state = state;
    this.syncGitCache();
    this.syncGoalClock(state.goal);
    this.syncFooterFreshnessTimer();
    this.clearStaleSelection();
  }

  /** Receives the one reducer-derived model from the presentation host. */
  setViewModel(viewModel: FooterViewModel): void {
    this.viewModel = viewModel;
    this.hasSharedViewModel = true;
  }

  getGitStatus(): GitStatus | null {
    if (!this.state.statusLine.showGit) return null;
    return this.gitCache?.getStatus() ?? null;
  }

  setTransientHint(hint: string | null): void {
    this.updateFallback({ type: 'transient-hint.updated', hint });
  }

  setBackgroundCounts(counts: FooterBackgroundCounts): void {
    this.syncActionCounts(counts);
    this.updateFallback({
      type: 'background-counts.updated',
      counts: {
        bashTasks: this.backgroundBashTaskCount,
        agentTasks: this.backgroundAgentCount,
      },
    });
    this.clearStaleSelection();
  }

  /** Keeps footer keyboard actions aligned with the reducer-owned counts. */
  syncActionCounts(counts: FooterBackgroundCounts): void {
    this.backgroundBashTaskCount = Math.max(0, counts.bashTasks);
    this.backgroundAgentCount = Math.max(0, counts.agentTasks);
    this.clearStaleSelection();
  }

  setTokenSpeed(tokensPerSecond: number | null, estimated = false): void {
    const tokenSpeed =
      tokensPerSecond !== null && Number.isFinite(tokensPerSecond) && tokensPerSecond >= 0
        ? tokensPerSecond
        : null;
    const tokenSpeedEstimated = tokenSpeed !== null && estimated;
    if (
      this.fallbackState.status.tokenSpeed === tokenSpeed &&
      this.fallbackState.status.tokenSpeedEstimated === tokenSpeedEstimated
    ) {
      return;
    }
    this.updateFallback({
      type: 'status.updated',
      changes: { tokenSpeed, tokenSpeedEstimated },
    });
    this.onRefresh();
  }

  actionItems(): readonly FooterActionItem[] {
    const items: FooterActionItem[] = [];
    if (this.state.statusLine.showGoal && hasGoalBadge(this.state.goal)) {
      items.push({ id: 'goal', label: 'Goal' });
    }
    if (this.state.statusLine.showBackgroundTasks && this.backgroundBashTaskCount > 0) {
      items.push({ id: 'shell-tasks', label: 'Shell tasks' });
    }
    if (this.state.statusLine.showBackgroundTasks && this.backgroundAgentCount > 0) {
      items.push({ id: 'agents', label: 'Agents' });
    }
    return items;
  }

  selectedActionId(): FooterActionId | null {
    return this.selectedAction;
  }

  selectFirst(): void {
    this.selectAt(0);
  }

  selectNext(): void {
    const items = this.actionItems();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.id === this.selectedAction);
    this.selectAt((current + 1 + items.length) % items.length);
  }

  selectPrevious(): void {
    const items = this.actionItems();
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.id === this.selectedAction);
    this.selectAt((current - 1 + items.length) % items.length);
  }

  clearSelection(): void {
    if (this.selectedAction === null) return;
    this.selectedAction = null;
    this.onRefresh();
  }

  dispose(): void {
    if (this.freshnessTimer !== null) {
      clearInterval(this.freshnessTimer);
      this.freshnessTimer = null;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const viewModel = this.hasSharedViewModel
      ? this.viewModel
      : selectFooterViewModel(
          this.fallbackState,
          Date.now(),
          this.state.statusLine,
        );
    return viewModel.rows.flatMap((row) => {
      if (row.kind === 'composer' || row.kind === 'status') return [];
      return [truncateToWidth(renderLegacyRow(row), width, '…')];
    });
  }

  private createGitCache(workDir: string): GitStatusCache {
    const generation = this.gitCacheGeneration;
    return createGitStatusCache(workDir, {
      onChange: () => {
        if (
          generation !== this.gitCacheGeneration ||
          !this.state.statusLine.showGit
        ) {
          return;
        }
        this.onRefresh();
      },
    });
  }

  private syncGitCache(): void {
    if (!this.state.statusLine.showGit) {
      this.gitCache = null;
      this.gitCacheWorkDir = this.state.workDir;
      this.gitCacheGeneration += 1;
      return;
    }
    if (
      this.gitCache !== null &&
      this.gitCacheWorkDir === this.state.workDir
    ) {
      return;
    }
    this.gitCacheWorkDir = this.state.workDir;
    this.gitCacheGeneration += 1;
    this.gitCache = this.createGitCache(this.state.workDir);
  }

  private updateFallback(event: Parameters<typeof reduceFooterState>[1]): void {
    this.hasSharedViewModel = false;
    this.fallbackState = reduceFooterState(this.fallbackState, event);
    this.viewModel = selectFooterViewModel(
      this.fallbackState,
      Date.now(),
      this.state.statusLine,
    );
  }

  private syncGoalClock(goal: AppState['goal']): void {
    const key = goalSnapshotKey(goal);
    if (key === this.goalSnapshotKey) return;
    this.goalSnapshotKey = key;
    this.goalObservedAtMs = Date.now();
  }

  private syncFooterFreshnessTimer(): void {
    const needsGoalFreshness =
      this.state.statusLine.showGoal && this.state.goal?.status === 'active';
    const needsElapsedFreshness =
      this.state.statusLine.showElapsed && hasActiveElapsed(this.state);
    if (needsGoalFreshness || needsElapsedFreshness) {
      if (this.freshnessTimer !== null) return;
      this.freshnessTimer = setInterval(
        () => this.onRefresh(),
        FOOTER_FRESHNESS_INTERVAL_MS,
      );
      this.freshnessTimer.unref?.();
      return;
    }
    if (this.freshnessTimer !== null) {
      clearInterval(this.freshnessTimer);
      this.freshnessTimer = null;
    }
  }

  private footerGoal(): FooterGoal | null {
    const goal = this.state.goal;
    if (goal === null || goal === undefined) return null;
    return {
      status: goal.status,
      turnsUsed: goal.turnsUsed,
      turnBudget: goal.budget.turnBudget,
      wallClockMs: goal.wallClockMs,
      observedAtMs: this.goalObservedAtMs,
    };
  }

  private selectAt(index: number): void {
    const action = this.actionItems()[index];
    if (action === undefined || this.selectedAction === action.id) return;
    this.selectedAction = action.id;
    this.onRefresh();
  }

  private clearStaleSelection(): void {
    if (this.selectedAction !== null && !this.actionItems().some((item) => item.id === this.selectedAction)) {
      this.clearSelection();
    }
  }
}

function renderLegacyRow(
  row: Exclude<
    FooterViewModelRow,
    { readonly kind: 'composer' } | { readonly kind: 'status' }
  >,
): string {
  switch (row.kind) {
    case 'activity':
      return row.primary.length === 0
        ? row.indicators.join('  ')
        : row.indicators.length === 0
          ? row.primary
          : `${row.primary}  ${row.indicators.join('  ')}`;
    case 'validation':
      return row.level === 'info' ? row.message : `${row.level}: ${row.message}`;
  }
}

function hasGoalBadge(goal: AppState['goal']): boolean {
  return goal?.status === 'active' || goal?.status === 'paused' || goal?.status === 'blocked';
}

function goalSnapshotKey(goal: AppState['goal']): string | null {
  if (goal === null || goal === undefined) return null;
  return [
    goal.goalId,
    goal.status,
    goal.terminalReason ?? '',
    String(goal.turnsUsed),
    String(goal.tokensUsed),
    String(goal.wallClockMs),
    String(goal.budget.tokenBudget),
    String(goal.budget.turnBudget),
    String(goal.budget.wallClockBudgetMs),
  ].join('\u0000');
}
