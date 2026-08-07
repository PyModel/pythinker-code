import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui';

import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  DYNAMIC_WORKFLOW_RENDERING,
} from '#/tui/constant/rendering';
import { currentTheme } from '#/tui/theme';
import { shimmerText } from '#/tui/utils/shimmer';

const RESUMED_ITEM_LABEL = '(resumed)';
const ORCHESTRATING_LABEL = 'Orchestrating';
const FINALIZING_LABEL = 'Finalizing';
// Pad to the wider live label so the suffix column never shifts between them.
const LIVE_LABEL_WIDTH = Math.max(
  visibleWidth(ORCHESTRATING_LABEL),
  visibleWidth(FINALIZING_LABEL),
);
const MAX_DYNAMIC_WORKFLOW_MEMBERS = 128;

/** Lifecycle state of one delegated agent row, driven only by observed events. */
export type DynamicWorkflowPhase =
  | 'pending'
  | 'queued'
  | 'running'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Overall request state: collecting input, actively running, or finished. */
export type DynamicWorkflowRequestPhase =
  | 'collecting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DynamicWorkflowMember {
  index: number;
  agentId?: string;
  item: string;
  phase: DynamicWorkflowPhase;
  latest: string;
  /** `latest` holds a tool-activity label, not streamed model text. */
  latestFromTool?: boolean;
  statusDetail?: string;
  startedAtMs?: number;
  endedAtMs?: number;
  /**
   * Tool calls observed for this agent. Real work done, monotonic — unlike a
   * percentage, which would need a total nobody can know in advance.
   */
  toolCalls: number;
  /**
   * When this agent last produced any observed event. Its age is the liveness
   * signal: a working agent stays near zero, a wedged one climbs without bound.
   */
  lastEventAtMs: number;
}

export interface DynamicWorkflowActivity {
  relativeMs: number;
  source: number | 'SYS';
  text: string;
}

/** Renderer-owned state for one Dynamic Workflow tool call. */
export interface DynamicWorkflowModel {
  requestPhase: DynamicWorkflowRequestPhase;
  inputComplete: boolean;
  toolCallActive: boolean;
  /** Accepted input count once `markInputComplete()` ran; drives aggregate counts. */
  knownTotal?: number;
  description?: string;
  promptTemplate?: string;
  itemsStarted: number;
  startedAtMs: number;
  endedAtMs?: number;
  members: DynamicWorkflowMember[];
  recentActivity: DynamicWorkflowActivity[];
}

interface DynamicWorkflowResultStatus {
  readonly index: number;
  readonly agentId?: string;
  readonly item?: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly detail?: string;
}

export interface DynamicWorkflowResultSummary {
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
  readonly parsed: boolean;
}

export interface DynamicWorkflowMissionControlOptions {
  readonly description: string;
  readonly availableRows?: () => number | undefined;
}

const PHASE_TOKENS: Record<DynamicWorkflowPhase, string> = {
  pending: '◌ PEND',
  queued: '◌ WAIT',
  // Label only: a running row is the one phase that animates, so its symbol is
  // a spinner supplied per frame by renderPhaseCell rather than a fixed glyph.
  running: 'RUN',
  suspended: '! HOLD',
  completed: '✓ DONE',
  failed: '× FAIL',
  cancelled: '– STOP',
};

const PHASE_COLORS: Record<DynamicWorkflowPhase, 'textMuted' | 'primary' | 'success' | 'warning' | 'error'> = {
  pending: 'textMuted',
  queued: 'textMuted',
  running: 'primary',
  suspended: 'warning',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

/**
 * A truthful, observed-state summary for one DynamicWorkflow tool call.
 * Animation remains owned by the injected ActivityLoader; this component only
 * reads its current frame during render.
 */
export class DynamicWorkflowMissionControlComponent implements Component {
  private readonly model: DynamicWorkflowModel;
  private readonly availableRows: (() => number | undefined) | undefined;
  private activitySpinnerText: (() => string) | undefined;
  private completeItems: string[] = [];

  constructor(options: DynamicWorkflowMissionControlOptions) {
    this.availableRows = options.availableRows;
    this.model = {
      requestPhase: 'collecting',
      inputComplete: false,
      toolCallActive: true,
      description: normalizeText(options.description),
      itemsStarted: 0,
      startedAtMs: Date.now(),
      members: [],
      recentActivity: [],
    };
  }

  invalidate(): void {}

  setActivitySpinnerText(provider: (() => string) | undefined): void {
    if (!this.model.toolCallActive) return;
    this.activitySpinnerText = provider;
  }

  markToolCallEnded(): void {
    this.model.toolCallActive = false;
    this.activitySpinnerText = undefined;
  }

  isToolCallActive(): boolean {
    return this.model.toolCallActive;
  }

  isRequestStreaming(): boolean {
    return !this.model.inputComplete;
  }

  updateArgs(
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string } = {},
  ): void {
    const description = dynamicWorkflowDescriptionFromArgs(args) ||
      (options.streamingArguments === undefined
        ? ''
        : dynamicWorkflowPartialDescriptionFromArguments(options.streamingArguments));
    if (description.length > 0 || this.model.description === undefined) {
      this.model.description = normalizeText(description);
    }

    const completeItems = dynamicWorkflowMemberItemsFromArgs(args)
      .slice(0, MAX_DYNAMIC_WORKFLOW_MEMBERS);
    this.completeItems = completeItems;
    const partialItems = options.streamingArguments === undefined
      ? []
      : dynamicWorkflowPartialMemberItemsFromArguments(options.streamingArguments)
        .slice(0, MAX_DYNAMIC_WORKFLOW_MEMBERS);
    const visibleItems = completeItems.length > 0 ? completeItems : partialItems;
    if (visibleItems.length > 0) {
      this.model.itemsStarted = Math.max(this.model.itemsStarted, visibleItems.length);
      this.ensureMemberCount(visibleItems.length);
      this.updateItemTexts(visibleItems);
    }

    const promptTemplate = dynamicWorkflowPromptTemplateFromArgs(args) ||
      (options.streamingArguments === undefined
        ? ''
        : dynamicWorkflowPartialPromptTemplateFromArguments(options.streamingArguments));
    if (promptTemplate.length > 0 || this.model.promptTemplate === undefined) {
      this.model.promptTemplate = promptTemplate;
    }
  }

  markInputComplete(): void {
    if (this.model.inputComplete) return;
    this.model.inputComplete = true;
    this.model.knownTotal = this.completeItems.length;
    this.ensureMemberCount(this.completeItems.length);
    this.updateItemTexts(this.completeItems);
    // Streaming may have over-counted items; drop the unclaimed surplus rows.
    if (this.completeItems.length > 0) {
      this.model.members = this.model.members.filter(
        (member) => member.index <= this.completeItems.length || member.agentId !== undefined,
      );
      this.model.itemsStarted = this.model.members.length;
    }
    for (const member of this.model.members) {
      if (member.phase === 'pending') member.phase = 'queued';
    }
    if (this.model.requestPhase === 'collecting') {
      this.model.requestPhase = 'active';
      this.recordActivity('SYS', 'Workflow input accepted');
    }
  }

  registerSubagent(input: {
    readonly agentId: string;
    readonly dynamicWorkflowIndex?: number;
    readonly description?: string;
  }): void {
    const member = this.findMemberForSubagent(input.agentId, input.dynamicWorkflowIndex);
    // Never claim a member that another agent already took.
    if (member === undefined || member.agentId !== undefined && member.agentId !== input.agentId) return;

    const wasUnassigned = member.agentId === undefined;
    member.agentId = input.agentId;
    if (member.phase === 'pending') member.phase = 'queued';
    if (input.description !== undefined && member.item.length === 0) {
      member.item = normalizeText(input.description);
    }
    if (wasUnassigned) this.recordActivity(member.index, 'Agent spawned');
  }

  markStarted(agentId: string): void {
    const member = this.findMemberByAgentId(agentId);
    if (member === undefined || isTerminalPhase(member.phase)) return;
    if (member.phase === 'running') return;
    member.phase = 'running';
    member.startedAtMs ??= Date.now();
    member.lastEventAtMs = Date.now();
    delete member.statusDetail;
    this.recordActivity(member.index, 'Started');
  }

  recordToolCall(input: {
    readonly agentId: string;
    readonly name?: string;
  }): void {
    const member = this.findMemberByAgentId(input.agentId);
    if (member === undefined || isTerminalPhase(member.phase)) return;
    this.markStarted(input.agentId);
    member.toolCalls += 1;
    member.lastEventAtMs = Date.now();
    const latest = input.name === undefined ? 'Using a tool' : `Using ${input.name}`;
    this.setLatest(member, latest, true);
    // Streamed text that follows starts a new line, never continues this label.
    member.latestFromTool = true;
  }

  appendModelDelta(input: { readonly agentId: string; readonly delta: string }): void {
    const member = this.findMemberByAgentId(input.agentId);
    if (member === undefined || isTerminalPhase(member.phase) || input.delta.length === 0) return;
    this.markStarted(input.agentId);
    const recordActivity = input.delta.includes('\n') || member.latest.length === 0;
    member.lastEventAtMs = Date.now();
    const carried = member.latestFromTool === true ? '' : member.latest;
    const latest = latestNonEmptyLine(`${carried}${input.delta}`);
    member.latestFromTool = false;
    this.setLatest(member, latest, recordActivity);
  }

  markSuspended(input: {
    readonly agentId: string;
    readonly reason: string;
    readonly dynamicWorkflowIndex?: number;
    readonly description?: string;
  }): void {
    const member = this.findMemberByAgentId(input.agentId) ??
      this.findMemberForSubagent(input.agentId, input.dynamicWorkflowIndex);
    if (member === undefined || isTerminalPhase(member.phase)) return;
    member.agentId = input.agentId;
    if (input.description !== undefined && member.item.length === 0) {
      member.item = normalizeText(input.description);
    }
    const detail = normalizeText(input.reason);
    const changed = member.phase !== 'suspended' || member.statusDetail !== detail;
    member.phase = 'suspended';
    member.statusDetail = detail.length > 0 ? detail : undefined;
    if (changed) this.recordActivity(member.index, detail.length > 0 ? `Suspended: ${detail}` : 'Suspended');
  }

  markCompleted(agentId: string, summary?: string): void {
    const member = this.findMemberByAgentId(agentId);
    if (member === undefined) return;
    this.markMemberTerminal(member, 'completed', summary);
  }

  markFailed(agentId: string, failure?: string): void {
    const member = this.findMemberByAgentId(agentId);
    if (member === undefined) return;
    this.markMemberTerminal(member, 'failed', failure);
  }

  markCancelled(agentId: string): void {
    const member = this.findMemberByAgentId(agentId);
    if (member === undefined) return;
    this.markMemberTerminal(member, 'cancelled', 'Cancelled');
  }

  markRequestFailed(failure?: string): void {
    if (this.model.requestPhase === 'failed' || this.model.requestPhase === 'cancelled') return;
    this.model.requestPhase = 'failed';
    this.model.endedAtMs = Date.now();
    const detail = normalizeText(failure);
    this.recordActivity('SYS', detail.length > 0 ? `Workflow failed: ${detail}` : 'Workflow failed');
  }

  markActiveCancelled(): void {
    if (isTerminalRequestPhase(this.model.requestPhase)) return;
    this.model.requestPhase = 'cancelled';
    this.model.endedAtMs = Date.now();
    this.model.toolCallActive = false;
    this.activitySpinnerText = undefined;
    this.recordActivity('SYS', 'Workflow cancelled');
  }

  markWarning(message: string): void {
    this.recordActivity('SYS', normalizeText(message));
  }

  applyResult(output: string): boolean {
    const statuses = parseDynamicWorkflowResultStatuses(output);
    if (!isDynamicWorkflowResult(output)) return false;

    // Input was accepted with zero items: infer the total from the result rows.
    if (this.model.inputComplete && this.model.knownTotal === 0 && statuses.length > 0) {
      this.model.knownTotal = statuses.length;
    }
    const knownTotal = this.model.knownTotal;
    for (const status of statuses) {
      // Result rows beyond the accepted input count are out-of-band; ignore them.
      if (knownTotal !== undefined && knownTotal > 0 && status.index > knownTotal) continue;
      const member = status.agentId === undefined
        ? this.ensureMemberAt(status.index)
        : this.findMemberByAgentId(status.agentId) ?? this.ensureMemberAt(status.index);
      if (status.item !== undefined && (member.item.length === 0 || member.item === RESUMED_ITEM_LABEL)) {
        member.item = normalizeText(status.item);
      }
      if (status.agentId !== undefined && member.agentId === undefined) member.agentId = status.agentId;
      this.markMemberTerminal(member, status.status, status.detail);
    }

    if (!isTerminalRequestPhase(this.model.requestPhase)) {
      this.model.requestPhase = 'completed';
      this.model.endedAtMs = Date.now();
      this.recordActivity('SYS', 'Workflow result received');
    }
    return true;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const nowMs = this.model.endedAtMs ?? Date.now();
    const maxRows = this.availableRows?.();
    const rowBudget = maxRows === undefined || !Number.isFinite(maxRows)
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.floor(maxRows));

    if (rowBudget <= 0) return [];
    if (safeWidth < DYNAMIC_WORKFLOW_RENDERING.frameMinWidth) {
      const lines = [this.renderTitle(safeWidth)];
      if (rowBudget > 1) {
        lines.push(...this.renderContent(safeWidth, nowMs, rowBudget - 1));
      }
      return lines;
    }

    const top = this.renderFrameTop(safeWidth);
    if (rowBudget === 1) return [top];
    const bottom = this.renderFrameBottom(safeWidth);
    if (rowBudget === 2) return [top, bottom];

    const contentWidth = safeWidth - DYNAMIC_WORKFLOW_RENDERING.frameHorizontalInset;
    const content = this.renderContent(contentWidth, nowMs, rowBudget - 2);
    return [
      top,
      ...content.map((line) => this.renderFrameBodyLine(line, safeWidth)),
      bottom,
    ];
  }

  private renderContent(width: number, nowMs: number, rowBudget: number): string[] {
    const lines: string[] = [];
    if (rowBudget <= 0) return lines;

    const helper = this.renderHelper(width);
    const members = this.model.members.toSorted((left, right) => left.index - right.index);
    const essentialRows = 1 + (helper === undefined ? 0 : 1) + (members.length > 0 ? 2 : 0);
    // While the workflow is live, keep blank rows around the aggregate so the
    // framed card reads as title, body, and footer; terminal states pack tight.
    const spaceAroundAggregate =
      !isTerminalRequestPhase(this.model.requestPhase) && rowBudget >= essentialRows + 2;

    if (spaceAroundAggregate) lines.push('');
    lines.push(this.renderAggregate(width, nowMs));
    if (lines.length >= rowBudget) return lines;
    if (spaceAroundAggregate) lines.push('');

    if (helper !== undefined) {
      lines.push(helper);
      if (lines.length >= rowBudget) return lines;
    }

    if (members.length > 0 && rowBudget - lines.length >= 2) {
      lines.push(this.renderTableHeader(width));
      const slots = rowBudget - lines.length;
      const needsMore = members.length > slots;
      const memberSlots = needsMore && slots >= 2 ? slots - 1 : slots;
      const visibleMembers = members.slice(0, Math.max(0, memberSlots));
      for (const member of visibleMembers) {
        lines.push(this.renderMember(member, width, nowMs));
      }
      const hidden = members.length - visibleMembers.length;
      if (hidden > 0 && lines.length < rowBudget) {
        lines.push(truncateToWidth(
          currentTheme.fg('textMuted', `+ ${String(hidden)} more agents`),
          width,
        ));
      }
    }

    if (lines.length >= rowBudget || this.model.recentActivity.length === 0) return lines;
    lines.push(truncateToWidth(currentTheme.fg('textDim', 'Recent activity'), width));
    for (const entry of this.model.recentActivity) {
      if (lines.length >= rowBudget) break;
      lines.push(this.renderActivity(entry, width));
    }
    return lines;
  }

  private renderTitle(width: number): string {
    const title = currentTheme.boldFg('workflowTitle', 'Dynamic Workflow');
    const titleWidth = visibleWidth(title);
    const description = this.model.description;
    if (description === undefined || description.length === 0 || width <= titleWidth) {
      return titleWidth <= width ? title : truncateToWidth(title, width);
    }

    const suffix = currentTheme.fg('textDim', ` · ${description}`);
    const suffixWidth = width - titleWidth;
    return title + (
      visibleWidth(suffix) <= suffixWidth ? suffix : truncateToWidth(suffix, suffixWidth)
    );
  }

  private renderFrameTop(width: number): string {
    const left = currentTheme.fg('border', '╭─ ');
    const title = this.renderTitle(width - 5);
    const fillWidth = Math.max(0, width - visibleWidth(left) - visibleWidth(title) - 2);
    const right = currentTheme.fg('border', ` ${'─'.repeat(fillWidth)}╮`);
    return `${left}${title}${right}`;
  }

  private renderFrameBodyLine(content: string, width: number): string {
    const contentWidth = width - DYNAMIC_WORKFLOW_RENDERING.frameHorizontalInset;
    const clipped = truncateToWidth(content, contentWidth);
    const padding = ' '.repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
    const border = currentTheme.fg('border', '│');
    return `${border} ${clipped}${padding} ${border}`;
  }

  private renderFrameBottom(width: number): string {
    return currentTheme.fg('border', `╰${'─'.repeat(width - 2)}╯`);
  }

  private renderAggregate(width: number, nowMs: number): string {
    const terminal = isTerminalRequestPhase(this.model.requestPhase);
    const loader = terminal
      ? currentTheme.fg(requestPhaseColor(this.model.requestPhase), requestPhaseSymbol(this.model.requestPhase))
      : this.activitySpinnerText?.() ?? currentTheme.fg('primary', '●');
    const aggregateMembers = this.aggregateMembers();
    // All spawned agents are done but the tool result has not arrived yet:
    // the label says so instead of pretending orchestration is still active.
    // Every member counts — including out-of-band rows beyond knownTotal —
    // so the label never claims "done" above a row still marked running.
    const finalizing = !terminal &&
      this.model.knownTotal !== undefined &&
      this.model.knownTotal > 0 &&
      aggregateMembers.length === this.model.knownTotal &&
      this.model.members.every((member) => isTerminalPhase(member.phase));
    // The live label shimmers from elapsed time; no timer is created because
    // the host owns animation and only re-renders this block.
    const label = terminal
      ? currentTheme.fg('text', requestPhaseLabel(this.model.requestPhase))
      : shimmerText(finalizing ? FINALIZING_LABEL : ORCHESTRATING_LABEL, {
          // `primary` / `primaryShimmer` are a designed pair, so the sweep stays
          // periwinkle throughout; the old grey `text` base washed it out.
          baseToken: 'primary',
          shimmerToken: 'primaryShimmer',
          frame: Math.floor(
            Math.max(0, nowMs - this.model.startedAtMs) / BRAILLE_SPINNER_INTERVAL_MS,
          ),
          windowSize: 4,
        });
    const paddedLabel = padToWidth(label, LIVE_LABEL_WIDTH);
    const prefix = `${loader} ${paddedLabel}`;
    const completed = aggregateMembers.filter((member) => member.phase === 'completed').length;
    const failed = aggregateMembers.filter((member) => member.phase === 'failed').length;
    const cancelled = aggregateMembers.filter((member) => member.phase === 'cancelled').length;
    const elapsed = elapsedSeconds(this.model.startedAtMs, this.model.endedAtMs ?? nowMs);
    const countText = this.model.knownTotal === undefined
      ? ''
      : `${String(completed)}/${String(this.model.knownTotal)} complete`;
    const outcomeText = [
      failed > 0 ? `${String(failed)} failed` : '',
      cancelled > 0 ? `${String(cancelled)} stopped` : '',
    ].filter((part) => part.length > 0).join(' · ');
    const elapsedText = `${String(elapsed)}s elapsed`;
    const suffix = [countText, outcomeText, elapsedText]
      .filter((part) => part.length > 0)
      .join(' · ');
    return truncateToWidth(
      [prefix, suffix].filter((part) => part.length > 0).join(' '),
      width,
    );
  }

  private renderHelper(width: number): string | undefined {
    if (this.model.knownTotal !== undefined || isTerminalRequestPhase(this.model.requestPhase)) {
      return undefined;
    }
    return truncateToWidth(currentTheme.fg('textMuted', 'Waiting for delegated agents'), width);
  }

  private renderTableHeader(width: number): string {
    const header = width >= DYNAMIC_WORKFLOW_RENDERING.memberProgressMinWidth
      ? [
        padToWidth('ID', 3),
        padToWidth('WORK IDLE', DYNAMIC_WORKFLOW_RENDERING.memberProgressWidth),
        padToWidth('STATE', 6),
        'TASK',
      ].join('  ')
      : `${padToWidth('ID', 3)} ${padToWidth('STATE', 6)} TASK`;
    return truncateToWidth(currentTheme.fg('textDim', header), width);
  }

  private renderMember(member: DynamicWorkflowMember, width: number, nowMs: number): string {
    const id = currentTheme.fg('primary', String(member.index).padStart(3, '0'));
    // All running rows share the workflow's clock, so they spin in step instead
    // of drifting apart by whenever each agent happened to start.
    const state = renderPhaseCell(
      member.phase,
      Math.floor(Math.max(0, nowMs - this.model.startedAtMs) / BRAILLE_SPINNER_INTERVAL_MS),
    );
    const showWork = width >= DYNAMIC_WORKFLOW_RENDERING.memberProgressMinWidth;
    const workColumn = padToWidth(
      renderWorkCell(member, nowMs),
      DYNAMIC_WORKFLOW_RENDERING.memberProgressWidth,
    );
    const stateColumn = padToWidth(state, 6);
    const prefix = showWork
      ? `${id}  ${workColumn}  ${stateColumn}  `
      : `${id} ${padToWidth(state, 6)} `;
    const task = member.item || 'Delegated agent';
    const latest = member.latest.length > 0 && member.latest !== task ? member.latest : undefined;
    const detail = member.phase === 'suspended' || isTerminalPhase(member.phase)
      ? member.statusDetail ?? latest
      : latest ?? member.statusDetail;
    const elapsed = member.startedAtMs === undefined
      ? undefined
      : `${String(elapsedSeconds(member.startedAtMs, member.endedAtMs ?? nowMs))}s`;
    const showDetail = showWork && detail !== undefined && detail.length > 0;
    const showElapsed = showWork && elapsed !== undefined;
    const tail = [
      showDetail ? currentTheme.fg('textDim', detail) : '',
      showElapsed ? currentTheme.fg('textMuted', elapsed) : '',
    ].filter((part) => part.length > 0).join(' · ');
    const separator = tail.length > 0 ? ' · ' : '';
    const taskWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(separator) - visibleWidth(tail));
    const taskText = truncateToWidth(currentTheme.fg('text', task), taskWidth);
    return truncateToWidth(`${prefix}${taskText}${separator}${tail}`, width);
  }

  private renderActivity(entry: DynamicWorkflowActivity, width: number): string {
    const source = entry.source === 'SYS' ? 'SYS' : String(entry.source).padStart(3, '0');
    const seconds = Math.floor(Math.max(0, entry.relativeMs) / 1_000);
    return truncateToWidth(
      `${currentTheme.fg('textMuted', source)} ${currentTheme.fg('textMuted', `+${String(seconds)}s`)} ${currentTheme.fg('textDim', entry.text)}`,
      width,
    );
  }

  private aggregateMembers(): DynamicWorkflowMember[] {
    const members = this.model.members
      .toSorted((left, right) => left.index - right.index);
    const total = this.model.knownTotal;
    return total === undefined || total <= 0 ? members : members.slice(0, total);
  }

  private findMemberForSubagent(
    agentId: string,
    dynamicWorkflowIndex: number | undefined,
  ): DynamicWorkflowMember | undefined {
    const existing = this.findMemberByAgentId(agentId);
    if (existing !== undefined) return existing;
    if (
      dynamicWorkflowIndex !== undefined &&
      Number.isInteger(dynamicWorkflowIndex) &&
      dynamicWorkflowIndex > 0 &&
      dynamicWorkflowIndex <= MAX_DYNAMIC_WORKFLOW_MEMBERS
    ) {
      return this.ensureMemberAt(dynamicWorkflowIndex);
    }
    const unassigned = this.model.members
      .toSorted((left, right) => left.index - right.index)
      .find((member) => member.agentId === undefined);
    const nextIndex = this.nextMemberIndex();
    return unassigned ?? (
      nextIndex <= MAX_DYNAMIC_WORKFLOW_MEMBERS ? this.ensureMemberAt(nextIndex) : undefined
    );
  }

  private findMemberByAgentId(agentId: string): DynamicWorkflowMember | undefined {
    return this.model.members.find((member) => member.agentId === agentId);
  }

  private ensureMemberAt(index: number): DynamicWorkflowMember {
    this.ensureMemberCount(index);
    const member = this.model.members.find((candidate) => candidate.index === index);
    if (member === undefined) throw new Error(`Missing Dynamic Workflow member ${String(index)}`);
    return member;
  }

  private ensureMemberCount(count: number): void {
    const safeCount = Math.min(
      MAX_DYNAMIC_WORKFLOW_MEMBERS,
      Math.max(0, Math.floor(count)),
    );
    for (let index = 1; index <= safeCount; index += 1) {
      if (this.model.members.some((member) => member.index === index)) continue;
      this.model.members.push({
        index,
        item: '',
        phase: this.model.inputComplete ? 'queued' : 'pending',
        latest: '',
        toolCalls: 0,
        lastEventAtMs: Date.now(),
      });
    }
  }

  private nextMemberIndex(): number {
    return this.model.members.reduce((maximum, member) => Math.max(maximum, member.index), 0) + 1;
  }

  private updateItemTexts(items: readonly string[]): void {
    items.forEach((item, index) => {
      const member = this.ensureMemberAt(index + 1);
      member.item = normalizeText(item);
    });
  }

  private markMemberTerminal(
    member: DynamicWorkflowMember,
    phase: Extract<DynamicWorkflowPhase, 'completed' | 'failed' | 'cancelled'>,
    detail: string | undefined,
  ): void {
    if (isTerminalPhase(member.phase)) return;
    const normalizedDetail = normalizeText(detail);
    member.phase = phase;
    member.endedAtMs = Date.now();
    member.lastEventAtMs = Date.now();
    member.statusDetail = normalizedDetail.length > 0 ? normalizedDetail : undefined;
    const label = phase === 'completed' ? 'Completed' : phase === 'failed' ? 'Failed' : 'Cancelled';
    this.recordActivity(member.index, normalizedDetail.length > 0 ? `${label}: ${normalizedDetail}` : label);
  }

  private setLatest(member: DynamicWorkflowMember, latest: string, recordActivity: boolean): void {
    const normalized = normalizeText(latest);
    if (normalized.length === 0 || member.latest === normalized) return;
    member.latest = normalized;
    if (recordActivity) this.recordActivity(member.index, normalized);
  }

  private recordActivity(source: number | 'SYS', text: string): void {
    const entry: DynamicWorkflowActivity = {
      relativeMs: Math.max(0, Date.now() - this.model.startedAtMs),
      source,
      text: normalizeText(text),
    };
    const entries = this.model.recentActivity;
    entries.push(entry);
    entries.splice(0, Math.max(0, entries.length - 3));
  }
}

/** Item list from the completed tool-call `items` argument. */
export function dynamicWorkflowItemsFromArgs(args: Record<string, unknown>): string[] {
  const items = args['items'];
  return Array.isArray(items) ? items.map(itemLabel) : [];
}

/**
 * The schema requires plain strings, but a model may still emit objects. Render
 * a readable field instead of `[object Object]`; the tool call fails validation
 * either way.
 */
function itemLabel(item: unknown): string {
  if (typeof item === 'string') return item;
  if (typeof item !== 'object' || item === null) return String(item);
  const record = item as Record<string, unknown>;
  for (const key of ['prompt', 'description', 'title', 'task']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

/**
 * Best-effort `items` read from a partially streamed JSON arguments string.
 * Only top-level array members count: strings nested inside an object or array
 * member (and object keys) are skipped, not counted as items.
 */
export function dynamicWorkflowPartialItemsFromArguments(argumentsText: string): string[] {
  const match = /"items"\s*:\s*\[/u.exec(argumentsText);
  if (match === null) return [];
  const items: string[] = [];
  let depth = 0;
  for (let index = match.index + match[0].length; index < argumentsText.length; index += 1) {
    const character = argumentsText[index];
    if (character === '{' || character === '[') {
      // A nested member still occupies one item slot.
      if (depth === 0) items.push('');
      depth += 1;
      continue;
    }
    if (character === '}' || character === ']') {
      if (depth === 0) return items;
      depth -= 1;
      continue;
    }
    if (character !== '"') continue;
    const parsed = parsePartialJsonString(argumentsText, index + 1);
    if (depth === 0) items.push(parsed.value);
    if (!parsed.closed) return items;
    index = parsed.nextIndex;
  }
  return items;
}

/** Count of `items` parsed so far from streaming arguments. */
export function dynamicWorkflowPartialItemsCountFromArguments(argumentsText: string): number {
  return dynamicWorkflowPartialItemsFromArguments(argumentsText).length;
}

/** Description from the completed tool-call `description` argument. */
export function dynamicWorkflowDescriptionFromArgs(args: Record<string, unknown>): string {
  const description = args['description'];
  return typeof description === 'string' ? description : '';
}

/** Best-effort `description` read from a partially streamed JSON arguments string. */
export function dynamicWorkflowPartialDescriptionFromArguments(argumentsText: string): string {
  const match = /"description"\s*:\s*"/.exec(argumentsText);
  if (match === null) return '';
  return parsePartialJsonString(argumentsText, match.index + match[0].length).value;
}

/** Parses a `dynamic_workflow_result` document into summary counts; `parsed: false` when the output is not one. */
export function dynamicWorkflowResultSummaryFromOutput(output: string): DynamicWorkflowResultSummary {
  const envelope = dynamicWorkflowResultEnvelope(output);
  if (envelope === undefined) {
    return { completed: 0, failed: 0, aborted: 0, parsed: false };
  }

  const statuses = parseDynamicWorkflowResultStatuses(output);
  if (statuses.length > 0) {
    return {
      completed: statuses.filter((status) => status.status === 'completed').length,
      failed: statuses.filter((status) => status.status === 'failed').length,
      aborted: statuses.filter((status) => status.status === 'cancelled').length,
      parsed: true,
    };
  }
  return { ...dynamicWorkflowSummaryFromEnvelope(envelope), parsed: true };
}

/** True when `output` carries a complete `dynamic_workflow_result` envelope. */
export function isDynamicWorkflowResult(output: string): boolean {
  return dynamicWorkflowResultEnvelope(output) !== undefined;
}

function dynamicWorkflowMemberItemsFromArgs(args: Record<string, unknown>): string[] {
  return [...dynamicWorkflowResumeItemsFromArgs(args), ...dynamicWorkflowItemsFromArgs(args)];
}

function dynamicWorkflowResumeItemsFromArgs(args: Record<string, unknown>): string[] {
  const resumeAgentIds = args['resume_agent_ids'];
  if (typeof resumeAgentIds !== 'object' || resumeAgentIds === null || Array.isArray(resumeAgentIds)) {
    return [];
  }
  return Object.keys(resumeAgentIds).map(() => RESUMED_ITEM_LABEL);
}

function dynamicWorkflowPartialMemberItemsFromArguments(argumentsText: string): string[] {
  return [
    ...dynamicWorkflowPartialResumeItemsFromArguments(argumentsText),
    ...dynamicWorkflowPartialItemsFromArguments(argumentsText),
  ];
}

function dynamicWorkflowPartialResumeItemsFromArguments(argumentsText: string): string[] {
  const match = /"resume_agent_ids"\s*:\s*\{/.exec(argumentsText);
  if (match === null) return [];
  return Array.from(
    { length: countPartialJsonObjectEntries(argumentsText, match.index + match[0].length) },
    () => RESUMED_ITEM_LABEL,
  );
}

function dynamicWorkflowPromptTemplateFromArgs(args: Record<string, unknown>): string {
  const promptTemplate = args['prompt_template'];
  return typeof promptTemplate === 'string' ? promptTemplate : '';
}

function dynamicWorkflowPartialPromptTemplateFromArguments(argumentsText: string): string {
  const match = /"prompt_template"\s*:\s*"/.exec(argumentsText);
  if (match === null) return '';
  return parsePartialJsonString(argumentsText, match.index + match[0].length).value;
}

function parseDynamicWorkflowResultStatuses(output: string): DynamicWorkflowResultStatus[] {
  const envelope = dynamicWorkflowResultEnvelope(output);
  if (envelope === undefined) return [];
  const statuses: DynamicWorkflowResultStatus[] = [];
  // Indexes are validated and deduplicated: an explicit index is honored only
  // once and within range; a duplicated one is dropped, not remapped.
  const usedIndexes = new Set<number>();
  const tagPattern = /<subagent\b([^>]*)>/g;
  let match: RegExpExecArray | null;
  while (
    statuses.length < MAX_DYNAMIC_WORKFLOW_MEMBERS &&
    (match = tagPattern.exec(envelope)) !== null
  ) {
    const closeIndex = envelope.indexOf('</subagent>', tagPattern.lastIndex);
    if (closeIndex < 0) break;
    const attrs = match[1] ?? '';
    const body = envelope.slice(tagPattern.lastIndex, closeIndex);
    const outcome = xmlAttribute(attrs, 'outcome');
    if (
      outcome === 'completed' ||
      outcome === 'failed' ||
      outcome === 'aborted' ||
      outcome === 'cancelled'
    ) {
      // Omitted `index` falls back to the lowest free slot so unordered tags
      // still render in ascending row order.
      const explicitIndexText = xmlAttribute(attrs, 'index');
      const explicitIndex = explicitIndexText === undefined
        ? undefined
        : Number(explicitIndexText);
      const fallbackIndex = firstAvailableResultIndex(usedIndexes);
      const index = explicitIndexText === undefined ? fallbackIndex : explicitIndex;
      if (
        index !== undefined &&
        Number.isInteger(index) &&
        index > 0 &&
        index <= MAX_DYNAMIC_WORKFLOW_MEMBERS &&
        !usedIndexes.has(index)
      ) {
        usedIndexes.add(index);
        statuses.push({
          index,
          agentId: xmlAttribute(attrs, 'agent_id'),
          item: xmlAttribute(attrs, 'item'),
          status: outcome === 'aborted' || outcome === 'cancelled' ? 'cancelled' : outcome,
          detail: normalizeText(decodeXmlEntities(body)),
        });
      }
    }
    tagPattern.lastIndex = closeIndex + '</subagent>'.length;
  }
  return statuses;
}

function firstAvailableResultIndex(usedIndexes: ReadonlySet<number>): number | undefined {
  for (let index = 1; index <= MAX_DYNAMIC_WORKFLOW_MEMBERS; index += 1) {
    if (!usedIndexes.has(index)) return index;
  }
  return undefined;
}

function dynamicWorkflowResultEnvelope(output: string): string | undefined {
  let candidate = output.trim();
  const prefix = /^dynamic_workflow:\s*(?:(?:completed|failed|cancelled|aborted)\s*)?/i.exec(candidate);
  if (prefix !== null) candidate = candidate.slice(prefix[0].length).trimStart();
  const opening = /^<dynamic_workflow_result\b[^>]*>/.exec(candidate);
  if (opening === null) return undefined;
  const close = candidate.indexOf('</dynamic_workflow_result>', opening[0].length);
  if (close < 0) return undefined;
  return candidate.slice(opening[0].length, close);
}

function dynamicWorkflowSummaryFromEnvelope(envelope: string): Omit<DynamicWorkflowResultSummary, 'parsed'> {
  const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(envelope)?.[1] ?? '';
  return {
    completed: summaryCount(summary, 'completed'),
    failed: summaryCount(summary, 'failed'),
    aborted: summaryCount(summary, 'aborted'),
  };
}

function summaryCount(summary: string, label: string): number {
  const value = new RegExp(`\\b${label}\\s*:\\s*(\\d+)`, 'i').exec(summary)?.[1];
  return value === undefined ? 0 : Number(value);
}

function xmlAttribute(attributes: string, name: string): string | undefined {
  const value = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
  return value === undefined ? undefined : decodeXmlEntities(value);
}

/** Decodes XML entities (named and numeric); invalid or surrogate refs pass through. */
function decodeXmlEntities(value: string): string {
  return value.replaceAll(
    /&(amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/giu,
    (entity, reference: string) => {
      switch (reference.toLowerCase()) {
        case 'amp': return '&';
        case 'quot': return '"';
        case 'apos': return "'";
        case 'lt': return '<';
        case 'gt': return '>';
      }
      const radix = reference[1]?.toLowerCase() === 'x' ? 16 : 10;
      const digits = radix === 16 ? reference.slice(2) : reference.slice(1);
      const codePoint = Number.parseInt(digits, radix);
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10_FFFF ||
        codePoint >= 0xD800 && codePoint <= 0xDFFF
      ) {
        return entity;
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

/** Maps a percent to one of the dotted cube levels; the cube fills bottom-up. */

function requestPhaseLabel(phase: DynamicWorkflowRequestPhase): string {
  const labels: Record<DynamicWorkflowRequestPhase, string> = {
    collecting: ORCHESTRATING_LABEL,
    active: ORCHESTRATING_LABEL,
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return labels[phase];
}

function requestPhaseSymbol(phase: DynamicWorkflowRequestPhase): string {
  const symbols: Record<DynamicWorkflowRequestPhase, string> = {
    collecting: '●',
    active: '●',
    completed: '✓',
    failed: '×',
    cancelled: '–',
  };
  return symbols[phase];
}

function requestPhaseColor(phase: DynamicWorkflowRequestPhase): 'primary' | 'success' | 'error' | 'warning' {
  const colors: Record<DynamicWorkflowRequestPhase, 'primary' | 'success' | 'error' | 'warning'> = {
    collecting: 'primary',
    active: 'primary',
    completed: 'success',
    failed: 'error',
    cancelled: 'warning',
  };
  return colors[phase];
}

function isTerminalPhase(phase: DynamicWorkflowPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}

function isTerminalRequestPhase(phase: DynamicWorkflowRequestPhase): boolean {
  return phase === 'completed' || phase === 'failed' || phase === 'cancelled';
}

function elapsedSeconds(startedAtMs: number, endedAtMs: number): number {
  return Math.floor(Math.max(0, endedAtMs - startedAtMs) / 1_000);
}

function latestNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/).toReversed()) {
    const normalized = normalizeText(line);
    if (normalized.length > 0) return normalized;
  }
  return '';
}

function normalizeText(text: string | undefined): string {
  return text?.replaceAll(/\s+/g, ' ').trim() ?? '';
}

/**
 * The WORK cell: tool calls done, and how long this agent has been silent.
 *
 * There is deliberately no percentage. Nothing knows how many steps an agent
 * will take, so any percent is invented — the old one pinned every tool-using
 * agent at 75% until it finished, which made a wedged agent look identical to a
 * busy one. A count and an idle age are both real and answer the actual
 * question: is this thing still working?
 */
function renderWorkCell(member: DynamicWorkflowMember, nowMs: number): string {
  const tools = currentTheme.fg('textDim', `${String(member.toolCalls).padStart(3, ' ')}⚒`);
  if (isTerminalPhase(member.phase)) {
    return `${tools} ${currentTheme.fg('textMuted', '   –')}`;
  }
  const idleMs = Math.max(0, nowMs - member.lastEventAtMs);
  const idleSeconds = Math.floor(idleMs / 1000);
  const token = idleMs >= DYNAMIC_WORKFLOW_RENDERING.stalledIdleMs
    ? 'error'
    : idleMs >= DYNAMIC_WORKFLOW_RENDERING.quietIdleMs
      ? 'warning'
      : 'textMuted';
  return `${tools} ${currentTheme.fg(token, `${String(idleSeconds)}s`.padStart(4, ' '))}`;
}

/**
 * The STATE cell for one row.
 *
 * Every phase but `running` is a fixed symbol plus its label. A running row
 * spins a dim grey braille dot instead, so "this agent is working" reads as
 * motion rather than as another coloured dot competing with the periwinkle the
 * panel already uses for identity.
 */
function renderPhaseCell(phase: DynamicWorkflowPhase, frame: number): string {
  const label = currentTheme.fg(PHASE_COLORS[phase], PHASE_TOKENS[phase]);
  if (phase !== 'running') return label;
  const spinner =
    BRAILLE_SPINNER_FRAMES[frame % BRAILLE_SPINNER_FRAMES.length] ?? BRAILLE_SPINNER_FRAMES[0] ?? '';
  return `${currentTheme.fg('textDim', spinner)} ${label}`;
}

function padToWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

function countPartialJsonObjectEntries(text: string, startIndex: number): number {
  let count = 0;
  let expectingKey = true;
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === '}') return count;
    if (character === ',') {
      expectingKey = true;
      continue;
    }
    if (character !== '"') continue;
    const parsed = parsePartialJsonString(text, index + 1);
    if (expectingKey) {
      if (parsed.closed || parsed.value.length > 0) count += 1;
      expectingKey = false;
    }
    if (!parsed.closed) return count;
    index = parsed.nextIndex;
  }
  return count;
}

function parsePartialJsonString(
  text: string,
  startIndex: number,
): { value: string; closed: boolean; nextIndex: number } {
  let value = '';
  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') return { value, closed: true, nextIndex: index };
    if (character !== '\\') {
      value += character;
      continue;
    }
    const escaped = text[index + 1];
    if (escaped === undefined) return { value, closed: false, nextIndex: index };
    const escapedValues: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    if (escaped === 'u') {
      const hex = text.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        value += String.fromCodePoint(Number.parseInt(hex, 16));
        index += 5;
        continue;
      }
    }
    value += escapedValues[escaped] ?? escaped;
    index += 1;
  }
  return { value, closed: false, nextIndex: text.length };
}
