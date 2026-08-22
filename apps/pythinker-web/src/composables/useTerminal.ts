import { computed, onUnmounted, ref, watch, type Ref } from 'vue';
import { getPythinkerWebApi } from '../api';
import type { AppTerminal, PythinkerEventConnection } from '../api/types';

export function useTerminal(sessionId: Ref<string>) {
  const terminals = ref<AppTerminal[]>([]);
  const activeTerminalId = ref<string | null>(null);
  const terminal = computed(() => terminals.value.find((item) => item.id === activeTerminalId.value) ?? null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const connected = ref(false);
  const readOnly = ref(false);
  const lastSeqByTerminal = new Map<string, number>();

  const outputHandlers = new Set<(data: string) => void>();
  const exitHandlers = new Set<(exitCode: number | null) => void>();
  let conn: PythinkerEventConnection | null = null;

  function ensureConnection(): PythinkerEventConnection | null {
    if (conn !== null) return conn;
    if (typeof WebSocket === 'undefined') return null;
    conn = getPythinkerWebApi().connectEvents({
      onEvent: () => {},
      onResync: () => {},
      onError: (_code, msg) => {
        error.value = msg;
      },
      onConnectionChange: (state) => {
        connected.value = state;
      },
      onTerminalOutput: (sid, terminalId, data, seq) => {
        if (sid !== sessionId.value || terminal.value?.id !== terminalId) return;
        lastSeqByTerminal.set(terminalId, Math.max(lastSeqByTerminal.get(terminalId) ?? 0, seq));
        for (const handler of outputHandlers) handler(data);
      },
      onTerminalExit: (sid, terminalId, exitCode) => {
        if (sid !== sessionId.value || terminal.value?.id !== terminalId) return;
        readOnly.value = true;
        terminals.value = terminals.value.map((item) => item.id === terminalId
          ? { ...item, status: 'exited', exitCode }
          : item);
        for (const handler of exitHandlers) handler(exitCode);
      },
    });
    return conn;
  }

  async function start(size?: { cols?: number; rows?: number }): Promise<void> {
    const sid = sessionId.value;
    if (!sid || loading.value) return;
    loading.value = true;
    error.value = null;
    try {
      const api = getPythinkerWebApi();
      const existing = await api.listTerminals(sid);
      terminals.value = existing;
      const next = existing.find((item) => item.status === 'running') ?? existing[0] ?? await api.createTerminal(sid, {
        cols: size?.cols, rows: size?.rows,
      });
      if (existing.length === 0) terminals.value = [next];
      activeTerminalId.value = next.id;
      readOnly.value = next.status === 'exited';
      ensureConnection()?.terminalAttach(sid, next.id, lastSeqByTerminal.get(next.id));
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_);
    } finally {
      loading.value = false;
    }
  }

  async function newTab(size?: { cols?: number; rows?: number }): Promise<void> {
    const sid = sessionId.value;
    if (!sid || loading.value) return;
    loading.value = true;
    error.value = null;
    try {
      const next = await getPythinkerWebApi().createTerminal(sid, size);
      const current = terminal.value;
      if (current) conn?.terminalDetach(current.sessionId, current.id);
      terminals.value = [...terminals.value, next];
      activeTerminalId.value = next.id;
      readOnly.value = false;
      ensureConnection()?.terminalAttach(sid, next.id);
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_);
    } finally {
      loading.value = false;
    }
  }

  function selectTab(id: string): void {
    if (id === activeTerminalId.value) return;
    const current = terminal.value;
    const next = terminals.value.find((item) => item.id === id);
    if (!next) return;
    if (current) conn?.terminalDetach(current.sessionId, current.id);
    activeTerminalId.value = id;
    readOnly.value = next.status === 'exited';
    ensureConnection()?.terminalAttach(next.sessionId, next.id, 0);
  }

  function write(data: string): void {
    const current = terminal.value;
    if (!current || readOnly.value) return;
    ensureConnection()?.terminalInput(current.sessionId, current.id, data);
  }

  function resize(cols: number, rows: number): void {
    const current = terminal.value;
    if (!current || readOnly.value) return;
    ensureConnection()?.terminalResize(current.sessionId, current.id, cols, rows);
  }

  async function close(id = activeTerminalId.value): Promise<void> {
    const current = terminals.value.find((item) => item.id === id);
    if (!current) return;
    try {
      ensureConnection()?.terminalClose(current.sessionId, current.id);
      await getPythinkerWebApi().closeTerminal(current.sessionId, current.id);
      const index = terminals.value.findIndex((item) => item.id === current.id);
      terminals.value = terminals.value.filter((item) => item.id !== current.id);
      lastSeqByTerminal.delete(current.id);
      if (activeTerminalId.value === current.id) {
        activeTerminalId.value = null;
        const next = terminals.value[Math.min(index, terminals.value.length - 1)];
        if (next) {
          activeTerminalId.value = next.id;
          readOnly.value = next.status === 'exited';
          ensureConnection()?.terminalAttach(next.sessionId, next.id, 0);
        } else {
          readOnly.value = false;
        }
      }
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_);
    }
  }

  async function restart(size?: { cols?: number; rows?: number }): Promise<void> {
    const current = terminal.value;
    if (!current) {
      await newTab(size);
      return;
    }
    const index = terminals.value.findIndex((item) => item.id === current.id);
    await close(current.id);
    await newTab(size);
    const created = terminals.value.at(-1);
    if (created && index >= 0 && index < terminals.value.length - 1) {
      const reordered = terminals.value.filter((item) => item.id !== created.id);
      reordered.splice(index, 0, created);
      terminals.value = reordered;
    }
  }

  function onOutput(handler: (data: string) => void): () => void {
    outputHandlers.add(handler);
    return () => outputHandlers.delete(handler);
  }

  function onExit(handler: (exitCode: number | null) => void): () => void {
    exitHandlers.add(handler);
    return () => exitHandlers.delete(handler);
  }

  watch(sessionId, () => {
    const current = terminal.value;
    if (current) conn?.terminalDetach(current.sessionId, current.id);
    terminals.value = [];
    activeTerminalId.value = null;
    readOnly.value = false;
    lastSeqByTerminal.clear();
  });

  onUnmounted(() => {
    const current = terminal.value;
    if (current) conn?.terminalDetach(current.sessionId, current.id);
    conn?.close();
    conn = null;
  });

  return {
    terminal,
    terminals,
    activeTerminalId,
    loading,
    error,
    connected,
    readOnly,
    start,
    newTab,
    selectTab,
    write,
    resize,
    close,
    restart,
    onOutput,
    onExit,
  };
}
