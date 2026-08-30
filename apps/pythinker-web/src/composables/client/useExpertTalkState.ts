import { computed, ref, watch, type ComputedRef } from 'vue';

import { getPythinkerWebApi } from '../../api';
import type { AppExpertTalkRun, AppExpertTalkStatus } from '../../api/types';

export function useExpertTalkState(
  activeSessionId: ComputedRef<string>,
  capability: ComputedRef<boolean>,
  reportFailure: (operation: string, error: unknown, opts?: { sessionId?: string }) => void,
) {
  const statusBySession = ref<Record<string, AppExpertTalkStatus>>({});
  const runsById = ref<Record<string, AppExpertTalkRun>>({});
  const busy = ref(false);
  const error = ref<string>();

  const status = computed(() => statusBySession.value[activeSessionId.value]);
  const run = computed(() => {
    const current = status.value;
    const runId = current?.activeRunId ?? current?.latestRunId;
    return runId === undefined ? undefined : runsById.value[runId];
  });
  const runs = computed(() => Object.values(runsById.value)
    .filter((candidate) => candidate.sessionId === activeSessionId.value)
    .toSorted((a, b) => a.turnId - b.turnId || a.createdAt.localeCompare(b.createdAt)));
  const available = computed(
    () => capability.value && status.value?.feature === 'enabled',
  );

  function setStatus(sessionId: string, next: AppExpertTalkStatus): void {
    statusBySession.value = { ...statusBySession.value, [sessionId]: next };
    const runId = next.activeRunId ?? next.latestRunId;
    if (runId !== undefined) void refreshRun(sessionId, runId);
  }

  function setRun(next: AppExpertTalkRun): void {
    const prior = runsById.value[next.runId];
    if (prior !== undefined && prior.revision > next.revision) return;
    if (
      prior !== undefined &&
      prior.revision === next.revision &&
      (prior.progressRevision ?? 0) > (next.progressRevision ?? 0)
    ) return;
    runsById.value = { ...runsById.value, [next.runId]: next };
  }

  async function refreshRun(sessionId: string, runId: string): Promise<void> {
    try {
      setRun(await getPythinkerWebApi().getExpertTalkRun(sessionId, runId));
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      reportFailure('expertTalkRefreshRun', cause, { sessionId });
    }
  }

  async function refresh(sessionId = activeSessionId.value): Promise<void> {
    if (!capability.value || sessionId.length === 0) return;
    try {
      const [nextStatus, nextRuns] = await Promise.all([
        getPythinkerWebApi().getExpertTalkStatus(sessionId),
        getPythinkerWebApi().listExpertTalkRuns(sessionId),
      ]);
      setStatus(sessionId, nextStatus);
      for (const nextRun of nextRuns) setRun(nextRun);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  }

  async function operate(
    operation: string,
    action: (sessionId: string) => Promise<void>,
  ): Promise<void> {
    const sessionId = activeSessionId.value;
    if (sessionId.length === 0 || busy.value) return;
    busy.value = true;
    error.value = undefined;
    try {
      await action(sessionId);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
      reportFailure(operation, cause, { sessionId });
    } finally {
      busy.value = false;
    }
  }

  async function configure(
    sessionId: string,
    fusionLeadModelId: string,
    peerModelId: string,
  ): Promise<AppExpertTalkStatus> {
    if (fusionLeadModelId === peerModelId) throw new Error('Select two different models');
    let current = statusBySession.value[sessionId]
      ?? await getPythinkerWebApi().getExpertTalkStatus(sessionId);
    if (
      current.config?.fusionLeadModelId !== fusionLeadModelId ||
      current.config.peerModelId !== peerModelId
    ) {
      current = await getPythinkerWebApi().configureExpertTalk(
        sessionId,
        { fusionLeadModelId, peerModelId },
        current.resourceVersion,
      );
    }
    setStatus(sessionId, current);
    return current;
  }

  async function configurePair(fusionLeadModelId: string, peerModelId: string): Promise<void> {
    await operate('expertTalkConfigure', async (sessionId) => {
      await configure(sessionId, fusionLeadModelId, peerModelId);
    });
  }

  async function useForNextMessage(fusionLeadModelId: string, peerModelId: string): Promise<void> {
    await operate('expertTalkArm', async (sessionId) => {
      const configured = await configure(sessionId, fusionLeadModelId, peerModelId);
      setStatus(sessionId, await getPythinkerWebApi().armExpertTalk(
        sessionId,
        configured.resourceVersion,
      ));
    });
  }

  async function disarm(): Promise<void> {
    await operate('expertTalkDisarm', async (sessionId) => {
      const armId = statusBySession.value[sessionId]?.activation.armId;
      setStatus(sessionId, await getPythinkerWebApi().disarmExpertTalk(sessionId, armId));
    });
  }

  async function clear(): Promise<void> {
    await operate('expertTalkClear', async (sessionId) => {
      const current = statusBySession.value[sessionId];
      setStatus(sessionId, await getPythinkerWebApi().clearExpertTalk(
        sessionId,
        current?.resourceVersion,
      ));
    });
  }

  async function cancel(): Promise<void> {
    await operate('expertTalkCancel', async (sessionId) => {
      const runId = statusBySession.value[sessionId]?.activeRunId;
      if (runId === undefined) return;
      setRun(await getPythinkerWebApi().cancelExpertTalkRun(sessionId, runId));
      await refresh(sessionId);
    });
  }

  async function retry(): Promise<void> {
    await operate('expertTalkRetry', async (sessionId) => {
      const runId = statusBySession.value[sessionId]?.latestRunId;
      if (runId === undefined) return;
      setRun(await getPythinkerWebApi().retryExpertTalkRun(sessionId, runId));
      await refresh(sessionId);
    });
  }

  async function review(): Promise<void> {
    await operate('expertTalkReview', async (sessionId) => {
      const runId = statusBySession.value[sessionId]?.activeRunId;
      if (runId === undefined) return;
      setRun(await getPythinkerWebApi().reviewExpertTalkRun(sessionId, runId));
      await refresh(sessionId);
    });
  }

  async function finish(): Promise<void> {
    await operate('expertTalkFinish', async (sessionId) => {
      const runId = statusBySession.value[sessionId]?.activeRunId;
      if (runId === undefined) return;
      setRun(await getPythinkerWebApi().finishExpertTalkRun(sessionId, runId));
      await refresh(sessionId);
    });
  }

  async function fuse(): Promise<void> {
    await operate('expertTalkFusion', async (sessionId) => {
      const runId = statusBySession.value[sessionId]?.activeRunId;
      if (runId === undefined) return;
      setRun(await getPythinkerWebApi().fuseExpertTalkRun(sessionId, runId));
      await refresh(sessionId);
    });
  }

  function applyStatus(sessionId: string, next: AppExpertTalkStatus): void {
    setStatus(sessionId, next);
  }

  function armIdForSession(sessionId: string): string | undefined {
    const current = statusBySession.value[sessionId];
    return current?.activation.state === 'armed' ? current.activation.armId : undefined;
  }

  function promptAccepted(sessionId: string, runId: string): void {
    const current = statusBySession.value[sessionId];
    if (current !== undefined) {
      setStatus(sessionId, {
        ...current,
        activation: { state: 'idle' },
        activeRunId: runId,
        latestRunId: runId,
      });
    }
    void refresh(sessionId);
  }

  watch(
    [activeSessionId, capability],
    ([sessionId, supported]) => {
      if (supported && sessionId.length > 0) void refresh(sessionId);
    },
    { immediate: true },
  );

  return {
    available,
    status,
    run,
    runs,
    busy,
    error,
    refresh,
    configurePair,
    useForNextMessage,
    disarm,
    clear,
    cancel,
    retry,
    review,
    finish,
    fuse,
    applyStatus,
    armIdForSession,
    promptAccepted,
  };
}

export type UseExpertTalkState = ReturnType<typeof useExpertTalkState>;
