/**
 * Renderer-neutral split-footer model.
 *
 * The footer is a short operational hierarchy:
 *   1. an optional validation or visible activity row
 *   2. a typed composer slot (the input renderer is intentionally supplied later)
 *   3. model, runtime context, git, modes, elapsed time, and lower-priority counters
 *   4. an optional YOLO indicator beneath the model row
 *
 * This module has no renderer, terminal, theme, I/O, or ambient-clock dependency.
 * Callers pass the current clock value to `selectFooterViewModel`.
 */

import type { StatusLineConfig } from '#/tui/config';
import { shortEffortLabel } from '#/tui/utils/thinking-levels';

export type FooterActivityPhase =
  | 'hidden'
  | 'waiting'
  | 'thinking'
  | 'composing'
  | 'tool';

export interface FooterActivity {
  readonly phase: FooterActivityPhase;
  readonly label: string | null;
  readonly spinnerActive: boolean;
  readonly spinnerFrame: string;
}

export type FooterValidationLevel = 'info' | 'warning' | 'error';

export interface FooterValidation {
  readonly level: FooterValidationLevel;
  readonly message: string;
}

export interface FooterQueue {
  readonly count: number;
  readonly canSteerImmediately: boolean;
}

export type FooterTodoStatus = 'pending' | 'in_progress' | 'done';

export interface FooterTodoItem {
  readonly title: string;
  readonly status: FooterTodoStatus;
}

export type FooterGoalStatus = 'active' | 'paused' | 'blocked' | 'complete';

export interface FooterGoal {
  readonly status: FooterGoalStatus;
  readonly turnsUsed: number;
  readonly turnBudget: number | null;
  readonly wallClockMs: number;
  /**
   * Clock value at which `wallClockMs` was observed. Active goals add elapsed
   * time since this value; paused and blocked goals do not.
   */
  readonly observedAtMs: number;
}

export interface FooterBackgroundCounts {
  readonly bashTasks: number;
  readonly agentTasks: number;
}

export interface FooterSubagentCounts {
  readonly active: number;
  readonly queued: number;
  readonly completed: number;
  readonly failed: number;
}

export interface FooterCompaction {
  readonly active: boolean;
  readonly label: string | null;
}

export interface FooterTerminalProgress {
  readonly active: boolean;
  readonly percent: number | null;
  readonly label: string | null;
}

export type FooterBtwPhase = 'closed' | 'running' | 'done' | 'failed';

export interface FooterBtwState {
  readonly phase: FooterBtwPhase;
  readonly turnCount: number;
}

export type FooterPermissionMode = 'manual' | 'auto' | 'yolo';

export interface FooterPullRequest {
  readonly number: number;
}

export interface FooterGitStatus {
  readonly branch: string;
  readonly dirty: boolean;
  readonly ahead: number;
  readonly behind: number;
  readonly diffAdded: number;
  readonly diffDeleted: number;
  readonly pullRequest: FooterPullRequest | null;
}

export interface FooterStatus {
  readonly model: string;
  /** Accumulated session cost reported by the agent. */
  readonly sessionSpendUsd: number | undefined;
  /** Resolved thinking effort level; 'off' means thinking is disabled. */
  readonly thinkingLevel: string;
  readonly cwd: string;
  /** Supplied explicitly so cwd shortening remains independent of process.env. */
  readonly homeDir: string | null;
  readonly git: FooterGitStatus | null;
  readonly permissionMode: FooterPermissionMode;
  readonly planMode: boolean;
  readonly dynamicWorkflowMode: boolean;
  /** Fast mode requested and supported; shown as `↯ fast` beside the model. */
  readonly fastMode: boolean;
  readonly contextUsage: number;
  readonly contextTokens: number | null;
  readonly maxContextTokens: number | null;
  readonly tokenSpeed: number | null;
  readonly tokenSpeedEstimated: boolean;
  /** Null when the runtime has no active streaming start. */
  readonly elapsedMs: number | null;
}

export interface FooterComposerState {
  readonly textLength: number;
  readonly placeholder: string;
}

export interface FooterState {
  readonly activity: FooterActivity;
  readonly validation: FooterValidation | null;
  readonly queue: FooterQueue;
  readonly todos: readonly FooterTodoItem[];
  readonly goal: FooterGoal | null;
  readonly background: FooterBackgroundCounts;
  readonly subagents: FooterSubagentCounts;
  readonly compaction: FooterCompaction;
  readonly transientHint: string | null;
  readonly terminalProgress: FooterTerminalProgress;
  readonly btw: FooterBtwState;
  readonly status: FooterStatus;
  readonly composer: FooterComposerState;
}

export type FooterEvent =
  | { readonly type: 'activity.updated'; readonly activity: FooterActivity }
  | {
      readonly type: 'validation.updated';
      readonly validation: FooterValidation | null;
    }
  | { readonly type: 'queue.updated'; readonly queue: FooterQueue }
  | { readonly type: 'todo.updated'; readonly todos: readonly FooterTodoItem[] }
  | { readonly type: 'goal.updated'; readonly goal: FooterGoal | null }
  | {
      readonly type: 'background-counts.updated';
      readonly counts: FooterBackgroundCounts;
    }
  | {
      readonly type: 'subagents.updated';
      readonly counts: FooterSubagentCounts;
    }
  | {
      readonly type: 'compaction.updated';
      readonly compaction: FooterCompaction;
    }
  | { readonly type: 'transient-hint.updated'; readonly hint: string | null }
  | {
      readonly type: 'terminal-progress.updated';
      readonly progress: FooterTerminalProgress;
    }
  | { readonly type: 'btw.updated'; readonly btw: FooterBtwState }
  | { readonly type: 'status.updated'; readonly changes: Partial<FooterStatus> }
  | {
      readonly type: 'composer.updated';
      readonly composer: FooterComposerState;
    };

export interface FooterActivityRowViewModel {
  readonly kind: 'activity';
  readonly primary: string;
  readonly spinnerActive: boolean;
  readonly indicators: readonly string[];
}

export interface FooterComposerSlotViewModel {
  readonly kind: 'composer-slot';
  readonly marker: string;
  readonly placeholder: string;
  readonly textLength: number;
}

export interface FooterComposerRowViewModel {
  readonly kind: 'composer';
  readonly slot: FooterComposerSlotViewModel;
}

export interface FooterStatusRowViewModel {
  readonly kind: 'status';
  readonly items: readonly string[];
  /** Highlights a high-risk status row without coupling the model to a renderer. */
  readonly emphasis?: 'danger';
  /**
   * Leading segment of the model item, or null when this row has no model item.
   * Named separately so a renderer can tint it without re-parsing the row.
   */
  readonly modelName: string | null;
}

export interface FooterValidationRowViewModel {
  readonly kind: 'validation';
  readonly level: FooterValidationLevel;
  readonly message: string;
}

export type FooterViewModelRow =
  | FooterActivityRowViewModel
  | FooterComposerRowViewModel
  | FooterStatusRowViewModel
  | FooterValidationRowViewModel;

export type FooterViewModelRows = readonly FooterViewModelRow[];

export interface FooterViewModel {
  /** Ordered top-to-bottom rows: optional activity/validation, composer, then status rows. */
  readonly rows: FooterViewModelRows;
}

const DEFAULT_STATUS: FooterStatus = Object.freeze({
  model: '',
  sessionSpendUsd: undefined,
  thinkingLevel: 'off',
  cwd: '',
  homeDir: null,
  git: null,
  permissionMode: 'manual',
  planMode: false,
  dynamicWorkflowMode: false,
  fastMode: false,
  contextUsage: 0,
  contextTokens: null,
  maxContextTokens: null,
  tokenSpeed: null,
  tokenSpeedEstimated: false,
  elapsedMs: null,
});

export function createFooterState(
  status: Partial<FooterStatus> = {},
): FooterState {
  return freezeState({
    activity: {
      phase: 'hidden',
      label: null,
      spinnerActive: false,
      spinnerFrame: '⠋',
    },
    validation: null,
    queue: { count: 0, canSteerImmediately: true },
    todos: [],
    goal: null,
    background: { bashTasks: 0, agentTasks: 0 },
    subagents: { active: 0, queued: 0, completed: 0, failed: 0 },
    compaction: { active: false, label: null },
    transientHint: null,
    terminalProgress: { active: false, percent: null, label: null },
    btw: { phase: 'closed', turnCount: 0 },
    status: { ...DEFAULT_STATUS, ...status },
    composer: { textLength: 0, placeholder: 'Composer' },
  });
}

export const createInitialFooterState = createFooterState;

export function reduceFooterState(
  state: FooterState,
  event: FooterEvent,
): FooterState {
  switch (event.type) {
    case 'activity.updated':
      return freezeState({ ...state, activity: event.activity });
    case 'validation.updated':
      return freezeState({ ...state, validation: event.validation });
    case 'queue.updated':
      return freezeState({ ...state, queue: event.queue });
    case 'todo.updated':
      return freezeState({ ...state, todos: event.todos });
    case 'goal.updated':
      return freezeState({ ...state, goal: event.goal });
    case 'background-counts.updated':
      return freezeState({ ...state, background: event.counts });
    case 'subagents.updated':
      return freezeState({ ...state, subagents: event.counts });
    case 'compaction.updated':
      return freezeState({ ...state, compaction: event.compaction });
    case 'transient-hint.updated':
      return freezeState({ ...state, transientHint: event.hint });
    case 'terminal-progress.updated':
      return freezeState({ ...state, terminalProgress: event.progress });
    case 'btw.updated':
      return freezeState({ ...state, btw: event.btw });
    case 'status.updated':
      return freezeState({
        ...state,
        status: { ...state.status, ...event.changes },
      });
    case 'composer.updated':
      return freezeState({ ...state, composer: event.composer });
  }
}

export const footerReducer = reduceFooterState;

export function foldFooterEvents(
  initialState: FooterState,
  events: readonly FooterEvent[],
): FooterState {
  return events.reduce(reduceFooterState, initialState);
}

export function selectFooterViewModel(
  state: FooterState,
  clockMs: number,
  statusLine: StatusLineConfig,
): FooterViewModel {
  const optional = selectOptionalRow(state);
  const composer = Object.freeze<FooterComposerRowViewModel>({
    kind: 'composer',
    slot: Object.freeze({
      kind: 'composer-slot',
      marker: '❯',
      placeholder: state.composer.placeholder,
      textLength: nonNegativeInteger(state.composer.textLength),
    }),
  });
  const modelName = normalizeSingleLine(state.status.model);
  const status = Object.freeze<FooterStatusRowViewModel>({
    kind: 'status',
    items: Object.freeze(selectStatusItems(state, clockMs, statusLine)),
    modelName: statusLine.showModel && modelName.length > 0 ? modelName : null,
  });
  const yoloStatus =
    statusLine.showModes && state.status.permissionMode === 'yolo'
      ? Object.freeze<FooterStatusRowViewModel>({
          kind: 'status',
          items: Object.freeze(['yolo']),
          emphasis: 'danger',
          modelName: null,
        })
      : null;
  const statusRows: FooterViewModelRows =
    yoloStatus === null ? [status] : [status, yoloStatus];
  const rows: FooterViewModelRows = Object.freeze(
    optional === null
      ? [composer, ...statusRows]
      : [optional, composer, ...statusRows],
  );
  return Object.freeze({ rows });
}

/** Columns the status row is inset by so it sits under the prompt text, not the `❯`. */
const STATUS_ROW_INDENT = '  ';

/**
 * Single source of status-row text for both the pi-tui footer and the Solid
 * view; they must stay identical because either renderer can be live.
 */
export function formatStatusRow(items: readonly string[]): string {
  const [primary, ...rest] = items;
  if (primary === undefined) return '';
  const body = rest.length === 0 ? primary : `${primary}    ${rest.join(' · ')}`;
  return STATUS_ROW_INDENT + body;
}

function selectOptionalRow(
  state: FooterState,
): FooterActivityRowViewModel | FooterValidationRowViewModel | null {
  const validation = state.validation;
  if (validation !== null) {
    const message = normalizeSingleLine(validation.message);
    if (message.length > 0) {
      return Object.freeze({
        kind: 'validation',
        level: validation.level,
        message,
      });
    }
  }

  const transient = normalizeSingleLine(state.transientHint ?? '');
  if (transient.length > 0) {
    return Object.freeze({ kind: 'validation', level: 'info', message: transient });
  }

  const activity = selectActivityRow(state);
  return activity.primary.length > 0 || activity.indicators.length > 0 ? activity : null;
}

function selectActivityRow(state: FooterState): FooterActivityRowViewModel {
  let primary = '';
  let spinnerActive = false;
  if (state.compaction.active) {
    primary = state.compaction.label?.trim() || 'Compacting context…';
    spinnerActive = true;
  } else if (state.activity.phase !== 'hidden') {
    primary =
      state.activity.label?.trim() ||
      defaultActivityLabel(state.activity.phase);
    spinnerActive = state.activity.spinnerActive;
  } else if (
    state.terminalProgress.active &&
    state.terminalProgress.label !== null
  ) {
    primary = state.terminalProgress.label.trim();
    spinnerActive = true;
  }

  if (spinnerActive && primary.length > 0) {
    const frame = normalizeSingleLine(state.activity.spinnerFrame) || '⠋';
    primary = `${frame} ${primary}`;
  }

  const indicators: string[] = [];
  const progress = formatTerminalProgress(state.terminalProgress);
  if (progress !== null) indicators.push(progress);
  if (state.queue.count > 0) {
    indicators.push(
      `[${String(nonNegativeInteger(state.queue.count))} queued]`,
    );
  }

  const todoBadge = formatTodoBadge(state.todos);
  if (todoBadge !== null) indicators.push(todoBadge);

  const liveSubagents =
    nonNegativeInteger(state.subagents.active) +
    nonNegativeInteger(state.subagents.queued);
  if (liveSubagents > 0) {
    indicators.push(
      `[${String(liveSubagents)} ${plural(liveSubagents, 'subagent')}]`,
    );
  }
  if (state.subagents.failed > 0) {
    indicators.push(
      `[${String(nonNegativeInteger(state.subagents.failed))} failed]`,
    );
  }
  if (state.btw.phase !== 'closed') {
    indicators.push(`[btw ${state.btw.phase}]`);
  }

  return Object.freeze({
    kind: 'activity',
    primary: normalizeSingleLine(primary),
    spinnerActive,
    indicators: Object.freeze(indicators),
  });
}

function selectStatusItems(
  state: FooterState,
  clockMs: number,
  statusLine: StatusLineConfig,
): string[] {
  const items: string[] = [];
  const model = normalizeSingleLine(state.status.model);
  if (statusLine.showModel && model.length > 0) {
    const effortSuffix =
      statusLine.showEffort && state.status.thinkingLevel !== 'off'
        ? ` · ${shortEffortLabel(state.status.thinkingLevel)}`
        : '';
    // Fast rides on the model item and only while mode badges are visible,
    // so it can never appear twice in the row.
    const fastSuffix = statusLine.showModes && state.status.fastMode ? ' · ↯ fast' : '';
    const speed = statusLine.showTokenSpeed ? formatTokenSpeed(state.status) : null;
    items.push(`${model}${effortSuffix}${fastSuffix}${speed === null ? '' : ` · ${speed}`}`);
  }

  if (statusLine.showModel) {
    const spend = formatSessionSpend(state.status.sessionSpendUsd);
    if (spend !== null) items.push(spend);
  }

  if (statusLine.showContextBar) items.push(formatContext(state.status));

  if (statusLine.showGit) {
    const git = formatGitStatus(state.status.git);
    if (git !== null) items.push(git);
  }

  if (statusLine.showModes) {
    const modes: string[] = [];
    if (state.status.dynamicWorkflowMode) modes.push('workflow');
    if (state.status.permissionMode === 'auto') modes.push('auto');
    if (state.status.planMode) modes.push('plan');
    if (modes.length > 0) items.push(modes.join(' '));
  }

  if (statusLine.showElapsed && state.status.elapsedMs !== null) {
    items.push(`elapsed ${formatStatusElapsed(state.status.elapsedMs)}`);
  }

  if (statusLine.showGoal) {
    const goal = formatGoal(state.goal, clockMs);
    if (goal !== null) items.push(goal);
  }

  if (statusLine.showBackgroundTasks) {
    const bashTasks = nonNegativeInteger(state.background.bashTasks);
    if (bashTasks > 0) {
      items.push(`[${String(bashTasks)} ${plural(bashTasks, 'task')} running]`);
    }
    const agentTasks = nonNegativeInteger(state.background.agentTasks);
    if (agentTasks > 0) {
      items.push(
        `[${String(agentTasks)} ${plural(agentTasks, 'agent')} running]`,
      );
    }
  }
  return items;
}

function defaultActivityLabel(phase: FooterActivityPhase): string {
  switch (phase) {
    case 'waiting':
      return 'Waiting…';
    case 'thinking':
      return 'Thinking…';
    case 'composing':
      return 'Composing…';
    case 'tool':
      return 'Using tool…';
    case 'hidden':
      return '';
  }
}

function formatTodoBadge(todos: readonly FooterTodoItem[]): string | null {
  if (todos.length === 0) return null;
  const total = todos.length;
  const done = todos.filter((todo) => todo.status === 'done').length;
  const active = todos.filter((todo) => todo.status === 'in_progress').length;
  if (active > 0)
    return `[todo ${String(done)}/${String(total)} · ${String(active)} active]`;
  return `[todo ${String(done)}/${String(total)}]`;
}

function formatGoal(goal: FooterGoal | null, clockMs: number): string | null {
  if (
    goal === null ||
    (goal.status !== 'active' &&
      goal.status !== 'paused' &&
      goal.status !== 'blocked')
  ) {
    return null;
  }
  const elapsed =
    goal.wallClockMs +
    (goal.status === 'active'
      ? Math.max(0, finiteOrZero(clockMs - goal.observedAtMs))
      : 0);
  const turns =
    goal.turnBudget === null
      ? `${String(nonNegativeInteger(goal.turnsUsed))} ${plural(goal.turnsUsed, 'turn')}`
      : `${String(nonNegativeInteger(goal.turnsUsed))}/${String(nonNegativeInteger(goal.turnBudget))} turns`;
  return `[goal ● ${goal.status} · ${formatElapsed(elapsed)} · ${turns}]`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.round(Math.max(0, finiteOrZero(ms)) / 1_000);
  if (totalSeconds < 60) return `${String(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h${String(minutes % 60)}m`;
}

function formatStatusElapsed(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, finiteOrZero(ms)) / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return totalMinutes < 60 ? clock : `${String(Math.floor(totalMinutes / 60))}:${clock}`;
}

function formatTokenSpeed(status: FooterStatus): string | null {
  const speed = status.tokenSpeed;
  if (speed === null || !Number.isFinite(speed) || speed < 0) return null;
  return `${status.tokenSpeedEstimated ? '~' : ''}${speed.toFixed(1)} t/s`;
}

function formatSessionSpend(spend: number | undefined): string | null {
  if (spend === undefined || !Number.isFinite(spend) || spend <= 0) return null;
  if (spend < 0.000001) return '<$0.000001';
  const roundedCents = spend.toFixed(2);
  return Number(roundedCents) >= 0.01
    ? `$${roundedCents}`
    : `$${spend.toFixed(6).replace(/\.?0+$/, '')}`;
}

function formatTerminalProgress(
  progress: FooterTerminalProgress,
): string | null {
  if (!progress.active) return null;
  const parts = ['progress'];
  if (progress.percent !== null && Number.isFinite(progress.percent)) {
    parts.push(
      `${String(Math.round(Math.min(100, Math.max(0, progress.percent))))}%`,
    );
  }
  const label = normalizeSingleLine(progress.label ?? '');
  if (label.length > 0) parts.push(label);
  return `[${parts.join(' ')}]`;
}

/**
 * Context gauge glyphs, matching the compaction progress bar so the two read as
 * one design. The renderer paints them; this module stays theme-free.
 */
export const CONTEXT_BAR_FILLED = '▰';
export const CONTEXT_BAR_EMPTY = '▱';
const CONTEXT_BAR_CELLS = 8;

/** `▰▰▱▱▱▱▱▱ 18% · 36k/200k` — bar, percentage, then absolute context size. */
function formatContext(status: FooterStatus): string {
  const tokens = status.contextTokens;
  const maxTokens = status.maxContextTokens;
  const known =
    tokens !== null &&
    maxTokens !== null &&
    Number.isFinite(tokens) &&
    Number.isFinite(maxTokens) &&
    maxTokens > 0;

  const percent = clampPercent(
    known
      ? Math.ceil((tokens / maxTokens) * 100)
      : Math.ceil(finiteOrZero(status.contextUsage) * 100),
  );
  const filled = Math.min(CONTEXT_BAR_CELLS, Math.round((percent / 100) * CONTEXT_BAR_CELLS));
  const bar =
    CONTEXT_BAR_FILLED.repeat(filled) + CONTEXT_BAR_EMPTY.repeat(CONTEXT_BAR_CELLS - filled);
  const size = known ? ` · ${formatTokenCount(tokens)}/${formatTokenCount(maxTokens)}` : '';
  return `${bar} ${String(percent)}%${size}`;
}

/** Compact token counts: 900, 36k, 1.2M. */
function formatTokenCount(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));
  if (value >= 1_000_000) return `${trimTrailingZero((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${trimTrailingZero((value / 1_000).toFixed(1))}k`;
  return String(value);
}

function trimTrailingZero(value: string): string {
  return value.endsWith('.0') ? value.slice(0, -2) : value;
}

function formatGitStatus(status: FooterGitStatus | null): string | null {
  if (status === null) return null;
  const branch = normalizeSingleLine(status.branch);
  if (branch.length === 0) return null;
  const details: string[] = [];
  const diff: string[] = [];
  if (status.diffAdded > 0)
    diff.push(`+${String(nonNegativeInteger(status.diffAdded))}`);
  if (status.diffDeleted > 0)
    diff.push(`-${String(nonNegativeInteger(status.diffDeleted))}`);
  if (diff.length > 0) details.push(diff.join(' '));
  else if (status.dirty) details.push('±');
  let sync = '';
  if (status.ahead > 0) sync += `↑${String(nonNegativeInteger(status.ahead))}`;
  if (status.behind > 0)
    sync += `↓${String(nonNegativeInteger(status.behind))}`;
  if (sync.length > 0) details.push(sync);
  const base = details.length === 0 ? branch : `${branch} ${details.join(' ')}`;
  return status.pullRequest === null
    ? base
    : `${base} [PR#${String(nonNegativeInteger(status.pullRequest.number))}]`;
}

function freezeState(state: FooterState): FooterState {
  const todos = Object.freeze(
    state.todos.map((todo) =>
      Object.freeze({ ...todo, title: normalizeSingleLine(todo.title) }),
    ),
  );
  return Object.freeze({
    ...state,
    activity: Object.freeze({ ...state.activity }),
    validation:
      state.validation === null
        ? null
        : Object.freeze({
            ...state.validation,
            message: normalizeSingleLine(state.validation.message),
          }),
    queue: Object.freeze({
      ...state.queue,
      count: nonNegativeInteger(state.queue.count),
    }),
    todos,
    goal: state.goal === null ? null : Object.freeze({ ...state.goal }),
    background: Object.freeze({
      bashTasks: nonNegativeInteger(state.background.bashTasks),
      agentTasks: nonNegativeInteger(state.background.agentTasks),
    }),
    subagents: Object.freeze({
      active: nonNegativeInteger(state.subagents.active),
      queued: nonNegativeInteger(state.subagents.queued),
      completed: nonNegativeInteger(state.subagents.completed),
      failed: nonNegativeInteger(state.subagents.failed),
    }),
    compaction: Object.freeze({ ...state.compaction }),
    terminalProgress: Object.freeze({ ...state.terminalProgress }),
    btw: Object.freeze({
      ...state.btw,
      turnCount: nonNegativeInteger(state.btw.turnCount),
    }),
    status: Object.freeze({
      ...state.status,
      tokenSpeed:
        state.status.tokenSpeed !== null &&
        Number.isFinite(state.status.tokenSpeed) &&
        state.status.tokenSpeed >= 0
          ? state.status.tokenSpeed
          : null,
      tokenSpeedEstimated:
        state.status.tokenSpeed !== null &&
        Number.isFinite(state.status.tokenSpeed) &&
        state.status.tokenSpeed >= 0 &&
        state.status.tokenSpeedEstimated,
      elapsedMs:
        state.status.elapsedMs !== null && Number.isFinite(state.status.elapsedMs)
          ? Math.max(0, state.status.elapsedMs)
          : null,
      git:
        state.status.git === null
          ? null
          : Object.freeze({
              ...state.status.git,
              pullRequest:
                state.status.git.pullRequest === null
                  ? null
                  : Object.freeze({ ...state.status.git.pullRequest }),
            }),
    }),
    composer: Object.freeze({
      ...state.composer,
      textLength: nonNegativeInteger(state.composer.textLength),
    }),
  });
}

function normalizeSingleLine(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nonNegativeInteger(value: number): number {
  return Math.max(0, Math.trunc(finiteOrZero(value)));
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, finiteOrZero(value)));
}

function plural(count: number, noun: string): string {
  return nonNegativeInteger(count) === 1 ? noun : `${noun}s`;
}
