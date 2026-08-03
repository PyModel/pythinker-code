import type { Component } from '@earendil-works/pi-tui';
import type {
  ContextMessage,
  FileCheckpointSummary,
  PartialCompactionDirection,
  RestoreFileCheckpointResult,
  SessionFileCheckpointPreview,
} from '@pythoughts/pythinker-code-sdk';
import { isPythinkerError } from '@pythoughts/pythinker-code-sdk';

import { WelcomeComponent } from '../components/chrome/welcome';
import { ChoicePickerComponent, type ChoiceOption } from '../components/dialogs/choice-picker';
import { CompactionComponent } from '../components/dialogs/compaction';
import {
  UndoSelectorComponent,
  type UndoChoice,
} from '../components/dialogs/undo-selector';
import { AgentGroupComponent } from '../components/messages/agent-group';
import { DynamicWorkflowMissionControlComponent } from '../components/messages/dynamic-workflow-mission-control';
import { AssistantMessageComponent } from '../components/messages/assistant-message';
import { BackgroundAgentStatusComponent } from '../components/messages/background-agent-status';
import { CronMessageComponent } from '../components/messages/cron-message';
import { ReadGroupComponent } from '../components/messages/read-group';
import { SkillActivationComponent } from '../components/messages/skill-activation';
import { ThinkingComponent } from '../components/messages/thinking';
import { ToolCallComponent } from '../components/messages/tool-call';
import { UserMessageComponent } from '../components/messages/user-message';
import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/pythinker-tui';
import type { TranscriptEntry } from '../types';
import { formatErrorMessage } from '../utils/event-payload';
import { getTranscriptComponentEntry } from '../utils/transcript-component-metadata';
import { nextTranscriptId } from '../utils/transcript-id';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Undo command
// ---------------------------------------------------------------------------

interface UndoAvailability {
  readonly maxCount: number;
  readonly stoppedAtCompaction: boolean;
}

type UndoSessionContext = Awaited<
  ReturnType<NonNullable<SlashCommandHost['session']>['getContext']>
>;

const UNDO_LIMIT_STATUS_TURN_ID = 'undo-limit-status';

export async function handleUndoCommand(
  host: SlashCommandHost,
  args: string = '',
): Promise<void> {
  if (host.state.appState.streamingPhase !== 'idle') {
    host.showError('Cannot undo while streaming — press Esc or Ctrl-C first.');
    return;
  }

  const trimmed = args.trim();
  if (trimmed.length === 0) {
    await showUndoSelector(host);
    return;
  }

  const count = parseUndoCount(trimmed);
  if (count === undefined) {
    host.showError('Usage: /undo [count], where count is a positive integer.');
    return;
  }

  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const availability = await resolveUndoAvailability(host);
  if (count > availability.maxCount) {
    showUndoLimitStatus(host, formatUndoLimitMessage(count, availability));
    return;
  }

  await undoByCount(host, count);
}

async function undoByCount(
  host: SlashCommandHost,
  count: number,
  reportFailure: boolean = true,
): Promise<boolean> {
  const session = host.session;
  if (session === undefined) {
    if (reportFailure) host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return false;
  }

  const entries = host.state.transcriptEntries;
  const lastUserIndex = findUndoAnchorEntryIndex(entries, count);
  if (lastUserIndex === undefined) {
    if (reportFailure) showUndoLimitStatus(host, 'Nothing to undo.');
    return false;
  }

  try {
    await session.undoHistory(count);
  } catch (error) {
    const limit = undoLimitFromError(error);
    if (limit !== undefined) {
      if (reportFailure) {
        showUndoLimitStatus(host, formatUndoLimitMessage(limit.requestedCount, limit));
      }
      return false;
    }
    if (reportFailure) {
      host.showError(`Failed to undo: ${formatErrorMessage(error)}`);
    }
    return false;
  }

  // The undone turn's mission control must not survive, or late events for
  // it would resurrect streaming UI for removed work.
  host.clearDynamicWorkflowMissionControls();

  const children = host.state.transcriptContainer.children;
  const lastUserComponentIndex = findUndoAnchorComponentIndex(children, count);
  if (lastUserComponentIndex !== undefined) {
    removeUndoContextComponents(children, lastUserComponentIndex);
  }

  const preservedEntries = entries.slice(lastUserIndex).filter(
    (entry) => !isUndoContextEntry(entry),
  );
  entries.splice(lastUserIndex, entries.length - lastUserIndex, ...preservedEntries);

  if (entries.length === 0) {
    renderWelcome(host);
  }

  host.state.ui.requestRender();
  return true;
}

async function showUndoSelector(host: SlashCommandHost): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  let checkpoints: readonly FileCheckpointSummary[];
  try {
    checkpoints = await session.listFileCheckpoints();
  } catch (error) {
    host.showError(`Failed to load checkpoints: ${formatErrorMessage(error)}`);
    return;
  }

  const availability = await resolveUndoAvailability(host);
  const choices = createUndoChoices(
    checkpoints,
    host.state.transcriptEntries,
    host.state.transcriptContainer.children,
    availability.maxCount,
  );
  if (choices.length === 0) {
    showUndoLimitStatus(host, formatNothingToUndoMessage(availability));
    return;
  }

  host.mountEditorReplacement(
    new UndoSelectorComponent({
      choices,
      onSelect: (choice) => {
        void previewUndoChoice(host, choice);
      },
      onSummarize: (choice, direction) => {
        void compactAtChoice(host, choice, direction);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function previewUndoChoice(
  host: SlashCommandHost,
  choice: UndoChoice,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.restoreEditor();
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  let preview: SessionFileCheckpointPreview;
  try {
    preview = await session.previewFileCheckpoint(choice.id);
  } catch (error) {
    host.restoreEditor();
    host.showError(`Failed to preview checkpoint: ${formatErrorMessage(error)}`);
    return;
  }

  if (!preview.complete) {
    host.restoreEditor();
    host.showError('Cannot restore code because this checkpoint is incomplete.');
    return;
  }

  const canUndoConversation =
    choice.count !== undefined && preview.conversationAvailable;
  if (preview.paths.length === 0) {
    if (!canUndoConversation) {
      host.restoreEditor();
      host.showError('This checkpoint has no tracked file changes to restore.');
      return;
    }
    const undone = await undoByCount(host, choice.count);
    if (undone) {
      host.restoreInputText(choice.input);
    } else {
      host.restoreEditor();
    }
    return;
  }

  showRestoreActions(host, choice, preview, canUndoConversation);
}

type RestoreAction = 'both' | 'conversation' | 'code';

function showRestoreActions(
  host: SlashCommandHost,
  choice: UndoChoice,
  preview: SessionFileCheckpointPreview,
  canUndoConversation: boolean,
): void {
  const options: ChoiceOption[] = canUndoConversation
    ? [
        { value: 'both', label: 'Restore code and conversation' },
        { value: 'conversation', label: 'Restore conversation only' },
        { value: 'code', label: 'Restore code only' },
        { value: 'cancel', label: 'Cancel' },
      ]
    : [
        { value: 'code', label: 'Restore code only' },
        { value: 'cancel', label: 'Cancel' },
      ];
  const fileLabel = `${String(preview.paths.length)} ${
    preview.paths.length === 1 ? 'file' : 'files'
  }`;
  const notice =
    `${fileLabel} · ${String(preview.insertions)} insertions · ` +
    `${String(preview.deletions)} deletions. ` +
    'Shell commands and manual edits are not tracked.';

  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Restore checkpoint',
      notice,
      noticeTone: 'warning',
      options,
      onSelect: (value) => {
        if (value === 'cancel') {
          host.restoreEditor();
          return;
        }
        if (value !== 'both' && value !== 'conversation' && value !== 'code') return;
        void performRestoreAction(host, choice, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function performRestoreAction(
  host: SlashCommandHost,
  choice: UndoChoice,
  action: RestoreAction,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.restoreEditor();
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  const conversationCount = choice.count;
  if (
    (action === 'both' || action === 'conversation') &&
    conversationCount === undefined
  ) {
    host.restoreEditor();
    host.showError('Conversation undo is unavailable for this checkpoint.');
    return;
  }

  host.restoreEditor();
  let restore: RestoreFileCheckpointResult | undefined;
  if (action === 'both' || action === 'code') {
    try {
      restore = await session.restoreFileCheckpoint(choice.id);
    } catch (error) {
      host.showError(`Failed to restore code: ${formatErrorMessage(error)}`);
      return;
    }
  }

  if (action === 'both' || action === 'conversation') {
    if (conversationCount === undefined) return;
    const undone = await undoByCount(host, conversationCount, action === 'conversation');
    if (!undone) {
      if (restore !== undefined) {
        host.showError(
          'Files were restored, but conversation undo failed. ' +
            `Recovery checkpoint: ${restore.recoveryCheckpointId}.`,
        );
      }
      return;
    }
    host.restoreInputText(choice.input);
  }

  if (restore !== undefined) {
    showRestoreSuccess(host, restore);
  }
}

function showRestoreSuccess(
  host: SlashCommandHost,
  restore: RestoreFileCheckpointResult,
): void {
  host.showNotice(
    'Files restored',
    `Restored: ${String(restore.restoredPaths.length)}. ` +
      `Deleted: ${String(restore.deletedPaths.length)}. ` +
      `Recovery checkpoint: ${restore.recoveryCheckpointId}.`,
  );
}

async function compactAtChoice(
  host: SlashCommandHost,
  choice: UndoChoice,
  direction: PartialCompactionDirection,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.restoreEditor();
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (choice.count === undefined) return;
  try {
    await session.compact({
      promptFromEnd: choice.count,
      direction,
    });
  } catch (error) {
    host.restoreEditor();
    host.showError(`Failed to summarize: ${formatErrorMessage(error)}`);
    return;
  }
  if (direction === 'from') {
    host.restoreInputText(choice.input);
  } else {
    host.restoreEditor();
  }
}

function parseUndoCount(args: string): number | undefined {
  const value = args.trim();
  if (value.length === 0) return 1;
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : undefined;
}

async function resolveUndoAvailability(
  host: SlashCommandHost,
): Promise<UndoAvailability> {
  const local = undoAvailabilityFromTranscript(
    host.state.transcriptEntries,
    host.state.transcriptContainer.children,
  );
  const context = await getSessionContext(host.session);
  if (context === undefined) return local;

  const activeContext = undoAvailabilityFromContext(context.history);
  return {
    maxCount: Math.min(local.maxCount, activeContext.maxCount),
    stoppedAtCompaction:
      local.stoppedAtCompaction || activeContext.stoppedAtCompaction,
  };
}

async function getSessionContext(
  session: SlashCommandHost['session'],
): Promise<UndoSessionContext | undefined> {
  const getContext = (
    session as { getContext?: () => Promise<UndoSessionContext> } | undefined
  )?.getContext;
  if (session === undefined || getContext === undefined) return undefined;
  try {
    return await getContext.call(session);
  } catch {
    return undefined;
  }
}

function undoAvailabilityFromTranscript(
  entries: readonly TranscriptEntry[],
  children: readonly Component[],
): UndoAvailability {
  const { anchors, stoppedAtCompaction } = activeUndoAnchorEntries(entries, children);
  return {
    maxCount: anchors.length,
    stoppedAtCompaction,
  };
}

function undoAvailabilityFromContext(
  history: readonly ContextMessage[],
): UndoAvailability {
  let maxCount = 0;
  let stoppedAtCompaction = false;

  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message === undefined) continue;
    if (message.origin?.kind === 'injection') continue;
    if (message.origin?.kind === 'compaction_summary') {
      stoppedAtCompaction = true;
      break;
    }
    if (isContextUndoAnchor(message)) maxCount++;
  }

  return { maxCount, stoppedAtCompaction };
}

function isContextUndoAnchor(message: ContextMessage): boolean {
  if (message.role !== 'user') return false;
  const origin = message.origin;
  if (origin === undefined || origin.kind === 'user') return true;
  if (origin.kind === 'skill_activation') {
    return origin.trigger === 'user-slash';
  }
  return false;
}

function createUndoChoices(
  checkpoints: readonly FileCheckpointSummary[],
  entries: readonly TranscriptEntry[],
  children: readonly Component[],
  maxCount: number,
): readonly UndoChoice[] {
  const activeAnchors = activeUndoAnchorEntries(entries, children).anchors;
  const anchors = maxCount > 0 ? activeAnchors.slice(-maxCount) : [];
  const counts = matchCheckpointCounts(checkpoints, anchors);
  return checkpoints.map((checkpoint) => {
    const input = checkpoint.prompt ?? '';
    const title =
      singleLine(input) ||
      (checkpoint.kind === 'recovery' ? 'Recovery checkpoint' : 'User prompt');
    const time = formatCheckpointTime(checkpoint.createdAt);
    return {
      id: checkpoint.id,
      count: counts.get(checkpoint.id),
      input,
      label: time.length > 0 ? `${title} · ${time}` : title,
    };
  });
}

function matchCheckpointCounts(
  checkpoints: readonly FileCheckpointSummary[],
  anchors: readonly TranscriptEntry[],
): ReadonlyMap<string, number> {
  const userCheckpoints = checkpoints.filter((checkpoint) => checkpoint.kind === 'user');
  const counts = new Map<string, number>();
  let checkpointIndex = userCheckpoints.length - 1;

  for (let anchorIndex = anchors.length - 1; anchorIndex >= 0; anchorIndex--) {
    const anchor = anchors[anchorIndex];
    if (anchor === undefined) continue;
    let matchIndex = checkpointIndex;
    if (anchor.checkpointId !== undefined) {
      matchIndex = -1;
      for (let index = checkpointIndex; index >= 0; index--) {
        if (userCheckpoints[index]?.id === anchor.checkpointId) {
          matchIndex = index;
          break;
        }
      }
      if (matchIndex < 0) continue;
    }

    const checkpoint = userCheckpoints[matchIndex];
    if (checkpoint === undefined) break;
    counts.set(checkpoint.id, anchors.length - anchorIndex);
    checkpointIndex = matchIndex - 1;
  }
  return counts;
}

function formatCheckpointTime(createdAt: string): string {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.floor(Math.max(0, Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
}

function activeUndoAnchorEntries(
  entries: readonly TranscriptEntry[],
  children: readonly Component[],
): { readonly anchors: readonly TranscriptEntry[]; readonly stoppedAtCompaction: boolean } {
  const lastCompactionChildIndex = children.findLastIndex(
    (child) => child instanceof CompactionComponent,
  );
  if (lastCompactionChildIndex >= 0) {
    return {
      anchors: children
        .slice(lastCompactionChildIndex + 1)
        .map((child) => getTranscriptComponentEntry(child))
        .filter((entry): entry is TranscriptEntry => entry !== undefined)
        .filter(isUndoAnchorEntry),
      stoppedAtCompaction: true,
    };
  }

  const lastCompactionEntryIndex = entries.findLastIndex(
    (entry) => entry.compactionData !== undefined,
  );
  const activeEntries =
    lastCompactionEntryIndex >= 0 ? entries.slice(lastCompactionEntryIndex + 1) : entries;
  return {
    anchors: activeEntries.filter(isUndoAnchorEntry),
    stoppedAtCompaction: lastCompactionEntryIndex >= 0,
  };
}

function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function formatUndoLimitMessage(
  requestedCount: number,
  availability: UndoAvailability,
): string {
  const reason = availability.stoppedAtCompaction ? ' after the last compaction' : '';
  const requested = formatPromptCount(requestedCount);
  const max = formatPromptCount(availability.maxCount);
  return `Cannot undo ${requested}; only ${max} can be undone in the active context${reason}.`;
}

function formatNothingToUndoMessage(availability: UndoAvailability): string {
  if (availability.stoppedAtCompaction) {
    return 'Nothing to undo after the last compaction.';
  }
  return 'Nothing to undo.';
}

function formatPromptCount(count: number): string {
  return `${String(count)} ${count === 1 ? 'prompt' : 'prompts'}`;
}

function showUndoLimitStatus(host: SlashCommandHost, message: string): void {
  host.appendTranscriptEntry({
    id: nextTranscriptId(),
    kind: 'status',
    turnId: UNDO_LIMIT_STATUS_TURN_ID,
    renderMode: 'plain',
    content: message,
  });
}

function undoLimitFromError(
  error: unknown,
): (UndoAvailability & { readonly requestedCount: number }) | undefined {
  if (!isPythinkerError(error)) return undefined;
  const details = error.details;
  if (details?.['reason'] !== 'undo_limit') return undefined;
  const requestedCount = details['requestedCount'];
  const maxCount = details['undoableCount'];
  const stoppedAtCompaction = details['stoppedAtCompaction'];
  if (
    typeof requestedCount !== 'number' ||
    typeof maxCount !== 'number' ||
    typeof stoppedAtCompaction !== 'boolean'
  ) {
    return undefined;
  }
  return { requestedCount, maxCount, stoppedAtCompaction };
}

function isUndoAnchorEntry(entry: TranscriptEntry): boolean {
  return (
    entry.kind === 'user' ||
    (entry.kind === 'skill_activation' && entry.skillTrigger === 'user-slash')
  );
}

function findUndoAnchorEntryIndex(
  entries: readonly TranscriptEntry[],
  count: number,
): number | undefined {
  let found = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry !== undefined && isUndoAnchorEntry(entry)) {
      found++;
      if (found === count) return i;
    }
  }
  return undefined;
}

function isUndoContextEntry(entry: TranscriptEntry): boolean {
  switch (entry.kind) {
    case 'user':
    case 'assistant':
    case 'tool_call':
    case 'thinking':
    case 'skill_activation':
    case 'cron':
      return true;
    case 'status':
    case 'goal':
      return entry.turnId !== undefined;
    case 'welcome':
      return false;
  }
}

function findUndoAnchorComponentIndex(
  children: readonly Component[],
  count: number,
): number | undefined {
  let found = 0;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child !== undefined && isUndoAnchorComponent(child)) {
      found++;
      if (found === count) return i;
    }
  }
  return undefined;
}

function removeUndoContextComponents(
  children: Component[],
  startIndex: number,
): void {
  for (let i = children.length - 1; i >= startIndex; i--) {
    const child = children[i];
    if (child !== undefined && isUndoContextComponent(child)) {
      children.splice(i, 1);
    }
  }
}

function isUndoAnchorComponent(child: Component): boolean {
  return (
    child instanceof UserMessageComponent ||
    (child instanceof SkillActivationComponent && child.trigger === 'user-slash')
  );
}

function isUndoContextComponent(child: Component): boolean {
  const entry = getTranscriptComponentEntry(child);
  if (entry !== undefined) {
    return isUndoContextEntry(entry);
  }

  return (
    child instanceof UserMessageComponent ||
    child instanceof AssistantMessageComponent ||
    child instanceof ThinkingComponent ||
    child instanceof ToolCallComponent ||
    child instanceof AgentGroupComponent ||
    child instanceof DynamicWorkflowMissionControlComponent ||
    child instanceof ReadGroupComponent ||
    child instanceof SkillActivationComponent ||
    child instanceof BackgroundAgentStatusComponent ||
    child instanceof CronMessageComponent
  );
}

function renderWelcome(host: SlashCommandHost): void {
  if (
    host.state.transcriptContainer.children.some(
      (child) => child instanceof WelcomeComponent,
    )
  ) {
    return;
  }
  host.state.transcriptContainer.addChild(
    new WelcomeComponent(host.state.appState, () => {
      host.state.ui.requestRender();
    }),
  );
}
