// apps/pythinker-web/src/composables/useDetailPanel.ts
// Unified right-side detail layer. Only one detail is open at a time.

import { computed, ref, watch, type Ref } from 'vue';
import type { AgentMember, ToolDiffTarget } from '../types';
import type { DetailTarget } from './useFilePreview';
import type { usePythinkerWebClient } from './usePythinkerWebClient';
import { buildEditDiffLines, extractEditPath, findToolCallById } from '../lib/toolDiff';
import { toolLabel } from '../lib/toolMeta';
import { transcriptSnapshotToTurns } from '../lib/transcriptToTurns';
import { toAgentMember } from './messagesToTurns';
import { clampPanelWidth, panelMaxWidth, useViewportWidth } from './useViewportWidth';

type PythinkerWebClient = ReturnType<typeof usePythinkerWebClient>;

const PREVIEW_WIDTH_KEY = 'pythinker-web.file-preview-width';
export const PREVIEW_MIN = 320;

export interface UseDetailPanelOptions {
  client: PythinkerWebClient;
  /** Mirrored sidebar width (px) so the preview max-width stays within the viewport. */
  sideWidth: Ref<number>;
  /** Shared owner of the single right-side slot (also written by useFilePreview). */
  detailTarget: Ref<DetailTarget | null>;
  /** Closes the file preview; injected to avoid a composable-to-composable import cycle. */
  closeFilePreview: () => void;
}

export function useDetailPanel({
  client,
  sideWidth,
  detailTarget,
  closeFilePreview,
}: UseDetailPanelOptions) {
  // ---------------------------------------------------------------------------
  // Panel width helpers
  // ---------------------------------------------------------------------------
  const { viewportWidth } = useViewportWidth();

  // Area available to the right of the sidebar (conversation + preview).
  const previewAreaWidth = computed(() =>
    Math.max(0, viewportWidth.value - sideWidth.value),
  );

  // Largest preview width that still leaves the conversation pane usable.
  const previewMax = computed(() =>
    panelMaxWidth(previewAreaWidth.value, PREVIEW_MIN, PREVIEW_MIN),
  );

  function clampPreviewWidth(width: number): number {
    return clampPanelWidth(Math.round(width), PREVIEW_MIN, previewMax.value);
  }

  function defaultPreviewWidth(): number {
    return clampPreviewWidth(previewAreaWidth.value / 2);
  }

  const previewDefaultWidth = computed(() => defaultPreviewWidth());
  const previewWidth = ref(previewDefaultWidth.value);
  // Rendered width, clamped to the current cap so a restored width or a window
  // shrink can never push the resize handle off-screen.
  const previewPanelWidth = computed(() =>
    clampPanelWidth(previewWidth.value, PREVIEW_MIN, previewMax.value),
  );

  // ---------------------------------------------------------------------------
  // Compaction summary panel
  // ---------------------------------------------------------------------------
  const compactionTarget = ref<{ turnId: string } | null>(null);

  const compactionPanelText = computed<string | null>(() => {
    const target = compactionTarget.value;
    if (!target) return null;
    const turn = client.turns.value.find((tn) => tn.id === target.turnId);
    return turn?.role === 'compaction' && turn.text ? turn.text : null;
  });

  const compactionPanelVisible = computed(() => compactionPanelText.value !== null);

  function openCompactionPanel(target: { turnId: string }): void {
    detailTarget.value = 'compaction';
    compactionTarget.value = target;
  }

  function closeCompactionPanel(): void {
    compactionTarget.value = null;
    if (detailTarget.value === 'compaction') detailTarget.value = null;
  }

  // ---------------------------------------------------------------------------
  // Subagent detail panel
  // ---------------------------------------------------------------------------
  const agentTarget = ref<{ sessionId: string; subagentId: string } | null>(null);

  const agentTranscriptEntry = computed(() => {
    const target = agentTarget.value;
    if (!target) return { entry: undefined, version: 0 };
    const entry = client.auxiliaryTranscripts.getEntry(target.sessionId, target.subagentId);
    return { entry, version: entry?.version.value ?? 0 };
  });

  function resolveAgentId(target: string): string {
    const task = client.activeAppTasks.value.find(
      (candidate) =>
        candidate.agentId === target ||
        candidate.id === target ||
        candidate.backgroundTaskId === target ||
        candidate.parentToolCallId === target,
    );
    return task?.agentId ?? task?.id ?? target;
  }

  const agentPanelMember = computed<AgentMember | null>(() => {
    const target = agentTarget.value;
    if (!target) return null;
    const task = client.activeAppTasks.value.find(
      (candidate) =>
        candidate.agentId === target.subagentId ||
        candidate.id === target.subagentId ||
        candidate.backgroundTaskId === target.subagentId,
    );
    if (task) return toAgentMember(task);

    const channel = agentTranscriptEntry.value.entry?.channel;
    if (!channel) return null;
    const descriptor = channel.agents.find((agent) => agent.agentId === target.subagentId);
    const latestTurn = channel.snapshot.items.findLast((item) => item.kind === 'turn');
    const active = channel.snapshot.meta.activity === 'turn';
    const loading = channel.loading;
    const failed = latestTurn?.kind === 'turn' && latestTurn.state === 'failed';
    const cancelled = latestTurn?.kind === 'turn' && latestTurn.state === 'cancelled';
    const unavailable = channel.refreshError && latestTurn === undefined;
    return {
      id: target.subagentId,
      name: descriptor?.label ?? target.subagentId,
      subagentType: descriptor?.type === 'sub' ? 'subagent' : descriptor?.type,
      phase: active
        ? 'working'
        : cancelled
          ? 'cancelled'
          : failed || unavailable
            ? 'failed'
            : loading
              ? 'queued'
              : 'completed',
      status: active || loading
        ? 'running'
        : cancelled
          ? 'cancelled'
          : failed || unavailable
            ? 'failed'
            : 'completed',
    };
  });

  const agentPanelTurns = computed(() => {
    const target = agentTarget.value;
    const channel = agentTranscriptEntry.value.entry?.channel;
    if (!target || !channel) return [];
    const descriptor = channel.agents.find((agent) => agent.agentId === target.subagentId);
    return transcriptSnapshotToTurns(channel.snapshot, descriptor, {
      sessionId: target.sessionId,
      getFileUrl: (fileId) => client.getFileUrl(fileId),
    });
  });

  const agentPanelLoading = computed(
    () => agentTranscriptEntry.value.entry?.channel.loading ?? false,
  );
  const agentPanelLoadError = computed(
    () => agentTranscriptEntry.value.entry?.channel.refreshError ?? false,
  );
  const agentPanelLoadingMore = computed(
    () => agentTranscriptEntry.value.entry?.channel.loadingOlder ?? false,
  );
  const agentPanelLoadMoreError = computed(
    () => agentTranscriptEntry.value.entry?.channel.loadOlderError ?? false,
  );
  const agentPanelHasMore = computed(
    () => agentTranscriptEntry.value.entry?.channel.snapshot.hasMoreOlder ?? false,
  );
  const agentPanelRunning = computed(
    () => agentTranscriptEntry.value.entry?.channel.snapshot.meta.activity === 'turn',
  );
  const agentPanelVisible = computed(() => agentPanelMember.value !== null);

  function openAgentPanel(target: string): void {
    const sessionId = client.activeSessionId.value;
    if (!target || !sessionId) return;
    const subagentId = resolveAgentId(target);
    const previous = agentTarget.value;
    if (previous && previous.subagentId !== subagentId) {
      client.auxiliaryTranscripts.deactivate(previous.sessionId, previous.subagentId);
    }
    agentTarget.value = { sessionId, subagentId };
    detailTarget.value = 'agent';
    client.auxiliaryTranscripts.activate(sessionId, subagentId);
  }

  function closeAgentPanel(): void {
    const target = agentTarget.value;
    if (target) {
      client.auxiliaryTranscripts.deactivate(target.sessionId, target.subagentId);
    }
    agentTarget.value = null;
    if (detailTarget.value === 'agent') detailTarget.value = null;
  }

  watch(detailTarget, (target, previous) => {
    if (previous !== 'agent' || target === 'agent') return;
    const agent = agentTarget.value;
    if (agent) client.auxiliaryTranscripts.deactivate(agent.sessionId, agent.subagentId);
  });

  function loadOlderAgentMessages(): void {
    void agentTranscriptEntry.value.entry?.channel.loadOlder().catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Edit/Write tool-call diff preview
  // ---------------------------------------------------------------------------
  // Store only the tool id and re-derive the panel payload from the live tool
  // call in the session turns, so a panel opened while the tool is still
  // running keeps tracking its status / output / diff as they update.
  const toolDiffToolId = ref<string | null>(null);

  const toolDiffTarget = computed<ToolDiffTarget | null>(() => {
    const id = toolDiffToolId.value;
    if (!id) return null;
    const tool = findToolCallById(client.turns.value, id);
    if (!tool) return null;
    return {
      id,
      title: toolLabel(tool.name),
      path: extractEditPath(tool.arg),
      // On error the diff describes what was attempted, not what happened —
      // show the tool output (the failure reason) instead.
      lines: tool.status === 'error' ? null : buildEditDiffLines(tool),
      output: tool.output,
    };
  });

  const toolDiffVisible = computed(() => toolDiffTarget.value !== null);

  function openToolDiff(id: string): void {
    detailTarget.value = 'toolDiff';
    toolDiffToolId.value = id;
  }

  function closeToolDiff(): void {
    toolDiffToolId.value = null;
    if (detailTarget.value === 'toolDiff') detailTarget.value = null;
  }

  // ---------------------------------------------------------------------------
  // Diff detail layer (opened from the chat header git area)
  // ---------------------------------------------------------------------------
  const detailDiffMode = ref<'list' | 'detail'>('list');
  const detailDiffPath = ref<string | null>(null);

  function openDiffDetail(): void {
    detailTarget.value = 'diff';
    detailDiffMode.value = 'list';
    detailDiffPath.value = null;
    void client.loadGitStatus(client.activeSessionId.value!);
  }

  function closeDiffDetail(): void {
    if (detailTarget.value === 'diff') detailTarget.value = null;
    detailDiffMode.value = 'list';
    detailDiffPath.value = null;
    client.clearFileDiff();
  }

  async function selectDiffFile(path: string): Promise<void> {
    detailDiffMode.value = 'detail';
    detailDiffPath.value = path;
    await client.loadFileDiff(path);
  }

  // ---------------------------------------------------------------------------
  // Side chat (BTW) — now rendered in the unified right-side detail layer.
  // ---------------------------------------------------------------------------
  async function openSideChatTab(prompt?: string): Promise<void> {
    // Empty-composer heal: `/btw [<question>]` from the new-session screen needs
    // a parent session before openSideChat can start a BTW sub-agent. Create one
    // in the active workspace (same path as the first prompt / a new-session
    // skill / goal), then open the side chat on it.
    if (!client.activeSessionId.value && client.activeWorkspaceId.value) {
      await client.startSessionAndOpenSideChat(client.activeWorkspaceId.value, prompt);
    } else {
      await client.openSideChat(prompt);
    }
    detailTarget.value = 'btw';
  }

  function closeSideChat(): void {
    client.closeSideChat();
    if (detailTarget.value === 'btw') detailTarget.value = null;
  }

  // Only hides the right-side BTW panel; the side-chat target is per-session and
  // preserved so switching back to a session restores its BTW transcript.
  function hideSideChatPanel(): void {
    if (detailTarget.value === 'btw') detailTarget.value = null;
  }

  const btwVisible = computed(() => client.sideChatVisible.value);

  /** Any occupant of the shared right-side slot. */
  const sidePanelVisible = computed(
    () =>
      detailTarget.value !== null &&
      (detailTarget.value !== 'compaction' || compactionPanelVisible.value) &&
      (detailTarget.value !== 'agent' || agentPanelVisible.value) &&
      (detailTarget.value !== 'toolDiff' || toolDiffVisible.value) &&
      (detailTarget.value !== 'btw' || btwVisible.value),
  );

  /** True while the panel's resize handle is being dragged — the width
      transition is disabled so the panel follows the pointer 1:1. */
  const panelDragging = ref(false);

  // Escape closes whichever transient right-side detail panel is open.
  function closeOpenSidePanel(): boolean {
    if (detailTarget.value === 'compaction' && compactionPanelVisible.value) { closeCompactionPanel(); return true; }
    if (detailTarget.value === 'agent' && agentPanelVisible.value) { closeAgentPanel(); return true; }
    if (detailTarget.value === 'toolDiff' && toolDiffVisible.value) { closeToolDiff(); return true; }
    if (detailTarget.value === 'file') { closeFilePreview(); return true; }
    if (detailTarget.value === 'diff') { closeDiffDetail(); return true; }
    if (detailTarget.value === 'btw') { closeSideChat(); return true; }
    return false;
  }

  watch(client.activeSessionId, () => {
    closeFilePreview();
    closeCompactionPanel();
    closeAgentPanel();
    closeToolDiff();
    closeDiffDetail();
    hideSideChatPanel();
  });

  return {
    PREVIEW_WIDTH_KEY,
    PREVIEW_MIN,
    previewDefaultWidth,
    previewMax,
    previewWidth,
    previewPanelWidth,
    compactionPanelText,
    compactionPanelVisible,
    openCompactionPanel,
    closeCompactionPanel,
    agentPanelMember,
    agentPanelTurns,
    agentPanelLoading,
    agentPanelLoadError,
    agentPanelLoadingMore,
    agentPanelLoadMoreError,
    agentPanelHasMore,
    agentPanelRunning,
    agentPanelVisible,
    openAgentPanel,
    closeAgentPanel,
    loadOlderAgentMessages,
    toolDiffTarget,
    toolDiffVisible,
    openToolDiff,
    closeToolDiff,
    detailDiffMode,
    detailDiffPath,
    openDiffDetail,
    closeDiffDetail,
    selectDiffFile,
    btwVisible,
    openSideChatTab,
    closeSideChat,
    hideSideChatPanel,
    sidePanelVisible,
    panelDragging,
    closeOpenSidePanel,
  };
}
