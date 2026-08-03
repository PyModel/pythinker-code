import type { Component, Focusable } from '@earendil-works/pi-tui';
import type {
  AgentStatusUpdatedEvent,
  AssistantDeltaEvent,
  BackgroundTaskInfo,
  BackgroundTaskStartedEvent,
  BackgroundTaskTerminatedEvent,
  CompactionCancelledEvent,
  CompactionCompletedEvent,
  CompactionStartedEvent,
  CronFiredEvent,
  ErrorEvent,
  Event,
  GoalChange,
  GoalUpdatedEvent,
  HookResultEvent,
  HookStatusEvent,
  Session,
  SessionMetaUpdatedEvent,
  SkillActivatedEvent,
  ThinkingDeltaEvent,
  ToolCallDeltaEvent,
  ToolCallStartedEvent,
  ToolProgressEvent,
  ToolResultEvent,
  TurnEndedEvent,
  TurnStartedEvent,
  TurnStepCompletedEvent,
  TurnStepInterruptedEvent,
  TurnStepStartedEvent,
  WarningEvent,
} from '@pythoughts/pythinker-code-sdk';

import { ActivityLoader } from '../components/chrome/activity-loader';
import { buildGoalMarker } from '../components/messages/goal-markers';
import { StatusMessageComponent } from '../components/messages/status-message';
import {
  DynamicWorkflowModeMarkerComponent,
  type DynamicWorkflowModeMarkerState,
} from '../components/messages/dynamic-workflow-markers';
import {
  MCP_STATUS_TRANSIENT_DURATION_MS,
  OAUTH_LOGIN_REQUIRED_CODE,
  OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE,
} from '../constant/pythinker-tui';
import { FAILURE_MARK, STATUS_BULLET, SUCCESS_MARK } from '../constant/symbols';
import { buildGoalCompletionMessage } from '../utils/goal-completion';
import {
  argsRecord,
  formatErrorPayload,
  formatErrorMessage,
  normalizeTodoList,
  serializeToolResultOutput,
  stringValue,
} from '../utils/event-payload';
import {
  readGoalQueue,
  removeGoalQueueItem,
  restoreGoalQueueItem,
  type UpcomingGoal,
} from '../goal-queue-store';
import { formatBackgroundTaskTranscript } from '../utils/background-task-status';
import { formatHookResultMarkdown } from '../utils/hook-result-format';
import { McpOAuthAuthorizationUrlOpener } from '../utils/mcp-oauth';
import {
  buildMcpStartupStatusLine,
  formatMcpStartupStatusSummary,
  mcpServerStatusKey,
  type McpServerStatusSnapshot,
} from '../utils/mcp-server-status';
import { openUrl } from '#/utils/open-url';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import { errorReportHintLine } from '../constant/feedback';
import { formatStepDebugTiming } from '#/utils/usage/debug-timing';
import { nextTranscriptId } from '../utils/transcript-id';
import type { BtwPanelController } from './btw-panel';
import type { StreamingUIController } from './streaming-ui';
import type { TasksBrowserController } from './tasks-browser';
import { SubAgentEventHandler } from './subagent-event-handler';
import type {
  AppState,
  LivePaneState,
  QueuedMessage,
  ToolCallBlockData,
  ToolResultBlockData,
  TranscriptEntry,
} from '../types';
import type { TUIState } from '../tui-state';
import type { FooterEvent } from '../runtime/footer/footer-model';
import { createGoal as startGoalCommand } from '../commands/goal';

function mcpStatusAnimationEnabled(): boolean {
  if (process.env['PYTHINKER_NO_ANIMATION']) return false;
  if (process.env['CI']) return false;
  if (process.env['NO_COLOR']) return false;
  return true;
}

export interface SessionEventHost {
  state: TUIState;
  session: Session | undefined;
  aborted: boolean;
  sessionEventUnsubscribe: (() => void) | undefined;
  readonly streamingUI: StreamingUIController;

  requireSession(): Session;
  setAppState(patch: Partial<AppState>): void;
  dispatchFooter(event: FooterEvent): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  resetLivePane(): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string): void;
  updateActivityPane(): void;
  track(event: string, props?: Record<string, unknown>): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  restoreInputText(text: string): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  sendNormalUserInput(text: string): void;
  updateTerminalTitle(): void;
  refreshSkillCommands(session?: Session): Promise<void>;
  sendQueuedMessage(session: Session, item: QueuedMessage): void;
  shiftQueuedMessage(): QueuedMessage | undefined;
  readonly btwPanelController: BtwPanelController;
  readonly tasksBrowserController: TasksBrowserController;
}

export class SessionEventHandler {
  readonly subAgentEventHandler: SubAgentEventHandler;

  constructor(private readonly host: SessionEventHost) {
    this.subAgentEventHandler = new SubAgentEventHandler(host, {
      backgroundTasks: this.backgroundTasks,
      backgroundTaskTranscriptedTerminal: this.backgroundTaskTranscriptedTerminal,
      syncBackgroundAgentBadge: () => {
        this.syncBackgroundTaskBadge();
      },
    });
  }

  // Runtime state – owned by this handler, reset between sessions.
  backgroundTasks: Map<string, BackgroundTaskInfo> = new Map();
  backgroundTaskTranscriptedTerminal: Set<string> = new Set();

  renderedSkillActivationIds: Set<string> = new Set();
  renderedMcpServerStatusKeys: Map<string, string> = new Map();
  hookStatusSpinners: Map<string, ActivityLoader> = new Map();
  mcpServers: Map<string, McpServerStatusSnapshot> = new Map();
  private mcpServerStatusRow: ActivityLoader | StatusMessageComponent | undefined;
  private mcpServerStatusTimer: ReturnType<typeof setTimeout> | undefined;
  private mcpServerSnapshotReady = false;
  private mcpServerSnapshotEpoch = 0;
  private mcpLiveServerNames = new Set<string>();
  private goalCompletionAwaitingClear = false;
  private goalCompletionTurnEnded = false;
  private currentTurnHasAssistantText = false;
  private pendingModelBlockedFallback: GoalChange | undefined;
  private queuedGoalPromotionPending = false;
  private queuedGoalPromotionInFlight = false;
  private queuedGoalPromotionTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly liveTokenSpeedByAgent = new Map<
    string,
    { turnId: number; startedAtMs: number; asciiChars: number; nonAsciiChars: number }
  >();

  resetRuntimeState(): void {
    this.backgroundTasks.clear();
    this.backgroundTaskTranscriptedTerminal.clear();
    this.subAgentEventHandler.resetRuntimeState();
    this.renderedSkillActivationIds.clear();
    this.renderedMcpServerStatusKeys.clear();
    this.mcpServers.clear();
    this.mcpServerSnapshotReady = false;
    this.mcpServerSnapshotEpoch += 1;
    this.mcpLiveServerNames.clear();
    this.goalCompletionAwaitingClear = false;
    this.goalCompletionTurnEnded = false;
    this.currentTurnHasAssistantText = false;
    this.pendingModelBlockedFallback = undefined;
    this.queuedGoalPromotionPending = false;
    this.queuedGoalPromotionInFlight = false;
    this.liveTokenSpeedByAgent.clear();
    this.clearQueuedGoalPromotionTimer();
    this.disposeHookStatusRows();
    this.disposeMcpServerStatusRows();
    // Fast mode is session-scoped; a runtime reset must clear it with the rest.
    this.host.setAppState({
      modelCostRates: undefined,
      totalCostUsd: undefined,
      fastMode: false,
      fastModeSupported: false,
    });
    this.host.dispatchFooter({
      type: 'status.updated',
      changes: {
        tokenSpeed: null,
        tokenSpeedEstimated: false,
        sessionSpendUsd: undefined,
      },
    });
  }

  clearDynamicWorkflowMissionControls(): void {
    this.subAgentEventHandler.clearDynamicWorkflowMissionControls();
  }

  hasDynamicWorkflowMissionControl(toolCallId: string): boolean {
    return this.subAgentEventHandler.hasDynamicWorkflowMissionControl(toolCallId);
  }

  hasActiveDynamicWorkflowToolCall(): boolean {
    return this.subAgentEventHandler.hasActiveDynamicWorkflowToolCall();
  }

  syncDynamicWorkflowActivitySpinner(spinner: ActivityLoader | undefined): void {
    this.subAgentEventHandler.syncDynamicWorkflowActivitySpinner(spinner);
  }

  startSubscription(): void {
    const { host } = this;
    const session = host.requireSession();
    const sendQueued = (item: QueuedMessage): void => {
      host.sendQueuedMessage(session, item);
    };
    host.sessionEventUnsubscribe?.();
    const mcpOAuthOpener = new McpOAuthAuthorizationUrlOpener(openUrl);
    const { sessionId } = host.state.appState;
    host.sessionEventUnsubscribe = session.onEvent((event) => {
      if (host.aborted) return;
      if (event.sessionId !== sessionId) return;
      if (event.type === 'tool.progress') {
        mcpOAuthOpener.handleToolProgress(event);
      }
      this.handleEvent(event, sendQueued);
    });
    void this.syncMcpServerStatusSnapshot(session);
  }

  async syncMcpServerStatusSnapshot(session: Session): Promise<void> {
    const { host } = this;
    const snapshotEpoch = ++this.mcpServerSnapshotEpoch;
    this.mcpServerSnapshotReady = false;
    this.showMcpServerStatusLoader('MCP servers · loading…', 'primary');
    let servers: readonly McpServerStatusSnapshot[];
    try {
      servers = await session.listMcpServers();
    } catch (error) {
      if (snapshotEpoch !== this.mcpServerSnapshotEpoch) return;
      if (host.session !== session || host.aborted) return;
      this.removeMcpServerStatusRow();
      const message = error instanceof Error ? error.message : String(error);
      host.showError(`Failed to sync MCP server status: ${message}`);
      return;
    }
    if (snapshotEpoch !== this.mcpServerSnapshotEpoch) return;
    if (host.session !== session || host.state.appState.sessionId !== session.id) return;

    const liveServers = [...this.mcpServers].filter(([name]) => this.mcpLiveServerNames.has(name));
    this.mcpServers.clear();
    for (const [name, server] of liveServers) this.mcpServers.set(name, server);
    for (const server of servers) {
      if (this.mcpLiveServerNames.has(server.name)) continue;
      this.mcpServers.set(server.name, server);
      this.renderedMcpServerStatusKeys.set(server.name, mcpServerStatusKey(server));
    }
    this.mcpServerSnapshotReady = true;
    this.syncMcpServerSummary();
    this.renderMcpServerStatusRow();
    void host.refreshSkillCommands(session);
  }

  handleEvent(event: Event, sendQueued: (item: QueuedMessage) => void): void {
    this.trackTokenSpeed(event);
    if (this.subAgentEventHandler.routeChildAgentEvent(event)) return;

    if ('turnId' in event && event.turnId !== undefined) {
      this.host.streamingUI.setTurnId(String(event.turnId));
    }

    switch (event.type) {
      case 'turn.started': this.handleTurnBegin(event); break;
      case 'turn.ended': this.handleTurnEnd(event, sendQueued); break;
      case 'turn.step.started': this.handleStepBegin(event); break;
      case 'turn.step.interrupted': this.handleStepInterrupted(event); break;
      case 'turn.step.completed': this.handleStepCompleted(event); break;
      case 'turn.step.retrying': break;
      case 'tool.progress': this.handleToolProgress(event); break;
      case 'assistant.delta': this.handleAssistantDelta(event); break;
      case 'hook.result': this.handleHookResult(event); break;
      case 'hook.status': this.handleHookStatus(event); break;
      case 'thinking.delta': this.handleThinkingDelta(event); break;
      case 'tool.call.started': this.handleToolCall(event); break;
      case 'tool.call.delta': this.handleToolCallDelta(event); break;
      case 'tool.result': this.handleToolResult(event); break;
      case 'agent.status.updated': this.handleStatusUpdate(event); break;
      case 'session.meta.updated': this.handleSessionMetaChanged(event); break;
      case 'goal.updated': this.handleGoalUpdated(event); break;
      case 'skill.activated': this.handleSkillActivated(event); break;
      case 'error': this.handleSessionError(event); break;
      case 'warning': this.handleSessionWarning(event); break;
      case 'compaction.started': this.handleCompactionBegin(event); break;
      case 'compaction.completed': this.handleCompactionEnd(event, sendQueued); break;
      case 'compaction.blocked': break;
      case 'compaction.cancelled': this.handleCompactionCancel(event, sendQueued); break;
      case 'subagent.spawned':
      case 'subagent.started':
      case 'subagent.suspended':
      case 'subagent.completed':
      case 'subagent.failed':
        this.subAgentEventHandler.handleLifecycleEvent(event); break;
      case 'background.task.started':
      case 'background.task.terminated':
        this.handleBackgroundTaskEvent(event); break;
      case 'cron.fired': this.handleCronFired(event); break;
      case 'mcp.server.status': this.renderMcpServerStatus(event.server); break;
      case 'tool.list.updated': break;
      default: break;
    }
  }

  disposeMcpServerStatusRows(): void {
    this.removeMcpServerStatusRow();
  }

  private handleHookStatus(event: HookStatusEvent): void {
    const { state } = this.host;
    const existing = this.hookStatusSpinners.get(event.statusId);
    if (!event.active) {
      if (existing === undefined) return;
      existing.stop();
      state.transcriptContainer.removeChild(existing);
      this.hookStatusSpinners.delete(event.statusId);
      state.ui.requestRender();
      return;
    }
    if (existing !== undefined) {
      existing.setLabel(event.content);
      return;
    }
    const tint = (text: string): string => currentTheme.fg('textMuted', text);
    const spinner = new ActivityLoader(state.ui, tint, event.content);
    state.transcriptContainer.addChild(spinner);
    this.hookStatusSpinners.set(event.statusId, spinner);
    state.ui.requestRender();
  }

  private disposeHookStatusRows(): void {
    for (const spinner of this.hookStatusSpinners.values()) {
      spinner.stop();
      this.host.state.transcriptContainer.removeChild(spinner);
    }
    this.hookStatusSpinners.clear();
  }

  // ---------------------------------------------------------------------------
  // Private handlers
  // ---------------------------------------------------------------------------

  private handleTurnBegin(_event: TurnStartedEvent): void {
    void _event;
    this.currentTurnHasAssistantText = false;
    // Throughput belongs to the finished turn; clear it so a stale t/s rate
    // never bleeds into the next turn.
    this.host.dispatchFooter({
      type: 'status.updated',
      changes: { tokenSpeed: null, tokenSpeedEstimated: false },
    });
    this.clearDynamicWorkflowMissionControls();
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.setStep(0);
    this.host.patchLivePane({
      mode: 'waiting',
      pendingApproval: null,
      pendingQuestion: null,
    });
    this.host.setAppState({
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
  }

  private handleCronFired(event: CronFiredEvent): void {
    this.host.streamingUI.flushNow();
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'cron',
      turnId: this.host.streamingUI.getTurnContext().turnId,
      renderMode: 'plain',
      content: event.prompt,
      cronData: {
        jobId: event.origin.jobId,
        cron: event.origin.cron,
        recurring: event.origin.recurring,
        coalescedCount: event.origin.coalescedCount,
        stale: event.origin.stale,
      },
    });
  }

  private handleTurnEnd(event: TurnEndedEvent, sendQueued: (item: QueuedMessage) => void): void {
    this.host.streamingUI.flushNow();
    this.host.dispatchFooter({
      type: 'status.updated',
      changes: { tokenSpeed: null, tokenSpeedEstimated: false },
    });
    if (event.reason === 'cancelled') {
      this.markActiveDynamicWorkflowsCancelled();
    }
    const todos = this.host.state.todoPanel.getTodos();
    if (todos.length > 0 && todos.every((t) => t.status === 'done')) {
      this.host.streamingUI.setTodoList([]);
    }
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeTurn(sendQueued);
    this.renderPendingModelBlockedFallback();
    this.currentTurnHasAssistantText = false;
    this.goalCompletionTurnEnded = true;
    this.scheduleQueuedGoalPromotion();
  }

  private handleStepBegin(event: TurnStepStartedEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.setStep(event.step);
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('waiting');
    this.host.patchLivePane({
      mode: 'waiting',
      pendingApproval: null,
      pendingQuestion: null,
    });
    this.host.setAppState({
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
  }

  private handleStepCompleted(event: TurnStepCompletedEvent): void {
    this.host.streamingUI.flushNow();
    this.maybeShowDebugTiming(event);
    if (event.finishReason !== 'max_tokens') return;

    const truncatedCount = this.host.streamingUI.markStepTruncated(
      String(event.turnId),
      event.step,
    );

    const title =
      truncatedCount > 0
        ? 'Model hit max_tokens — tool call was truncated before it could run.'
        : 'Model hit max_tokens — no tool call was emitted.';
    const detail = this.isAnthropicSessionActive()
      ? 'If this limit is wrong for your model, set `max_output_size` on the model alias in your pythinker-code config.'
      : undefined;
    this.host.showNotice(title, detail);
  }

  private trackTokenSpeed(event: Event): void {
    if (this.host.state.appState.isReplaying) return;
    if (
      event.type === 'turn.step.started' ||
      event.type === 'turn.step.retrying' ||
      event.type === 'turn.step.interrupted' ||
      event.type === 'turn.ended'
    ) {
      this.liveTokenSpeedByAgent.delete(event.agentId);
      return;
    }
    if (event.type === 'turn.step.completed') {
      this.updateCompletedTokenSpeed(event);
      this.liveTokenSpeedByAgent.delete(event.agentId);
      return;
    }

    if (
      event.type !== 'assistant.delta' &&
      event.type !== 'thinking.delta' &&
      event.type !== 'tool.call.delta'
    ) return;
    const delta = event.type === 'tool.call.delta' ? event.argumentsPart : event.delta;
    if (delta === undefined || delta.length === 0) return;

    let asciiChars = 0;
    let nonAsciiChars = 0;
    for (const char of delta) {
      if (char.codePointAt(0)! <= 0x7f) asciiChars += 1;
      else nonAsciiChars += 1;
    }

    const current = this.liveTokenSpeedByAgent.get(event.agentId);
    if (current === undefined || current.turnId !== event.turnId) {
      this.liveTokenSpeedByAgent.set(event.agentId, {
        turnId: event.turnId,
        startedAtMs: Date.now(),
        asciiChars,
        nonAsciiChars,
      });
      return;
    }

    current.asciiChars += asciiChars;
    current.nonAsciiChars += nonAsciiChars;
    const estimatedTokens = Math.ceil(current.asciiChars / 4) + current.nonAsciiChars;
    const durationMs = Date.now() - current.startedAtMs;
    if (estimatedTokens < 2 || durationMs <= 0) return;
    this.host.dispatchFooter({
      type: 'status.updated',
      changes: {
        tokenSpeed: ((estimatedTokens - 1) * 1_000) / durationMs,
        tokenSpeedEstimated: true,
      },
    });
  }

  private updateCompletedTokenSpeed(event: TurnStepCompletedEvent): void {
    const outputTokens = event.usage?.output;
    const durationMs = event.llmStreamDurationMs;
    if (
      outputTokens === undefined ||
      durationMs === undefined ||
      !Number.isFinite(outputTokens) ||
      !Number.isFinite(durationMs) ||
      outputTokens < 2 ||
      durationMs <= 0
    ) {
      return;
    }
    this.host.dispatchFooter({
      type: 'status.updated',
      changes: {
        tokenSpeed: ((outputTokens - 1) * 1_000) / durationMs,
        tokenSpeedEstimated: false,
      },
    });
  }

  private maybeShowDebugTiming(event: TurnStepCompletedEvent): void {
    if (process.env['PYTHINKER_CODE_DEBUG'] !== '1') return;
    const text = formatStepDebugTiming(event);
    if (text !== undefined) this.host.showStatus(text);
  }

  private markActiveDynamicWorkflowsCancelled(): void {
    this.subAgentEventHandler.markActiveDynamicWorkflowsCancelled();
  }

  private isAnthropicSessionActive(): boolean {
    const { state } = this.host;
    const providerKey = state.appState.availableModels[state.appState.model]?.provider;
    if (providerKey === undefined) return false;
    return state.appState.availableProviders[providerKey]?.type === 'anthropic';
  }

  private handleStepInterrupted(event: TurnStepInterruptedEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('idle');
    const reason = event.reason;
    if (reason === 'error') return;
    if (reason === 'aborted' || reason === undefined || reason === '') {
      this.markActiveDynamicWorkflowsCancelled();
      this.host.showStatus('Interrupted by user', 'error');
      return;
    }
    this.host.showError(
      reason === 'max_steps'
        ? 'reached per-turn step limit (max_steps)'
        : `step interrupted (${reason})`,
    );
  }

  private handleThinkingDelta(event: ThinkingDeltaEvent): void {
    const { state, streamingUI } = this.host;
    if (event.delta.trim().length === 0 && !streamingUI.hasThinkingDraft()) return;
    streamingUI.appendThinkingDelta(event.delta);
    this.host.patchLivePane({ mode: 'idle' });
    if (state.appState.streamingPhase !== 'thinking') {
      this.host.setAppState({ streamingPhase: 'thinking', streamingStartTime: Date.now() });
    }
    streamingUI.scheduleFlush();
  }

  private handleAssistantDelta(event: AssistantDeltaEvent): void {
    const { state, streamingUI } = this.host;
    if (streamingUI.hasThinkingDraft()) {
      streamingUI.flushThinkingToTranscript('idle');
    }

    if (event.delta.trim().length > 0) {
      this.currentTurnHasAssistantText = true;
      this.pendingModelBlockedFallback = undefined;
    }
    streamingUI.appendAssistantDelta(event.delta);

    this.host.patchLivePane({
      mode: 'idle',
      pendingApproval: null,
      pendingQuestion: null,
    });
    if (state.appState.streamingPhase !== 'composing') {
      this.host.setAppState({ streamingPhase: 'composing', streamingStartTime: Date.now() });
    }
    streamingUI.scheduleFlush();
  }

  private handleHookResult(event: HookResultEvent): void {
    this.host.streamingUI.flushNow();
    if (this.host.streamingUI.hasThinkingDraft()) {
      this.host.streamingUI.flushThinkingToTranscript('idle');
    }
    this.host.streamingUI.finalizeAssistantStream();
    if (event.content.trim().length > 0) {
      this.currentTurnHasAssistantText = true;
      this.pendingModelBlockedFallback = undefined;
    }
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'assistant',
      turnId: String(event.turnId),
      renderMode: 'markdown',
      content: formatHookResultMarkdown(event),
    });
    this.host.patchLivePane({
      mode: 'idle',
      pendingApproval: null,
      pendingQuestion: null,
    });
  }

  private handleToolCall(event: ToolCallStartedEvent): void {
    // A retired Dynamic Workflow tool call (undo / turn cleanup) must not
    // remount streaming UI when the model replays it late.
    if (
      event.name === 'DynamicWorkflow' &&
      this.subAgentEventHandler.isRetiredDynamicWorkflowToolCall(event.toolCallId)
    ) {
      return;
    }
    const { streamingUI } = this.host;
    streamingUI.flushNow();
    const { turnId, step } = streamingUI.getTurnContext();
    const toolCall: ToolCallBlockData = {
      id: event.toolCallId,
      name: event.name,
      args: argsRecord(event.args),
      description: event.description,
      display: event.display,
      step,
      turnId,
    };
    streamingUI.registerToolCall(toolCall);
    if (event.name === 'DynamicWorkflow') {
      this.subAgentEventHandler.handleDynamicWorkflowToolCallStarted(event.toolCallId, toolCall.args);
    }
    this.host.patchLivePane({
      mode: 'tool',
      pendingApproval: null,
      pendingQuestion: null,
    });
  }

  private handleToolCallDelta(event: ToolCallDeltaEvent): void {
    if (
      event.toolCallId.length === 0 ||
      // Late deltas for a retired workflow would re-create its mission control.
      this.subAgentEventHandler.isRetiredDynamicWorkflowToolCall(event.toolCallId)
    ) {
      return;
    }
    const { state, streamingUI } = this.host;
    streamingUI.accumulateToolCallDelta(event.toolCallId, event.name, event.argumentsPart);
    const preview = streamingUI.getStreamingToolCallPreview(event.toolCallId);
    if (
      preview !== undefined &&
      preview.name === 'DynamicWorkflow'
    ) {
      this.subAgentEventHandler.handleDynamicWorkflowToolCallDelta(event.toolCallId, preview.args, {
        streamingArguments: preview.argumentsText,
      });
    }

    this.host.patchLivePane({
      mode: 'tool',
      pendingApproval: null,
      pendingQuestion: null,
    });
    if (state.appState.streamingPhase !== 'composing') {
      this.host.setAppState({ streamingPhase: 'composing', streamingStartTime: Date.now() });
    }
    streamingUI.scheduleFlush();
  }

  private handleToolProgress(event: ToolProgressEvent): void {
    const text = event.update.text;
    if (text === undefined || text.length === 0) return;
    const tc = this.host.streamingUI.getToolComponent(event.toolCallId);
    if (tc === undefined) return;
    if (event.update.kind === 'status') {
      tc.appendProgress(text);
      return;
    }
    if (event.update.kind === 'stdout' || event.update.kind === 'stderr') {
      tc.appendLiveOutput(text);
    }
  }

  private handleToolResult(event: ToolResultEvent): void {
    const { streamingUI } = this.host;
    streamingUI.flushNow();
    const resultData: ToolResultBlockData = {
      tool_call_id: event.toolCallId,
      output: serializeToolResultOutput(event.output),
      is_error: event.isError,
      synthetic: event.synthetic,
    };
    const matchedCall = streamingUI.completeToolResult(event.toolCallId, resultData);
    if (matchedCall?.name === 'DynamicWorkflow') {
      this.subAgentEventHandler.handleDynamicWorkflowToolResult(
        event.toolCallId,
        resultData,
        event.isError === true,
      );
    }
    if (matchedCall !== undefined && matchedCall.name === 'TodoList' && !event.isError) {
      const rawTodos = (matchedCall.args as { todos?: unknown }).todos;
      if (Array.isArray(rawTodos)) {
        streamingUI.setTodoList(normalizeTodoList(rawTodos));
      }
    }
    this.host.patchLivePane({ mode: 'waiting' });
  }

  private handleStatusUpdate(event: AgentStatusUpdatedEvent): void {
    const shouldRenderDynamicWorkflowEnded =
      event.dynamicWorkflowMode === false &&
      this.host.state.appState.dynamicWorkflowMode &&
      this.host.state.dynamicWorkflowModeEntry === 'task';
    const patch: Partial<AppState> = {};
    if (event.contextUsage !== undefined) patch.contextUsage = event.contextUsage;
    if (event.contextTokens !== undefined) patch.contextTokens = event.contextTokens;
    if (event.maxContextTokens !== undefined) patch.maxContextTokens = event.maxContextTokens;
    if (event.planMode !== undefined) patch.planMode = event.planMode;
    if (event.dynamicWorkflowMode !== undefined) patch.dynamicWorkflowMode = event.dynamicWorkflowMode;
    if (event.fastMode !== undefined) patch.fastMode = event.fastMode;
    if (event.fastModeSupported !== undefined) patch.fastModeSupported = event.fastModeSupported;
    if (event.permission !== undefined) {
      patch.permissionMode = event.permission;
    }
    if (event.model !== undefined) {
      patch.model = event.model;
      patch.modelCostRates = event.modelCostRates;
      // A model switch invalidates Fast mode support unless the status event
      // carried explicit fast-mode fields for the new model.
      if (event.fastMode === undefined) patch.fastMode = false;
      if (event.fastModeSupported === undefined) patch.fastModeSupported = false;
    } else if (event.modelCostRates !== undefined) {
      patch.modelCostRates = event.modelCostRates;
    }
    if (event.usage !== undefined) patch.totalCostUsd = event.usage.totalCostUsd;
    if (Object.keys(patch).length > 0) this.host.setAppState(patch);
    if (event.usage !== undefined) {
      this.host.dispatchFooter({
        type: 'status.updated',
        changes: {
          sessionSpendUsd: event.usage.totalCostUsd,
        },
      });
    }
    if (event.dynamicWorkflowMode === false) {
      this.host.state.dynamicWorkflowModeEntry = undefined;
      if (shouldRenderDynamicWorkflowEnded) {
        this.renderDynamicWorkflowModeMarker('ended');
      }
    }
  }

  private renderDynamicWorkflowModeMarker(state: DynamicWorkflowModeMarkerState): void {
    this.host.state.transcriptContainer.addChild(
      new DynamicWorkflowModeMarkerComponent(state),
    );
    this.host.state.ui.requestRender();
  }

  private handleGoalUpdated(event: GoalUpdatedEvent): void {
    this.host.setAppState({ goal: event.snapshot });
    if (event.snapshot === null && this.goalCompletionAwaitingClear) {
      this.goalCompletionAwaitingClear = false;
      this.queuedGoalPromotionPending = true;
      this.scheduleQueuedGoalPromotion();
    }
    if (event.snapshot === null) {
      this.pendingModelBlockedFallback = undefined;
    }
    const change = event.change;
    if (change === undefined) return;
    const { state } = this.host;

    // Completion -> the box disappears (snapshot cleared on the follow-up null
    // update) and a deterministic completion message lands in the transcript.
    // Resume renders the same text from the durable goal completion replay
    // record, so live and replayed completion cards stay identical.
    if (change.kind === 'completion' && event.snapshot !== null) {
      this.pendingModelBlockedFallback = undefined;
      this.goalCompletionAwaitingClear = true;
      this.goalCompletionTurnEnded = false;
      this.host.appendTranscriptEntry({
        id: nextTranscriptId(),
        kind: 'assistant',
        renderMode: 'markdown',
        content: buildGoalCompletionMessage(event.snapshot),
      });
      state.ui.requestRender();
      return;
    }

    // Lifecycle change (pause / resume / blocked) -> a low-profile,
    // ctrl+o-expandable marker.
    if (change.kind === 'lifecycle' && change.status === 'blocked') {
      void this.notifyQueuedGoalWaitingOnBlocked();
      if (change.actor === 'model' || change.reason === undefined) {
        this.pendingModelBlockedFallback = this.currentTurnHasAssistantText
          ? undefined
          : change;
        return;
      }
      this.pendingModelBlockedFallback = undefined;
    } else if (change.kind === 'lifecycle') {
      this.pendingModelBlockedFallback = undefined;
    }
    const marker = buildGoalMarker(change, state.toolOutputExpanded, change.actor);
    if (marker !== null) {
      state.transcriptContainer.addChild(marker);
      state.ui.requestRender();
    }
  }

  private renderPendingModelBlockedFallback(): void {
    const change = this.pendingModelBlockedFallback;
    if (change === undefined) return;
    this.pendingModelBlockedFallback = undefined;
    const { state } = this.host;
    const marker = buildGoalMarker(change, state.toolOutputExpanded, 'model');
    if (marker !== null) {
      state.transcriptContainer.addChild(marker);
      state.ui.requestRender();
    }
  }

  private scheduleQueuedGoalPromotion(): void {
    if (!this.queuedGoalPromotionPending || !this.goalCompletionTurnEnded) return;
    if (this.queuedGoalPromotionInFlight) return;
    if (this.queuedGoalPromotionTimer !== undefined) return;
    this.queuedGoalPromotionTimer = setTimeout(() => {
      this.queuedGoalPromotionTimer = undefined;
      if (!this.queuedGoalPromotionPending || !this.goalCompletionTurnEnded) return;
      if (this.queuedGoalPromotionInFlight) return;
      if (!this.isReadyForQueuedGoalPromotion()) {
        return;
      }
      this.queuedGoalPromotionInFlight = true;
      void this.promoteNextQueuedGoal()
        .then((complete) => {
          if (complete) {
            this.queuedGoalPromotionPending = false;
            this.goalCompletionTurnEnded = false;
            return;
          }
          this.goalCompletionTurnEnded = false;
        })
        .finally(() => {
          this.queuedGoalPromotionInFlight = false;
          this.scheduleQueuedGoalPromotion();
        });
    }, 0);
  }

  private clearQueuedGoalPromotionTimer(): void {
    if (this.queuedGoalPromotionTimer === undefined) return;
    clearTimeout(this.queuedGoalPromotionTimer);
    this.queuedGoalPromotionTimer = undefined;
  }

  requestQueuedGoalPromotion(): void {
    this.queuedGoalPromotionPending = true;
    this.goalCompletionTurnEnded = true;
    this.scheduleQueuedGoalPromotion();
  }

  retryQueuedGoalPromotion(): void {
    this.scheduleQueuedGoalPromotion();
  }

  private isReadyForQueuedGoalPromotion(session?: Session): boolean {
    return (
      (session === undefined || this.host.session === session) &&
      !this.host.aborted &&
      this.host.state.appState.streamingPhase === 'idle' &&
      this.host.state.queuedMessages.length === 0
    );
  }

  private async promoteNextQueuedGoal(): Promise<boolean> {
    const { host } = this;
    const session = host.session;
    if (session === undefined || host.aborted) return true;

    let queue;
    try {
      queue = await readGoalQueue(session);
    } catch (error) {
      host.showError(`Failed to read upcoming goals: ${formatErrorMessage(error)}`);
      return false;
    }
    if (host.session !== session || host.aborted) return true;

    const next = queue.goals[0];
    if (next === undefined) return true;

    if (!this.isReadyForQueuedGoalPromotion(session)) return false;

    const started = await startGoalCommand(
      host,
      { kind: 'create', objective: next.objective, replace: false },
      next.objective,
      {
        beforeSend: async () => {
          if (!this.isReadyForQueuedGoalPromotion(session)) {
            await this.cancelStartedQueuedGoal(session);
            return false;
          }
          try {
            await removeGoalQueueItem(session, { goalId: next.id });
          } catch (error) {
            host.showError(
              `Queued goal started, but could not be removed from the queue: ${formatErrorMessage(error)}`,
            );
            await this.cancelStartedQueuedGoal(session);
            return false;
          }
          if (this.isReadyForQueuedGoalPromotion(session)) {
            return true;
          }
          await this.restoreAndCancelStartedQueuedGoal(session, next);
          return false;
        },
        sendInput: (objective) => {
          host.sendQueuedMessage(session, { text: objective });
        },
      },
    );
    return started || host.session !== session || host.aborted;
  }

  private async restoreAndCancelStartedQueuedGoal(
    session: Session,
    goal: UpcomingGoal,
  ): Promise<void> {
    try {
      await restoreGoalQueueItem(session, goal);
    } catch (error) {
      this.host.showError(`Queued goal could not be restored: ${formatErrorMessage(error)}`);
    }
    await this.cancelStartedQueuedGoal(session);
  }

  private async cancelStartedQueuedGoal(session: Session): Promise<void> {
    try {
      await session.cancelGoal();
    } catch (error) {
      this.host.showError(`Queued goal could not be cancelled: ${formatErrorMessage(error)}`);
    }
  }

  private async notifyQueuedGoalWaitingOnBlocked(): Promise<void> {
    const { host } = this;
    const session = host.session;
    if (session === undefined || host.aborted) return;

    let hasQueuedGoal = false;
    try {
      const queue = await readGoalQueue(session);
      hasQueuedGoal = queue.goals.length > 0;
    } catch {
      return;
    }
    if (!hasQueuedGoal || host.session !== session || host.aborted) return;

    host.showNotice(
      'Goal blocked.',
      'The next queued goal will start only after this goal is complete.',
    );
  }

  private handleSessionMetaChanged(event: SessionMetaUpdatedEvent): void {
    const title = event.title ?? stringValue(event.patch?.['title']);
    if (title !== undefined) {
      this.host.setAppState({ sessionTitle: title });
      this.host.updateTerminalTitle();
    }
  }

  private handleSessionError(event: ErrorEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('idle');
    this.clearDynamicWorkflowMissionControls();
    if (event.code === OAUTH_LOGIN_REQUIRED_CODE) {
      this.host.showError(OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE);
      return;
    }
    this.host.showError(formatErrorPayload(event));
    const sessionId = this.host.state.appState.sessionId;
    if (sessionId.length > 0) {
      this.host.showStatus(errorReportHintLine());
    }
  }

  private handleSessionWarning(event: WarningEvent): void {
    this.host.showStatus(`Warning: ${event.message}`, 'warning');
  }

  private renderMcpServerStatus(server: McpServerStatusSnapshot): void {
    const key = mcpServerStatusKey(server);
    if (this.renderedMcpServerStatusKeys.get(server.name) === key) return;
    this.renderedMcpServerStatusKeys.set(server.name, key);
    this.mcpLiveServerNames.add(server.name);
    this.mcpServers.set(server.name, server);
    void this.host.refreshSkillCommands(this.host.session);
    if (!this.mcpServerSnapshotReady) return;
    this.syncMcpServerSummary();
    this.renderMcpServerStatusRow();
  }

  private showMcpServerStatusLoader(label: string, color: ColorToken): void {
    const existing = this.mcpServerStatusRow;
    const tint = (text: string): string => currentTheme.fg(color, text);
    if (existing instanceof ActivityLoader) {
      existing.setColorFn(tint);
      existing.setLabel(label);
      return;
    }
    this.replaceMcpServerStatusRow(new ActivityLoader(this.host.state.ui, tint, label));
  }

  private renderMcpServerStatusRow(): void {
    if (!this.mcpServerSnapshotReady) return;
    const line = buildMcpStartupStatusLine([...this.mcpServers.values()]);
    if (line === null) {
      this.removeMcpServerStatusRow();
      return;
    }
    if (line.loading) {
      this.showMcpServerStatusLoader(line.label, line.color);
      return;
    }

    const mark = line.color === 'success'
      ? SUCCESS_MARK
      : line.color === 'error'
        ? FAILURE_MARK
        : STATUS_BULLET;
    const status = new StatusMessageComponent(`${mark}${line.label}`, line.color);
    this.replaceMcpServerStatusRow(status);
    if (!line.transient) return;
    if (!mcpStatusAnimationEnabled()) {
      this.removeMcpServerStatusRow();
      return;
    }

    const timer = setTimeout(() => {
      if (this.mcpServerStatusRow !== status) return;
      this.removeMcpServerStatusRow();
    }, MCP_STATUS_TRANSIENT_DURATION_MS);
    timer.unref?.();
    this.mcpServerStatusTimer = timer;
  }

  private replaceMcpServerStatusRow(
    component: ActivityLoader | StatusMessageComponent,
  ): void {
    const previous = this.mcpServerStatusRow;
    if (this.mcpServerStatusTimer !== undefined) {
      clearTimeout(this.mcpServerStatusTimer);
      this.mcpServerStatusTimer = undefined;
    }
    if (previous instanceof ActivityLoader) previous.stop();

    const children = this.host.state.mcpStatusContainer.children;
    const index = previous === undefined ? -1 : children.indexOf(previous);
    if (index >= 0) {
      children[index] = component;
    } else {
      this.host.state.mcpStatusContainer.addChild(component);
    }
    this.mcpServerStatusRow = component;
    this.host.state.ui.requestRender();
  }

  private removeMcpServerStatusRow(): void {
    if (this.mcpServerStatusTimer !== undefined) {
      clearTimeout(this.mcpServerStatusTimer);
      this.mcpServerStatusTimer = undefined;
    }
    const row = this.mcpServerStatusRow;
    if (row === undefined) return;
    if (row instanceof ActivityLoader) row.stop();
    this.host.state.mcpStatusContainer.removeChild(row);
    this.mcpServerStatusRow = undefined;
    this.host.state.ui.requestRender();
  }

  private syncMcpServerSummary(): void {
    const summary = formatMcpStartupStatusSummary([...this.mcpServers.values()]);
    this.host.setAppState({ mcpServersSummary: summary || null });
  }

  private handleSkillActivated(event: SkillActivatedEvent): void {
    if (this.renderedSkillActivationIds.has(event.activationId)) return;
    this.renderedSkillActivationIds.add(event.activationId);
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'skill_activation',
      checkpointId: event.checkpointId,
      turnId: undefined,
      renderMode: 'plain',
      content: `Activated skill: ${event.skillName}`,
      skillActivationId: event.activationId,
      skillName: event.skillName,
      skillArgs: event.skillArgs,
      skillTrigger: event.trigger,
    });
  }

  private handleCompactionBegin(event: CompactionStartedEvent): void {
    this.host.streamingUI.finalizeLiveTextBuffers('waiting');
    this.host.setAppState({
      isCompacting: true,
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
    this.host.streamingUI.beginCompaction(event.instruction);
  }

  private handleCompactionEnd(
    event: CompactionCompletedEvent,
    sendQueued: (item: QueuedMessage) => void,
  ): void {
    this.host.streamingUI.endCompaction(
      event.result.tokensBefore,
      event.result.tokensAfter,
      event.result.summary,
    );
    this.finishCompaction(sendQueued);
  }

  private handleCompactionCancel(
    _event: CompactionCancelledEvent,
    sendQueued: (item: QueuedMessage) => void,
  ): void {
    this.host.streamingUI.cancelCompaction();
    this.finishCompaction(sendQueued);
  }

  private finishCompaction(sendQueued: (item: QueuedMessage) => void): void {
    const hasActiveTurn = this.host.streamingUI.hasActiveTurn();
    if (!hasActiveTurn) {
      this.host.setAppState({
        isCompacting: false,
        streamingPhase: 'idle',
      });
      this.host.resetLivePane();
      const next = this.host.shiftQueuedMessage();
      if (next !== undefined) {
        setTimeout(() => {
          sendQueued(next);
        }, 0);
      }
    } else {
      this.host.setAppState({ isCompacting: false });
    }
  }

  // ---------------------------------------------------------------------------
  // Background task lifecycle
  // ---------------------------------------------------------------------------

  private handleBackgroundTaskEvent(
    event: BackgroundTaskStartedEvent | BackgroundTaskTerminatedEvent,
  ): void {
    const { state } = this.host;
    const { info } = event;
    const previous = this.backgroundTasks.get(info.taskId);
    this.backgroundTasks.set(info.taskId, info);

    const viewer = state.tasksBrowser?.viewer;
    if (viewer !== undefined && viewer.taskId === info.taskId) {
      void this.host.tasksBrowserController.refreshOutputViewer({ silent: true });
    }

    const isTerminal =
      info.status === 'completed' ||
      info.status === 'failed' ||
      info.status === 'timed_out' ||
      info.status === 'killed' ||
      info.status === 'lost';

    if (event.type === 'background.task.started') {
      if (info.kind === 'agent') {
        this.syncBackgroundTaskBadge();
        this.host.tasksBrowserController.repaint();
        return;
      }
      this.appendBackgroundTaskEntry(info);
      this.syncBackgroundTaskBadge();
      this.host.tasksBrowserController.repaint();
      return;
    }

    if (event.type === 'background.task.terminated' && isTerminal) {
      if (info.kind === 'agent') {
        // The Agent tool's spawn-success ToolResult is not an error, so the
        // parent toolCall card would otherwise render `✓ Completed` for any
        // terminated bg agent — including `lost` / `failed` / `killed`.
        // Push the actual terminal status so the card matches reality.
        this.host.streamingUI.applyBackgroundTaskTerminalStatus({
          agentId: info.agentId,
          description: info.description,
          status: info.status,
        });
      }
      if (!this.backgroundTaskTranscriptedTerminal.has(info.taskId)) {
        if (info.kind === 'process' || info.kind === 'question') {
          this.appendBackgroundTaskEntry(info);
        }
        this.backgroundTaskTranscriptedTerminal.add(info.taskId);
      }
      this.syncBackgroundTaskBadge();
      this.host.tasksBrowserController.repaint();
      return;
    }

    if (previous?.status !== info.status) {
      this.syncBackgroundTaskBadge();
    }
    this.host.tasksBrowserController.repaint();
  }

  private appendBackgroundTaskEntry(info: BackgroundTaskInfo): void {
    const status = formatBackgroundTaskTranscript(info);
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

  private syncBackgroundTaskBadge(): void {
    const { state } = this.host;
    let bashTasks = 0;
    let agentTasks = 0;
    for (const info of this.backgroundTasks.values()) {
      if (
        info.status === 'completed' ||
        info.status === 'failed' ||
        info.status === 'timed_out' ||
        info.status === 'killed' ||
        info.status === 'lost'
      ) {
        continue;
      }
      if (info.kind === 'agent') {
        agentTasks += 1;
      } else {
        bashTasks += 1;
      }
    }
    this.host.dispatchFooter({
      type: 'background-counts.updated',
      counts: { bashTasks, agentTasks },
    });
    state.ui.requestRender();
  }
}
