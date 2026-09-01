import { computed, ref, watch, type ComputedRef } from 'vue';

import { getPythinkerWebApi } from '../../api';
import type { AppExpertTalkPair, AppExpertTalkRun, AppExpertTalkStatus } from '../../api/types';
import { safeGetJson, safeSetJson, STORAGE_KEYS } from '../../lib/storage';

function loadPreferredPair(): AppExpertTalkPair | undefined {
  const value = safeGetJson<unknown>(STORAGE_KEYS.discussionPair);
  if (!value || typeof value !== 'object') return undefined;
  const pair = value as Record<string, unknown>;
  if (
    typeof pair['fusionLeadModelId'] !== 'string' || pair['fusionLeadModelId'].length === 0 ||
    typeof pair['peerModelId'] !== 'string' || pair['peerModelId'].length === 0 ||
    pair['fusionLeadModelId'] === pair['peerModelId'] ||
    (pair['fusionLeadThinkingEffort'] !== undefined && typeof pair['fusionLeadThinkingEffort'] !== 'string') ||
    (pair['peerThinkingEffort'] !== undefined && typeof pair['peerThinkingEffort'] !== 'string')
  ) return undefined;
  return value as AppExpertTalkPair;
}

export function useExpertTalkState(
  activeSessionId: ComputedRef<string>,
  capability: ComputedRef<boolean>,
  reportFailure: (operation: string, error: unknown, opts?: { sessionId?: string }) => void,
) {
  const statusBySession = ref<Record<string, AppExpertTalkStatus>>({});
  const runsById = ref<Record<string, AppExpertTalkRun>>({});
  const preferredPair = ref<AppExpertTalkPair | undefined>(loadPreferredPair());
  const busy = ref(false);
  const error = ref<string>();
  const requestEpochBySession = new Map<string, number>();
  const lastEventSeqBySession = new Map<string, number>();
  const protectedVersionBySession = new Map<string, string>();

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
    if (preferredPair.value === undefined && next.config !== null) {
      setPreferredPair(next.config);
    }
    const runId = next.activeRunId ?? next.latestRunId;
    if (runId !== undefined) void refreshRun(sessionId, runId);
  }

  function setPreferredPair(pair: AppExpertTalkPair): void {
    preferredPair.value = { ...pair };
    safeSetJson(STORAGE_KEYS.discussionPair, preferredPair.value);
  }

  function advanceRequestEpoch(sessionId: string): number {
    const next = (requestEpochBySession.get(sessionId) ?? 0) + 1;
    requestEpochBySession.set(sessionId, next);
    return next;
  }

  function setMutationStatus(sessionId: string, next: AppExpertTalkStatus): void {
    protectedVersionBySession.set(sessionId, next.resourceVersion);
    setStatus(sessionId, next);
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
    const requestEpoch = advanceRequestEpoch(sessionId);
    try {
      const [nextStatus, nextRunPage] = await Promise.all([
        getPythinkerWebApi().getExpertTalkStatus(sessionId),
        getPythinkerWebApi().listExpertTalkRuns(sessionId),
      ]);
      if (requestEpochBySession.get(sessionId) !== requestEpoch) return;
      protectedVersionBySession.delete(sessionId);
      setStatus(sessionId, nextStatus);
      for (const nextRun of nextRunPage.runs) setRun(nextRun);
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
    advanceRequestEpoch(sessionId);
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
    pair: AppExpertTalkPair,
  ): Promise<AppExpertTalkStatus> {
    if (pair.fusionLeadModelId === pair.peerModelId) throw new Error('Select two different models');
    let current = statusBySession.value[sessionId]
      ?? await getPythinkerWebApi().getExpertTalkStatus(sessionId);
    if (
      current.config?.fusionLeadModelId !== pair.fusionLeadModelId ||
      current.config.peerModelId !== pair.peerModelId ||
      current.config.fusionLeadThinkingEffort !== pair.fusionLeadThinkingEffort ||
      current.config.peerThinkingEffort !== pair.peerThinkingEffort
    ) {
      current = await getPythinkerWebApi().configureExpertTalk(
        sessionId,
        pair,
        current.resourceVersion,
      );
      setMutationStatus(sessionId, current);
      return current;
    }
    setStatus(sessionId, current);
    return current;
  }

  async function configurePair(pair: AppExpertTalkPair): Promise<void> {
    if (pair.fusionLeadModelId === pair.peerModelId) throw new Error('Select two different models');
    if (activeSessionId.value.length === 0) {
      error.value = undefined;
      setPreferredPair(pair);
      return;
    }
    await operate('expertTalkConfigure', async (sessionId) => {
      const configured = await configure(sessionId, pair);
      setPreferredPair(configured.config ?? pair);
    });
  }

  async function useForNextMessage(pair: AppExpertTalkPair): Promise<void> {
    await operate('expertTalkArm', async (sessionId) => {
      const configured = await configure(sessionId, pair);
      setPreferredPair(configured.config ?? pair);
      setMutationStatus(sessionId, await getPythinkerWebApi().armExpertTalk(
        sessionId,
        configured.resourceVersion,
      ));
    });
  }

  async function disarm(): Promise<void> {
    await operate('expertTalkDisarm', async (sessionId) => {
      const armId = statusBySession.value[sessionId]?.activation.armId;
      setMutationStatus(sessionId, await getPythinkerWebApi().disarmExpertTalk(sessionId, armId));
    });
  }

  async function clear(): Promise<void> {
    await operate('expertTalkClear', async (sessionId) => {
      const current = statusBySession.value[sessionId];
      setMutationStatus(sessionId, await getPythinkerWebApi().clearExpertTalk(
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

  function applyStatus(sessionId: string, next: AppExpertTalkStatus, sequence?: number): void {
    if (sequence !== undefined) {
      const lastSequence = lastEventSeqBySession.get(sessionId) ?? 0;
      if (sequence < lastSequence) return;
      if (sequence > lastSequence) lastEventSeqBySession.set(sessionId, sequence);
    }
    const protectedVersion = protectedVersionBySession.get(sessionId);
    if (protectedVersion !== undefined && next.resourceVersion !== protectedVersion) return;
    if (protectedVersion === next.resourceVersion) protectedVersionBySession.delete(sessionId);
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
    preferredPair,
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
    applyStatus,
    armIdForSession,
    promptAccepted,
  };
}

export type UseExpertTalkState = ReturnType<typeof useExpertTalkState>;
