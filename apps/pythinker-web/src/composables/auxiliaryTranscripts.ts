import {
  AgentTranscript,
  itemId,
  type AgentDescriptor,
  type AgentTranscriptSnapshot,
  type TranscriptOperation,
} from '@pymodel/transcript';
import { shallowRef, type ShallowRef } from 'vue';
import type {
  AppTranscriptPage,
  PythinkerEventConnection,
  PythinkerWebApi,
} from '../api/types';

const DEFAULT_PAGE_SIZE = 20;

export interface AuxiliaryTranscriptChannel {
  readonly sessionId: string;
  readonly agentId: string;
  readonly snapshot: AgentTranscriptSnapshot;
  readonly agents: AgentDescriptor[];
  readonly seq: number | undefined;
  readonly loading: boolean;
  readonly loadingOlder: boolean;
  readonly loadOlderError: boolean;
  readonly refreshError: boolean;
  refresh(): Promise<void>;
  loadOlder(): Promise<void>;
}

export interface AuxiliaryTranscriptEntry {
  channel: AuxiliaryTranscriptChannel;
  version: ShallowRef<number>;
}

interface AuxiliaryTranscriptOptions {
  api: PythinkerWebApi;
  connectEventsIfNeeded(): void;
  getEventConnection(): PythinkerEventConnection | null;
}

class TranscriptChannel implements AuxiliaryTranscriptChannel {
  private readonly transcript: AgentTranscript;
  private refreshPromise: Promise<void> | null = null;
  private buffered: Array<{ ops: TranscriptOperation[]; seq?: number }> = [];
  private agentsValue: AgentDescriptor[] = [];
  private seqValue?: number;
  private loadingOlderValue = false;
  private loadOlderErrorValue = false;
  private refreshErrorValue = false;

  constructor(
    readonly sessionId: string,
    readonly agentId: string,
    private readonly fetchPage: (input: {
      beforeTurn?: string;
      pageSize: number;
    }) => Promise<AppTranscriptPage>,
    private readonly onChange: () => void,
    private readonly onGap: () => void,
  ) {
    this.transcript = new AgentTranscript(agentId);
  }

  get snapshot() {
    return this.transcript.snapshot();
  }

  get agents() {
    return this.agentsValue;
  }

  get seq() {
    return this.seqValue;
  }

  get loading() {
    return this.refreshPromise !== null;
  }

  get loadingOlder() {
    return this.loadingOlderValue;
  }

  get loadOlderError() {
    return this.loadOlderErrorValue;
  }

  get refreshError() {
    return this.refreshErrorValue;
  }

  refresh(): Promise<void> {
    if (this.refreshPromise !== null) return this.refreshPromise;
    this.refreshErrorValue = false;
    const request = this.fetchPage({ pageSize: DEFAULT_PAGE_SIZE })
      .then((page) => this.applyPage(page, true))
      .catch((error: unknown) => {
        this.refreshErrorValue = true;
        throw error;
      })
      .finally(() => {
        this.refreshPromise = null;
        this.flushBuffered();
        this.onChange();
      });
    this.refreshPromise = request;
    this.onChange();
    return request;
  }

  receiveReset(snapshot: AgentTranscriptSnapshot, seq?: number): void {
    this.transcript.receive([{ op: 'reset', agentId: this.agentId, snapshot }]);
    if (seq !== undefined) this.seqValue = seq;
    this.refreshErrorValue = false;
    this.onChange();
  }

  applyOps(ops: TranscriptOperation[], seq?: number): boolean {
    if (this.refreshPromise !== null || this.loadingOlderValue) {
      this.buffered.push({ ops, seq });
      return false;
    }
    if (seq !== undefined && this.seqValue !== undefined) {
      if (seq <= this.seqValue) return true;
      if (seq !== this.seqValue + 1) {
        this.onGap();
        return false;
      }
    }
    const applied = this.transcript.apply(ops);
    if (seq !== undefined) this.seqValue = seq;
    if (applied.gap !== undefined) this.onGap();
    if (applied.accepted.length > 0) this.onChange();
    return applied.gap === undefined;
  }

  async loadOlder(): Promise<void> {
    if (!this.snapshot.hasMoreOlder || this.loadingOlderValue) return;
    const firstTurn = this.snapshot.items.find((item) => item.kind === 'turn');
    if (firstTurn?.kind !== 'turn') return;
    this.loadingOlderValue = true;
    this.loadOlderErrorValue = false;
    this.onChange();
    try {
      const page = await this.fetchPage({
        beforeTurn: firstTurn.turnId,
        pageSize: DEFAULT_PAGE_SIZE,
      });
      this.applyPage(page, false);
    } catch (error) {
      this.loadOlderErrorValue = true;
      throw error;
    } finally {
      this.loadingOlderValue = false;
      this.flushBuffered();
      this.onChange();
    }
  }

  private applyPage(page: AppTranscriptPage, replace: boolean): void {
    this.agentsValue = page.agents;
    const current = this.snapshot;
    const snapshot = replace
      ? page.snapshot
      : {
          ...page.snapshot,
          items: mergeItems(page.snapshot.items, current.items),
          hasMoreOlder: page.snapshot.hasMoreOlder,
        };
    this.receiveReset(snapshot, replace ? page.seq : undefined);
  }

  private flushBuffered(): void {
    const buffered = this.buffered;
    this.buffered = [];
    for (const batch of buffered) this.applyOps(batch.ops, batch.seq);
  }
}

function mergeItems(
  older: AgentTranscriptSnapshot['items'],
  current: AgentTranscriptSnapshot['items'],
): AgentTranscriptSnapshot['items'] {
  const seen = new Set<string>();
  const merged = [];
  for (const item of [...older, ...current]) {
    const id = itemId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }
  return merged;
}

function entryKey(sessionId: string, agentId: string): string {
  return `${sessionId}\0${agentId}`;
}

export function createAuxiliaryTranscripts(options: AuxiliaryTranscriptOptions) {
  const entries = new Map<string, AuxiliaryTranscriptEntry>();
  const activeBySession = new Map<string, string>();
  const subscribedBySession = new Map<string, string>();

  function notify(entry: AuxiliaryTranscriptEntry): void {
    entry.version.value += 1;
  }

  function subscribe(sessionId: string, agentId: string, sinceSeq?: number): void {
    const connection = options.getEventConnection();
    if (connection === null) return;
    connection.subscribeTranscript(sessionId, agentId, sinceSeq);
    subscribedBySession.set(sessionId, agentId);
  }

  function getOrCreate(sessionId: string, agentId: string): AuxiliaryTranscriptEntry {
    const key = entryKey(sessionId, agentId);
    const existing = entries.get(key);
    if (existing !== undefined) return existing;
    let entry: AuxiliaryTranscriptEntry;
    const channel = new TranscriptChannel(
      sessionId,
      agentId,
      (input) => options.api.getSessionTranscript(sessionId, { ...input, agentId }),
      () => notify(entry),
      () => void resume(entry),
    );
    entry = { channel, version: shallowRef(0) };
    entries.set(key, entry);
    return entry;
  }

  async function resume(entry: AuxiliaryTranscriptEntry): Promise<void> {
    try {
      await entry.channel.refresh();
      if (
        activeBySession.get(entry.channel.sessionId) === entry.channel.agentId
      ) {
        subscribe(entry.channel.sessionId, entry.channel.agentId, entry.channel.seq);
      }
    } catch {
      if (
        activeBySession.get(entry.channel.sessionId) === entry.channel.agentId
      ) {
        subscribe(entry.channel.sessionId, entry.channel.agentId);
      }
    }
  }

  function activate(sessionId: string, agentId: string): AuxiliaryTranscriptEntry {
    options.connectEventsIfNeeded();
    activeBySession.set(sessionId, agentId);
    const entry = getOrCreate(sessionId, agentId);
    if (entry.channel.snapshot.items.length > 0 || entry.channel.seq !== undefined) {
      subscribe(sessionId, agentId, entry.channel.seq);
    } else {
      void resume(entry);
    }
    return entry;
  }

  function deactivate(sessionId: string, agentId: string): void {
    if (activeBySession.get(sessionId) !== agentId) return;
    activeBySession.delete(sessionId);
    const subscribed = subscribedBySession.get(sessionId);
    if (subscribed !== undefined) {
      options.getEventConnection()?.unsubscribeTranscript(sessionId, [subscribed]);
      subscribedBySession.delete(sessionId);
    }
  }

  return {
    getEntry(sessionId: string, agentId: string) {
      return entries.get(entryKey(sessionId, agentId));
    },
    activate,
    deactivate,
    receiveReset(
      sessionId: string,
      agentId: string,
      snapshot: AgentTranscriptSnapshot,
      seq?: number,
    ) {
      if (activeBySession.get(sessionId) !== agentId) return;
      const entry = getOrCreate(sessionId, agentId);
      (entry.channel as TranscriptChannel).receiveReset(snapshot, seq);
    },
    applyOps(
      sessionId: string,
      agentId: string,
      ops: TranscriptOperation[],
      seq?: number,
    ) {
      if (activeBySession.get(sessionId) !== agentId) return true;
      return (getOrCreate(sessionId, agentId).channel as TranscriptChannel).applyOps(ops, seq);
    },
    forgetSession(sessionId: string) {
      const agentId = activeBySession.get(sessionId);
      if (agentId !== undefined) deactivate(sessionId, agentId);
      for (const key of entries.keys()) {
        if (key.startsWith(`${sessionId}\0`)) entries.delete(key);
      }
    },
  };
}

export type AuxiliaryTranscripts = ReturnType<typeof createAuxiliaryTranscripts>;
