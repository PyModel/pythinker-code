import type {
  BackgroundTaskInfo,
  Event,
} from '@pymodel/pythinker-code-sdk';
import type { Component } from '@earendil-works/pi-tui';

import {
  DynamicWorkflowMissionControlComponent,
  dynamicWorkflowDescriptionFromArgs,
} from '../components/messages/dynamic-workflow-mission-control';
import { MAIN_AGENT_ID } from '../constant/pythinker-tui';
import type {
  BackgroundAgentMetadata,
  ToolCallBlockData,
  ToolResultBlockData,
  TranscriptEntry,
} from '../types';
import { formatBackgroundAgentTranscript } from '../utils/background-agent-status';
import { argsRecord, serializeToolResultOutput } from '../utils/event-payload';
import { formatHookResultPlain } from '../utils/hook-result-format';
import { nextTranscriptId } from '../utils/transcript-id';
import type { SessionEventHost } from './session-event-handler';

export interface SubagentInfo {
  readonly parentToolCallId: string;
  readonly name: string;
  readonly runInBackground: boolean;
  readonly dynamicWorkflowIndex?: number;
}

export type SubagentLifecycleEvent = Event & { type: `subagent.${string}` };
type SubagentLifecycleEventOf<Type extends SubagentLifecycleEvent['type']> =
  SubagentLifecycleEvent & { type: Type };

export interface SubAgentEventHandlerDependencies {
  readonly backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>;
  readonly backgroundTaskTranscriptedTerminal: Set<string>;
  readonly syncBackgroundAgentBadge: () => void;
}

function renderedRowsAfterChild(
  children: readonly Component[],
  child: Component,
  width: number,
): number {
  const childIndex = children.indexOf(child);
  if (childIndex < 0) return 0;
  return children
    .slice(childIndex + 1)
    .reduce((sum, component) => sum + component.render(width).length, 0);
}

export class SubAgentEventHandler {
  readonly subagentInfo: Map<string, SubagentInfo> = new Map();
  private readonly dynamicWorkflowMissionControls: Map<
    string,
    DynamicWorkflowMissionControlComponent
  > = new Map();
  // Lifecycle events that arrive before their `subagent.spawned` are buffered
  // per parent tool call, so they replay only into the generation of that
  // exact workflow. `parentToolCallIdsByAgentId` guards against ambiguous
  // parentless terminal events when an agent id is reused, and retired tool
  // calls keep late events (after undo / turn cleanup) from resurrecting UI.
  private readonly pendingLifecycleByParentToolCallId = new Map<
    string,
    Map<string, SubagentLifecycleEvent[]>
  >();
  private readonly parentToolCallIdsByAgentId = new Map<string, Set<string>>();
  private readonly retiredDynamicWorkflowToolCallIds = new Set<string>();
  backgroundAgentMetadata: Map<string, BackgroundAgentMetadata> = new Map();

  constructor(
    private readonly host: SessionEventHost,
    private readonly deps: SubAgentEventHandlerDependencies,
  ) {}

  resetRuntimeState(): void {
    this.subagentInfo.clear();
    this.backgroundAgentMetadata.clear();
    this.clearDynamicWorkflowMissionControls();
    this.pendingLifecycleByParentToolCallId.clear();
    this.parentToolCallIdsByAgentId.clear();
    this.retiredDynamicWorkflowToolCallIds.clear();
  }

  /** Rebuilds replay state from a resumed session's background agents. */
  hydrateBackgroundAgentMetadata(
    backgroundAgentMetadata: ReadonlyMap<string, BackgroundAgentMetadata>,
  ): void {
    this.backgroundAgentMetadata = new Map(backgroundAgentMetadata);
    for (const [agentId, meta] of backgroundAgentMetadata) {
      const knownParentToolCallIds = this.parentToolCallIdsByAgentId.get(agentId) ?? new Set();
      knownParentToolCallIds.add(meta.parentToolCallId);
      this.parentToolCallIdsByAgentId.set(agentId, knownParentToolCallIds);
    }
  }

  routeChildAgentEvent(event: Event): boolean {
    if (isSubagentLifecycleEvent(event)) return false;

    const childAgentId = event.agentId;
    if (childAgentId === MAIN_AGENT_ID) {
      // Swallow a late result for a Dynamic Workflow tool call that was already
      // retired (undo / turn cleanup), so it cannot restart streaming UI.
      return (
        event.type === 'tool.result' &&
        this.retiredDynamicWorkflowToolCallIds.has(event.toolCallId)
      );
    }
    if (this.host.btwPanelController.routeEvent(event)) return true;

    const info = this.subagentInfo.get(childAgentId);
    if (info === undefined || info.parentToolCallId.length === 0) return true;

    const { parentToolCallId } = info;
    const missionControl = this.dynamicWorkflowMissionControls.get(parentToolCallId);
    if (missionControl !== undefined) {
      this.applySubagentEventToDynamicWorkflow(missionControl, event, childAgentId);
      this.requestRender();
      return true;
    }

    const toolCall = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (toolCall === undefined) return true;
    toolCall.setSubagentMeta(childAgentId, info.name);

    if (event.type === 'hook.result') {
      toolCall.appendSubagentText(formatHookResultPlain(event), 'text');
    } else if (event.type === 'assistant.delta') {
      toolCall.appendSubagentText(event.delta, 'text');
    } else if (event.type === 'thinking.delta') {
      toolCall.appendSubagentText(event.delta, 'thinking');
    } else if (event.type === 'tool.call.started') {
      toolCall.appendSubToolCall({
        id: `${childAgentId}:${event.toolCallId}`,
        name: event.name,
        args: argsRecord(event.args),
      });
    } else if (event.type === 'tool.call.delta') {
      toolCall.appendSubToolCallDelta({
        id: `${childAgentId}:${event.toolCallId}`,
        name: event.name,
        argumentsPart: event.argumentsPart ?? null,
      });
    } else if (
      event.type === 'tool.progress' &&
      (event.update.kind === 'stdout' || event.update.kind === 'stderr') &&
      event.update.text !== undefined
    ) {
      toolCall.appendSubToolLiveOutput(`${childAgentId}:${event.toolCallId}`, event.update.text);
    } else if (event.type === 'tool.result') {
      toolCall.finishSubToolCall({
        tool_call_id: `${childAgentId}:${event.toolCallId}`,
        output: serializeToolResultOutput(event.output),
        is_error: event.isError,
      });
    } else if (event.type === 'agent.status.updated') {
      const usageObj = event.usage;
      const totalUsage = usageObj?.total ?? usageObj?.currentTurn;
      toolCall.updateSubagentMetrics({
        contextTokens: event.contextTokens,
        usage: totalUsage,
      });
    }
    return true;
  }

  handleLifecycleEvent(event: SubagentLifecycleEvent): void {
    if (event.type !== 'subagent.spawned') {
      const parentToolCallId = event.parentToolCallId;
      const info = this.subagentInfo.get(event.subagentId);
      const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
      const activeParentToolCallId = info?.parentToolCallId ?? backgroundMeta?.parentToolCallId;

      if (parentToolCallId !== undefined) {
        if (this.retiredDynamicWorkflowToolCallIds.has(parentToolCallId)) {
          this.deletePendingLifecycle(parentToolCallId, event.subagentId);
          return;
        }
        if (activeParentToolCallId === undefined) {
          this.bufferPendingLifecycle(parentToolCallId, event);
          return;
        }
        if (activeParentToolCallId !== parentToolCallId) return;
      } else {
        if (activeParentToolCallId === undefined) return;
        const knownParentToolCallIds = this.parentToolCallIdsByAgentId.get(event.subagentId);
        if (
          knownParentToolCallIds === undefined ||
          knownParentToolCallIds.size !== 1 ||
          !knownParentToolCallIds.has(activeParentToolCallId)
        ) return;
      }
    }

    switch (event.type) {
      case 'subagent.spawned':
        this.handleSubagentSpawned(event);
        return;
      case 'subagent.started':
        this.handleSubagentStarted(event);
        return;
      case 'subagent.suspended':
        this.handleSubagentSuspended(event);
        return;
      case 'subagent.completed':
        this.handleSubagentCompleted(event);
        return;
      case 'subagent.failed':
        this.handleSubagentFailed(event);
        return;
    }
  }

  handleWorkflowWarning(event: Extract<Event, { type: 'workflow.warning' }>): void {
    const missionControl = this.dynamicWorkflowMissionControls.get(event.parentToolCallId);
    if (missionControl !== undefined) {
      missionControl.markWarning(event.message);
      this.requestRender();
      return;
    }
    // The tool call was retired or the warning arrived without a card: never
    // drop it silently.
    this.host.showStatus(event.message, 'warning');
  }

  // Retires every live mission control: the tool call ids are recorded so
  // any late events for them are dropped, and their subagents are forgotten.
  clearDynamicWorkflowMissionControls(): void {
    const toolCallIds = new Set(this.dynamicWorkflowMissionControls.keys());
    for (const toolCallId of toolCallIds) {
      this.retiredDynamicWorkflowToolCallIds.add(toolCallId);
    }
    for (const missionControl of this.dynamicWorkflowMissionControls.values()) {
      missionControl.markToolCallEnded();
      missionControl.markActiveCancelled();
    }
    this.dynamicWorkflowMissionControls.clear();
    for (const toolCallId of toolCallIds) {
      this.forgetDynamicWorkflowSubagents(toolCallId);
      this.pendingLifecycleByParentToolCallId.delete(toolCallId);
    }
    this.host.updateActivityPane();
  }

  hasDynamicWorkflowMissionControl(toolCallId: string): boolean {
    return this.dynamicWorkflowMissionControls.has(toolCallId);
  }

  hasActiveDynamicWorkflowToolCall(): boolean {
    return Array.from(this.dynamicWorkflowMissionControls.values()).some((missionControl) =>
      missionControl.isToolCallActive()
    );
  }

  syncDynamicWorkflowActivitySpinner(
    spinner: { renderInline(): string } | undefined,
  ): void {
    for (const missionControl of this.dynamicWorkflowMissionControls.values()) {
      missionControl.setActivitySpinnerText(
        spinner === undefined ? undefined : () => spinner.renderInline(),
      );
    }
  }

  /** True for a Dynamic Workflow tool call already removed from the UI. */
  isRetiredDynamicWorkflowToolCall(toolCallId: string): boolean {
    return this.retiredDynamicWorkflowToolCallIds.has(toolCallId);
  }

  handleDynamicWorkflowToolCallStarted(
    toolCallId: string,
    args: Record<string, unknown>,
  ): void {
    if (this.isRetiredDynamicWorkflowToolCall(toolCallId)) return;
    const missionControl = this.ensureDynamicWorkflowMissionControl(toolCallId, args);
    missionControl.markInputComplete();
    // Captured here rather than in `ensure…`, which the delta path also calls:
    // mid-stream arguments are half-parsed, and saving those would write a
    // workflow missing most of its items.
    this.host.state.lastDynamicWorkflowArgs = args;
    this.requestRender();
  }

  handleDynamicWorkflowToolCallDelta(
    toolCallId: string,
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string },
  ): void {
    if (this.isRetiredDynamicWorkflowToolCall(toolCallId)) return;
    this.ensureDynamicWorkflowMissionControl(toolCallId, args, options);
    this.requestRender();
  }

  handleDynamicWorkflowToolResult(
    toolCallId: string,
    resultData: ToolResultBlockData,
    isError: boolean,
  ): void {
    const missionControl = this.dynamicWorkflowMissionControls.get(toolCallId);
    if (missionControl === undefined) {
      return;
    }

    if (isError && isUserCancelledSubagentError(resultData.output)) {
      if (missionControl.isRequestStreaming()) {
        this.removeDynamicWorkflowMissionControl(toolCallId, missionControl);
      } else {
        missionControl.markToolCallEnded();
        missionControl.markActiveCancelled();
      }
    } else if (isError) {
      missionControl.markToolCallEnded();
      missionControl.applyResult(resultData.output);
      missionControl.markRequestFailed(resultData.output);
    } else {
      missionControl.markToolCallEnded();
      if (!missionControl.applyResult(resultData.output)) {
        missionControl.markRequestFailed('Unsupported Dynamic Workflow result');
      }
    }
    this.host.updateActivityPane();
    this.requestRender();
  }

  markActiveDynamicWorkflowsCancelled(): void {
    let updated = false;
    for (const [toolCallId, missionControl] of this.dynamicWorkflowMissionControls) {
      if (missionControl.isRequestStreaming()) {
        this.removeDynamicWorkflowMissionControl(toolCallId, missionControl);
        updated = true;
        continue;
      }
      missionControl.markActiveCancelled();
      updated = true;
    }
    if (updated) this.requestRender();
  }

  private handleSubagentSpawned(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    if (this.retiredDynamicWorkflowToolCallIds.has(event.parentToolCallId)) {
      this.deletePendingLifecycle(event.parentToolCallId, event.subagentId);
      return;
    }

    const knownParentToolCallIds = this.parentToolCallIdsByAgentId.get(event.subagentId) ?? new Set();
    knownParentToolCallIds.add(event.parentToolCallId);
    this.parentToolCallIdsByAgentId.set(event.subagentId, knownParentToolCallIds);
    if (this.backgroundAgentMetadata.delete(event.subagentId)) {
      this.deps.syncBackgroundAgentBadge();
    }
    this.rememberSubagent(event);

    if (event.runInBackground) {
      const meta = this.buildBackgroundAgentMetadata(event);
      this.backgroundAgentMetadata.set(event.subagentId, meta);
      this.appendBackgroundAgentEntry('started', meta);
      this.deps.syncBackgroundAgentBadge();
      this.drainPendingLifecycle(event.parentToolCallId, event.subagentId);
      return;
    }

    this.handleForegroundSubagentSpawned(event);
    this.drainPendingLifecycle(event.parentToolCallId, event.subagentId);
  }

  private handleSubagentStarted(
    event: SubagentLifecycleEventOf<'subagent.started'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (info === undefined) return;
    if (!info.runInBackground) this.handleForegroundSubagentStarted(event, info);
  }

  private handleSubagentSuspended(
    event: SubagentLifecycleEventOf<'subagent.suspended'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (info === undefined) return;
    if (!info.runInBackground) this.handleForegroundSubagentSuspended(event, info);
  }

  private handleSubagentCompleted(
    event: SubagentLifecycleEventOf<'subagent.completed'>,
  ): void {
    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    if (backgroundMeta !== undefined) {
      const taskId = this.findAgentTaskId(
        event.subagentId,
        backgroundMeta,
        this.deps.backgroundTasks,
      );
      this.backgroundAgentMetadata.delete(event.subagentId);
      this.deps.syncBackgroundAgentBadge();
      if (taskId !== undefined && this.deps.backgroundTaskTranscriptedTerminal.has(taskId)) {
        return;
      }
      if (taskId !== undefined) {
        this.deps.backgroundTaskTranscriptedTerminal.add(taskId);
      }
      const extras =
        event.resultSummary === undefined ? undefined : { resultSummary: event.resultSummary };
      this.appendBackgroundAgentEntry('completed', backgroundMeta, extras);
      return;
    }

    const info = this.subagentInfo.get(event.subagentId);
    if (info === undefined || info.runInBackground) return;
    this.handleForegroundSubagentCompleted(event, info);
  }

  private handleSubagentFailed(
    event: SubagentLifecycleEventOf<'subagent.failed'>,
  ): void {
    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    if (backgroundMeta !== undefined) {
      const taskId = this.findAgentTaskId(
        event.subagentId,
        backgroundMeta,
        this.deps.backgroundTasks,
      );
      const task = taskId === undefined ? undefined : this.deps.backgroundTasks.get(taskId);
      this.backgroundAgentMetadata.delete(event.subagentId);
      this.deps.syncBackgroundAgentBadge();
      if (task?.kind === 'agent' && task.status === 'timed_out') {
        return;
      }
      this.host.streamingUI.applyBackgroundTaskTerminalStatus({
        agentId: event.subagentId,
        description: backgroundMeta.description ?? '',
        status: 'failed',
        errorText: event.error,
      });
      if (taskId !== undefined && this.deps.backgroundTaskTranscriptedTerminal.has(taskId)) {
        return;
      }
      if (taskId !== undefined) {
        this.deps.backgroundTaskTranscriptedTerminal.add(taskId);
      }
      this.appendBackgroundAgentEntry('failed', backgroundMeta, { error: event.error });
      return;
    }

    const info = this.subagentInfo.get(event.subagentId);
    if (info === undefined || info.runInBackground) return;
    this.handleForegroundSubagentFailed(event, info);
  }

  private findAgentTaskId(
    subagentId: string,
    meta: BackgroundAgentMetadata,
    backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>,
  ): string | undefined {
    for (const info of backgroundTasks.values()) {
      if (info.kind !== 'agent') continue;
      if (info.agentId === subagentId) return info.taskId;
    }
    const description = meta.description ?? meta.agentName;
    if (description === undefined) return undefined;
    let match: string | undefined;
    for (const info of backgroundTasks.values()) {
      if (info.kind !== 'agent') continue;
      if (info.description !== description) continue;
      if (match !== undefined) return undefined;
      match = info.taskId;
    }
    return match;
  }

  private buildBackgroundAgentMetadata(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): BackgroundAgentMetadata {
    const parent = this.host.streamingUI.getActiveToolCall(event.parentToolCallId);
    const description = parent?.args['description'] ?? event.description;
    return {
      agentId: event.subagentId,
      parentToolCallId: event.parentToolCallId,
      agentName: event.subagentName,
      description: typeof description === 'string' ? description : undefined,
    };
  }

  private appendBackgroundAgentEntry(
    phase: 'started' | 'completed' | 'failed',
    meta: BackgroundAgentMetadata,
    extras?: { resultSummary?: string; error?: string },
  ): void {
    const status = formatBackgroundAgentTranscript(phase, meta, extras);
    const entry: TranscriptEntry = {
      id: nextTranscriptId(),
      kind: 'status',
      turnId: this.host.streamingUI.getTurnContext().turnId,
      renderMode: 'plain',
      content: status.headline,
      detail: status.detail,
      backgroundAgentStatus: status,
    };
    this.host.appendTranscriptEntry(entry);
  }

  private rememberSubagent(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    this.subagentInfo.set(event.subagentId, {
      parentToolCallId: event.parentToolCallId,
      name: event.subagentName,
      runInBackground: event.runInBackground,
      dynamicWorkflowIndex: event.dynamicWorkflowIndex,
    });
  }

  private handleForegroundSubagentSpawned(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    if (this.updateDynamicWorkflowMissionControl(event.parentToolCallId, (missionControl) => {
      missionControl.registerSubagent({
        agentId: event.subagentId,
        dynamicWorkflowIndex: event.dynamicWorkflowIndex,
        description: event.description,
      });
    })) {
      return;
    }

    let tc = this.getOrActivateToolComponent(event.parentToolCallId);
    tc ??= this.createStandaloneSubagentToolCall(event);
    if (tc === undefined) return;
    tc.onSubagentSpawned({
      agentId: event.subagentId,
      agentName: event.subagentName,
      runInBackground: event.runInBackground,
    });
  }

  private handleForegroundSubagentStarted(
    event: SubagentLifecycleEventOf<'subagent.started'>,
    info: SubagentInfo,
  ): void {
    if (this.updateDynamicWorkflowMissionControl(info.parentToolCallId, (missionControl) => {
      missionControl.markStarted(event.subagentId);
    })) {
      return;
    }

    const tc = this.getOrActivateToolComponent(info.parentToolCallId);
    if (tc === undefined) return;
    tc.onSubagentStarted({
      agentId: event.subagentId,
      agentName: info.name,
      runInBackground: info.runInBackground,
    });
  }

  private handleForegroundSubagentSuspended(
    event: SubagentLifecycleEventOf<'subagent.suspended'>,
    info: SubagentInfo,
  ): void {
    this.updateDynamicWorkflowMissionControl(info.parentToolCallId, (missionControl) => {
      missionControl.markSuspended({
        agentId: event.subagentId,
        reason: event.reason,
        dynamicWorkflowIndex: info.dynamicWorkflowIndex,
      });
    });
  }

  private handleForegroundSubagentCompleted(
    event: SubagentLifecycleEventOf<'subagent.completed'>,
    info: SubagentInfo,
  ): void {
    const { parentToolCallId } = info;
    if (this.updateDynamicWorkflowMissionControl(parentToolCallId, (missionControl) => {
      missionControl.markCompleted(event.subagentId, event.resultSummary);
    })) {
      this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
      return;
    }

    const tc = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (tc === undefined) return;
    tc.onSubagentCompleted({
      contextTokens: event.contextTokens,
      usage: event.usage,
      resultSummary: event.resultSummary,
    });
    this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
  }

  private handleForegroundSubagentFailed(
    event: SubagentLifecycleEventOf<'subagent.failed'>,
    info: SubagentInfo,
  ): void {
    const { parentToolCallId } = info;
    if (this.updateDynamicWorkflowMissionControl(parentToolCallId, (missionControl) => {
      this.markDynamicWorkflowFailedOrCancelled(missionControl, event.subagentId, event.error);
    })) {
      this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
      return;
    }

    const tc = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (tc === undefined) return;
    tc.onSubagentFailed({ error: event.error });
    this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
  }

  private applySubagentEventToDynamicWorkflow(
    missionControl: DynamicWorkflowMissionControlComponent,
    event: Event,
    subagentId: string,
  ): void {
    if (event.type === 'assistant.delta' || event.type === 'thinking.delta') {
      missionControl.appendModelDelta({ agentId: subagentId, delta: event.delta });
    } else if (event.type === 'tool.call.started') {
      missionControl.recordToolCall({
        agentId: subagentId,
        name: event.name,
      });
    }
  }

  private updateDynamicWorkflowMissionControl(
    parentToolCallId: string,
    update: (missionControl: DynamicWorkflowMissionControlComponent) => void,
  ): boolean {
    const missionControl = this.dynamicWorkflowMissionControls.get(parentToolCallId);
    if (missionControl === undefined) return false;
    update(missionControl);
    this.requestRender();
    return true;
  }

  private ensureDynamicWorkflowMissionControl(
    toolCallId: string,
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string } = {},
  ): DynamicWorkflowMissionControlComponent {
    const existing = this.dynamicWorkflowMissionControls.get(toolCallId);
    if (existing !== undefined) {
      existing.updateArgs(args, options);
      return existing;
    }

    let missionControl: DynamicWorkflowMissionControlComponent | undefined;
    missionControl = new DynamicWorkflowMissionControlComponent({
      description: dynamicWorkflowDescriptionFromArgs(args),
      availableRows: () => this.dynamicWorkflowAvailableRows(missionControl),
    });
    missionControl.updateArgs(args, options);
    this.dynamicWorkflowMissionControls.set(toolCallId, missionControl);
    this.host.streamingUI.finalizeLiveTextBuffers('tool');
    this.host.state.transcriptContainer.addTranscriptChild(missionControl, {
      role: 'live-durable',
      edgeBlankPolicy: 'trim-plain',
    });
    this.host.updateActivityPane();
    this.requestRender();
    return missionControl;
  }

  private removeDynamicWorkflowMissionControl(
    toolCallId: string,
    missionControl: DynamicWorkflowMissionControlComponent,
  ): void {
    this.dynamicWorkflowMissionControls.delete(toolCallId);
    this.retiredDynamicWorkflowToolCallIds.add(toolCallId);
    this.forgetDynamicWorkflowSubagents(toolCallId);
    this.pendingLifecycleByParentToolCallId.delete(toolCallId);
    const children = this.host.state.transcriptContainer.children;
    const index = children.indexOf(missionControl);
    if (index >= 0) {
      children.splice(index, 1);
    }
    this.host.updateActivityPane();
  }

  private forgetDynamicWorkflowSubagents(toolCallId: string): void {
    for (const [agentId, info] of this.subagentInfo) {
      if (info.parentToolCallId !== toolCallId) continue;
      this.subagentInfo.delete(agentId);
    }
  }

  private dynamicWorkflowAvailableRows(missionControl: Component | undefined): number | undefined {
    const { state } = this.host;
    const terminalRows = state.ui.terminal.rows;
    const terminalColumns = state.ui.terminal.columns;
    if (!Number.isFinite(terminalRows)) return undefined;
    if (!Number.isFinite(terminalColumns) || terminalColumns <= 0) {
      return Math.max(0, Math.floor(terminalRows));
    }

    const width = Math.floor(terminalColumns);
    const followingTranscriptRows = missionControl === undefined
      ? 0
      : state.transcriptContainer.renderedRowsAfterChild(width, missionControl);
    // Under the fixed layout the transcript lives inside the layout root, so
    // the rows below it include the root's chrome + footer measurement and
    // later transcript siblings.
    const followingRows =
      state.layout === 'fixed'
        ? state.layoutRoot.followingRows(width) + followingTranscriptRows
        : renderedRowsAfterChild(state.ui.children, state.transcriptContainer, width);
    return Math.max(0, Math.floor(terminalRows) - Math.max(0, Math.floor(followingRows)));
  }

  private markDynamicWorkflowFailedOrCancelled(
    missionControl: DynamicWorkflowMissionControlComponent,
    subagentId: string,
    error: string,
  ): void {
    if (isUserCancelledSubagentError(error)) {
      missionControl.markCancelled(subagentId);
    } else {
      missionControl.markFailed(subagentId, error);
    }
  }

  private bufferPendingLifecycle(
    parentToolCallId: string,
    event: SubagentLifecycleEvent,
  ): void {
    // Keyed by parent tool call so a later workflow reusing the same agent id
    // cannot drain events left over from an earlier generation.
    const pendingByAgentId =
      this.pendingLifecycleByParentToolCallId.get(parentToolCallId) ?? new Map();
    const pending = pendingByAgentId.get(event.subagentId) ?? [];
    pending.push(event);
    pendingByAgentId.set(event.subagentId, pending);
    this.pendingLifecycleByParentToolCallId.set(parentToolCallId, pendingByAgentId);
  }

  private deletePendingLifecycle(parentToolCallId: string, agentId: string): void {
    const pendingByAgentId = this.pendingLifecycleByParentToolCallId.get(parentToolCallId);
    if (pendingByAgentId === undefined) return;
    pendingByAgentId.delete(agentId);
    if (pendingByAgentId.size === 0) {
      this.pendingLifecycleByParentToolCallId.delete(parentToolCallId);
    }
  }

  private drainPendingLifecycle(parentToolCallId: string, agentId: string): void {
    const pending = this.pendingLifecycleByParentToolCallId.get(parentToolCallId)?.get(agentId);
    if (pending === undefined) return;
    this.deletePendingLifecycle(parentToolCallId, agentId);
    for (const event of pending) this.handleLifecycleEvent(event);
  }

  private getOrActivateToolComponent(parentToolCallId: string) {
    let component = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (component !== undefined) return component;
    const toolCall = this.host.streamingUI.getActiveToolCall(parentToolCallId);
    if (toolCall === undefined) return undefined;
    this.host.streamingUI.onToolCallStart(toolCall);
    return this.host.streamingUI.getToolComponent(parentToolCallId);
  }

  private createStandaloneSubagentToolCall(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ) {
    const description = event.description ?? `Run ${event.subagentName} agent`;
    const { turnId, step } = this.host.streamingUI.getTurnContext();
    const toolCall: ToolCallBlockData = {
      id: event.parentToolCallId,
      name: 'Agent',
      args: {
        description,
        subagent_type: event.subagentName,
      },
      description,
      step,
      turnId,
    };
    this.host.streamingUI.onToolCallStart(toolCall);
    return this.host.streamingUI.getToolComponent(event.parentToolCallId);
  }

  private requestRender(): void {
    this.host.state.ui.requestRender();
  }
}

function isSubagentLifecycleEvent(event: Event): event is SubagentLifecycleEvent {
  return (
    event.type === 'subagent.spawned' ||
    event.type === 'subagent.started' ||
    event.type === 'subagent.suspended' ||
    event.type === 'subagent.completed' ||
    event.type === 'subagent.failed'
  );
}

function isUserCancelledSubagentError(error: string): boolean {
  // Structured Dynamic Workflow results use outcome="aborted" and are parsed separately.
  switch (error.trim()) {
    case 'Aborted by the user':
    case 'The user manually interrupted this subagent batch.':
      return true;
    default:
      return false;
  }
}
