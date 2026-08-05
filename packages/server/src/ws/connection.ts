

import type { RawData, WebSocket } from 'ws';
import { ulid } from 'ulid';

import {
  ErrorCode,
  WS_PROTOCOL_VERSION,
  type AbortMessage,
  type ClientHelloMessage,
  type ClientControlMessage,
  type CursorsBySession,
  type SessionCursor,
  type SubscribeMessage,
  type TerminalAttachMessage,
  type TerminalCloseMessage,
  type TerminalDetachMessage,
  type TerminalInputMessage,
  type TerminalResizeMessage,
  type UnsubscribeMessage,
  type WatchFsAddMessage,
  type WatchFsRemoveMessage,
  getClientControlOperation,
} from '@pythoughts/protocol';

import type {
  ILogService,
  TerminalAttachOptions,
  TerminalAttachSink,
} from '@pythoughts/agent-core';
import type { ISessionClientsService } from '#/services/gateway';

import {
  buildAck,
  buildPing,
  buildResyncRequired,
  buildServerHello,
  type EventEnvelope,
} from './protocol';
import { rawDataToString } from './rawData';

export interface BufferReplaySource {
  getBufferedSince(
    sessionId: string,
    cursor: SessionCursor,
  ): Promise<{
    events: Array<{ seq: number; envelope: EventEnvelope }>;
    resyncRequired: 'buffer_overflow' | 'session_recreated' | 'epoch_changed' | false;
    currentSeq: number;
    epoch: string;
  }>;

  getCursor(sessionId: string): Promise<{ seq: number; epoch: string }>;
}

export interface AbortHandler {
  abort(
    sessionId: string,
    promptId: string,
  ): Promise<{ aborted: boolean; at_seq?: number }>;

  currentSeq(sessionId: string): number;
}

export interface FsWatchHandler {
  add(
    sessionId: string,
    connectionId: string,
    wirePaths: readonly string[],
  ): Promise<FsWatchResult>;
  remove(
    sessionId: string,
    connectionId: string,
    wirePaths: readonly string[],
  ): Promise<FsWatchResult>;
  cleanupConnection(connectionId: string): void;
}

export type FsWatchResult =
  | { ok: true; watched_paths: string[]; current_count: number }
  | { ok: false; code: number; msg: string };

export interface TerminalHandler {
  attach(
    sessionId: string,
    terminalId: string,
    sink: TerminalAttachSink,
    options?: TerminalAttachOptions,
  ): Promise<{ replayed: number }>;
  detach(sessionId: string, terminalId: string, sinkId: string): void;
  cleanupConnection(sinkId: string): void;
  write(sessionId: string, terminalId: string, data: string): Promise<void>;
  resize(sessionId: string, terminalId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string, terminalId: string): Promise<{ closed: true }>;
}

export interface WsConnectionOptions {
  socket: WebSocket;
  logger: ILogService;

  sessionClients: ISessionClientsService;

  wsBroadcast: BufferReplaySource;

  abortHandler?: AbortHandler;

  fsWatchHandler?: FsWatchHandler;

  terminalHandler?: TerminalHandler;

  pingIntervalMs?: number;

  pongTimeoutMs?: number;

  maxEventBufferSize?: number;

  /** Peer address from the upgrade socket. Null when unavailable. */
  remoteAddress?: string | null;

  /** `User-Agent` header from the upgrade request. Null when absent. */
  userAgent?: string | null;
}

const DEFAULT_PING_INTERVAL_MS = 30_000;

const DEFAULT_PONG_TIMEOUT_MS = 10_000;

const DEFAULT_MAX_EVENT_BUFFER = 1000;

type HandshakeState = 'awaiting_hello' | 'negotiating' | 'ready' | 'closing';

export class WsConnection {
  public readonly id: string;

  public readonly subscriptions = new Set<string>();

  /** Last cursor each subscribed session was synced from (client-claimed). */
  public readonly cursorsBySession = new Map<string, SessionCursor>();

  /** ISO 8601 UTC timestamp the socket was accepted at. */
  public readonly connectedAt: string;

  /** Peer address from the upgrade socket. Null when unavailable. */
  public readonly remoteAddress: string | null;

  /** `User-Agent` header from the upgrade request. Null when absent. */
  public readonly userAgent: string | null;

  private readonly socket: WebSocket;
  private readonly logger: ILogService;
  private readonly sessionClients: ISessionClientsService;
  private readonly wsBroadcast: BufferReplaySource;
  private readonly abortHandler: AbortHandler | undefined;
  private readonly fsWatchHandler: FsWatchHandler | undefined;
  private readonly terminalHandler: TerminalHandler | undefined;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly maxEventBufferSize: number;

  private pingTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private closed = false;
  private handshakeState: HandshakeState = 'awaiting_hello';

  constructor(opts: WsConnectionOptions) {
    this.id = `conn_${ulid()}`;
    this.connectedAt = new Date().toISOString();
    this.remoteAddress = opts.remoteAddress ?? null;
    this.userAgent = opts.userAgent ?? null;
    this.socket = opts.socket;
    this.logger = opts.logger.child({ connId: this.id });
    this.sessionClients = opts.sessionClients;
    this.wsBroadcast = opts.wsBroadcast;
    this.abortHandler = opts.abortHandler;
    this.fsWatchHandler = opts.fsWatchHandler;
    this.terminalHandler = opts.terminalHandler;
    this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.pongTimeoutMs = opts.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
    this.maxEventBufferSize = opts.maxEventBufferSize ?? DEFAULT_MAX_EVENT_BUFFER;

    this.send(
      buildServerHello({
        ws_connection_id: this.id,
        protocol_version: WS_PROTOCOL_VERSION,
        heartbeat_ms: this.pingIntervalMs,
        max_event_buffer_size: this.maxEventBufferSize,
        capabilities: { event_batching: false, compression: false },
      }),
    );

    this.socket.on('message', (data) => this.onMessage(data));
    this.socket.on('close', (code, reason) => this.onClose(code, String(reason)));
    this.socket.on('error', (err) => this.logger.warn({ err: String(err) }, 'ws socket error'));

    this.startPingTimer();
  }

  private onMessage(data: RawData): void {
    if (this.closed || this.handshakeState === 'closing') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToString(data));
    } catch {
      if (this.handshakeState !== 'ready') {
        this.closeProtocol();
        return;
      }
      this.logger.warn('non-json ws frame; ignoring');
      return;
    }
    const type = frameType(parsed);
    if (this.handshakeState === 'awaiting_hello') {
      if (type !== 'client_hello') {
        this.closeProtocol();
        return;
      }
      this.startClientHello(parsed);
      return;
    }
    if (this.handshakeState === 'negotiating') {
      this.closeProtocol();
      return;
    }
    if (type === undefined) {
      this.logger.warn('invalid control message type');
      return;
    }
    if (type === 'client_hello') {
      this.closeProtocol();
      return;
    }
    const operation = getClientControlOperation(type);
    if (operation === undefined) {
      this.logger.warn({ type }, 'unknown control message type');
      return;
    }
    const result = operation.messageSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn({ issues: result.error.issues.length }, 'invalid control message');
      return;
    }
    const msg = result.data as ClientControlMessage;
    switch (msg.type) {
      case 'client_hello':
        void this.onClientHello(msg).catch((error: unknown) => {
          this.logger.warn({ err: String(error) }, 'client_hello handler failed');
        });
        break;
      case 'pong':
        this.onPong();
        break;
      case 'subscribe':
        void this.onSubscribe(msg).catch((error: unknown) => {
          this.logger.warn({ err: String(error) }, 'subscribe handler failed');
        });
        break;
      case 'unsubscribe':
        this.onUnsubscribe(msg);
        break;
      case 'abort':
        this.onAbort(msg);
        break;
      case 'watch_fs_add':
        this.onWatchFsAdd(msg);
        break;
      case 'watch_fs_remove':
        this.onWatchFsRemove(msg);
        break;
      case 'terminal_attach':
        this.onTerminalAttach(msg);
        break;
      case 'terminal_detach':
        this.onTerminalDetach(msg);
        break;
      case 'terminal_input':
        this.onTerminalInput(msg);
        break;
      case 'terminal_resize':
        this.onTerminalResize(msg);
        break;
      case 'terminal_close':
        this.onTerminalClose(msg);
        break;
      default: {
        const exhaustive: never = msg;
        void exhaustive;
        this.logger.warn('unhandled control message type');
      }
    }
  }

  private startClientHello(raw: unknown): void {
    const id = frameId(raw);
    if (frameProtocolVersion(raw) !== WS_PROTOCOL_VERSION) {
      if (id === undefined) {
        this.closeProtocol();
        return;
      }
      this.handshakeState = 'negotiating';
      void this.rejectProtocolVersion(id);
      return;
    }

    const operation = getClientControlOperation('client_hello');
    const result = operation?.messageSchema.safeParse(raw);
    if (result === undefined || !result.success) {
      this.logger.warn('invalid client_hello');
      this.closeProtocol();
      return;
    }
    this.handshakeState = 'negotiating';
    void this.onClientHello(result.data as ClientHelloMessage).catch((error: unknown) => {
      this.logger.warn({ err: String(error) }, 'client_hello handler failed');
      this.closeProtocol();
    });
  }

  private async onClientHello(msg: ClientHelloMessage): Promise<void> {
    const { subscriptions, cursors } = msg.payload;
    await this.preflightSessionJournals(subscriptions, cursors);
    const ackWritten = await this.sendAndWait(
      buildAck(msg.id, 0, 'success', {
        accepted_subscriptions: [],
        resync_required: [],
      }),
    );
    if (!ackWritten || this.closed || this.handshakeState !== 'negotiating') return;

    this.handshakeState = 'ready';
    const sync = await this.syncSessions(subscriptions, cursors, false);
    this.logger.info(
      {
        acceptedCount: sync.accepted.length,
        resyncRequiredCount: sync.resyncRequired.length,
      },
      'client hello',
    );
  }

  private async rejectProtocolVersion(id: string): Promise<void> {
    await this.sendAndWait(
      buildAck(id, ErrorCode.PROTOCOL_VERSION_MISMATCH, 'protocol.version_mismatch', {
        accepted_subscriptions: [],
        resync_required: [],
      }),
    );
    this.close(1002, 'protocol.version_mismatch');
  }

  /**
   * Shared client_hello/subscribe session sync:
   *   1. validate every journal before committing a subscription,
   *   2. register the subscription (live events flow immediately; the client
   *      dedups overlap by seq),
   *   3. replay durable events past the client's cursor, or emit
   *      `resync_required` when the cursor cannot be served,
   *   4. report the server-side `{seq, epoch}` cursor for every accepted
   *      session so the client can adopt the current epoch.
   */
  private async syncSessions(
    sessionIds: readonly string[],
    cursors: CursorsBySession | undefined,
    preflight = true,
  ): Promise<{
    accepted: string[];
    resyncRequired: string[];
    serverCursors: CursorsBySession;
  }> {
    if (preflight) await this.preflightSessionJournals(sessionIds, cursors);
    const accepted: string[] = [];
    const resyncRequired: string[] = [];
    const serverCursors: CursorsBySession = {};

    for (const sid of sessionIds) {
      if (!this.subscriptions.has(sid)) {
        this.subscribe(sid);
      }
      if (!accepted.includes(sid)) accepted.push(sid);
    }

    if (cursors) {
      for (const [sid, cursor] of Object.entries(cursors)) {
        this.cursorsBySession.set(sid, cursor);
        if (!this.subscriptions.has(sid)) {
          this.subscribe(sid);
        }
        if (!accepted.includes(sid)) accepted.push(sid);

        const result = await this.wsBroadcast.getBufferedSince(sid, cursor);
        if (result.resyncRequired !== false) {
          this.send(
            buildResyncRequired(sid, result.resyncRequired, result.currentSeq, result.epoch),
          );
          resyncRequired.push(sid);
        } else {
          for (const entry of result.events) {
            this.send(entry.envelope);
          }
        }
      }
    }

    for (const sid of accepted) {
      serverCursors[sid] = await this.wsBroadcast.getCursor(sid);
    }

    return { accepted, resyncRequired, serverCursors };
  }

  private async preflightSessionJournals(
    sessionIds: readonly string[],
    cursors: CursorsBySession | undefined,
  ): Promise<void> {
    const requested = new Set(sessionIds);
    if (cursors !== undefined) {
      for (const sid of Object.keys(cursors)) requested.add(sid);
    }
    for (const sid of requested) {
      await this.wsBroadcast.getCursor(sid);
    }
  }

  private async onSubscribe(msg: SubscribeMessage): Promise<void> {
    const { session_ids, cursors, watch_fs } = msg.payload;
    this.logger.info(
      { sessionIds: session_ids, cursors, hasWatchFs: !!watch_fs },
      'ws subscribe',
    );

    const sync = await this.syncSessions(session_ids, cursors);

    if (watch_fs && this.fsWatchHandler !== undefined) {
      for (const [sid, cfg] of Object.entries(watch_fs)) {
        if (cfg.paths.length === 0) continue;
        const handler = this.fsWatchHandler;
        void handler
          .add(sid, this.id, cfg.paths)
          .then((result) => {
            if (!result.ok) {
              this.logger.warn(
                { sid, code: result.code, msg: result.msg },
                'subscribe.watch_fs add failed; client should retry via watch_fs_add',
              );
            }
          })
          .catch((error: unknown) => {
            this.logger.warn(
              { sid, err: String(error) },
              'subscribe.watch_fs add threw',
            );
          });
      }
    }

    this.send(
      buildAck(msg.id, 0, 'success', {
        accepted: sync.accepted,
        not_found: [],
        resync_required: sync.resyncRequired,
        cursors: sync.serverCursors,
      }),
    );
  }

  private onUnsubscribe(msg: UnsubscribeMessage): void {
    const { session_ids } = msg.payload;
    for (const sid of session_ids) {
      this.unsubscribe(sid);
      this.cursorsBySession.delete(sid);

      if (this.fsWatchHandler !== undefined) {

        const handler = this.fsWatchHandler;
        void handler.remove(sid, this.id, []).catch((error: unknown) => {
          this.logger.warn(
            { sid, err: String(error) },
            'unsubscribe watch_fs drop threw',
          );
        });
      }
    }
    this.send(
      buildAck(msg.id, 0, 'success', {
        accepted: session_ids,
        not_found: [],
        resync_required: [],
      }),
    );
  }

  private onWatchFsAdd(msg: WatchFsAddMessage): void {
    if (this.fsWatchHandler === undefined) {
      this.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'fs watch handler not wired', {}),
      );
      return;
    }
    const { session_id, paths } = msg.payload;
    const handler = this.fsWatchHandler;
    void handler
      .add(session_id, this.id, paths)
      .then((result) => {
        if (!result.ok) {
          this.send(buildAck(msg.id, result.code, result.msg, {}));
          return;
        }
        this.send(
          buildAck(msg.id, 0, 'success', {
            watched_paths: result.watched_paths,
            current_count: result.current_count,
          }),
        );
      })
      .catch((error: unknown) => {
        this.logger.warn({ err: String(error) }, 'watch_fs_add handler threw');
        this.send(
          buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'watch_fs_add failed', {}),
        );
      });
  }

  private onWatchFsRemove(msg: WatchFsRemoveMessage): void {
    if (this.fsWatchHandler === undefined) {
      this.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'fs watch handler not wired', {}),
      );
      return;
    }
    const { session_id, paths } = msg.payload;
    const handler = this.fsWatchHandler;
    void handler
      .remove(session_id, this.id, paths)
      .then((result) => {
        if (!result.ok) {
          this.send(buildAck(msg.id, result.code, result.msg, {}));
          return;
        }
        this.send(
          buildAck(msg.id, 0, 'success', {
            watched_paths: result.watched_paths,
            current_count: result.current_count,
          }),
        );
      })
      .catch((error: unknown) => {
        this.logger.warn({ err: String(error) }, 'watch_fs_remove handler threw');
        this.send(
          buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'watch_fs_remove failed', {}),
        );
      });
  }

  private onAbort(msg: AbortMessage): void {
    const { session_id, prompt_id } = msg.payload;
    if (this.abortHandler === undefined) {
      this.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'abort handler not wired', {}),
      );
      return;
    }
    void this.abortHandler
      .abort(session_id, prompt_id)
      .then((result) => {
        this.send(
          buildAck(msg.id, 0, 'success', {
            aborted: result.aborted,
            ...(result.at_seq !== undefined ? { at_seq: result.at_seq } : {}),
          }),
        );
      })
      .catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name: string }).name === 'PromptAlreadyCompletedError'
        ) {
          const at_seq = this.abortHandler!.currentSeq(session_id);
          this.send(
            buildAck(msg.id, 0, 'success', { aborted: false, at_seq }),
          );
          return;
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name: string }).name === 'PromptNotFoundError'
        ) {
          this.send(
            buildAck(msg.id, ErrorCode.PROMPT_NOT_FOUND, 'prompt not found', {}),
          );
          return;
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name: string }).name === 'SessionNotFoundError'
        ) {
          this.send(
            buildAck(msg.id, ErrorCode.SESSION_NOT_FOUND, 'session not found', {}),
          );
          return;
        }
        this.logger.warn({ err: String(error) }, 'ws abort handler error');
        this.send(
          buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'abort failed', {}),
        );
      });
  }

  private onTerminalAttach(msg: TerminalAttachMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id, since_seq } = msg.payload;
    this.terminalHandler
      .attach(session_id, terminal_id, this, { sinceSeq: since_seq })
      .then((result) => {
        this.send(buildAck(msg.id, 0, 'success', {
          attached: true,
          replayed: result.replayed,
        }));
      })
      .catch((error: unknown) => {
        this.sendTerminalErrorAck(msg.id, error, 'terminal_attach failed');
      });
  }

  private onTerminalDetach(msg: TerminalDetachMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id } = msg.payload;
    try {
      this.terminalHandler.detach(session_id, terminal_id, this.id);
      this.send(buildAck(msg.id, 0, 'success', { detached: true }));
    } catch (error) {
      this.sendTerminalErrorAck(msg.id, error, 'terminal_detach failed');
    }
  }

  private onTerminalInput(msg: TerminalInputMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id, data } = msg.payload;
    this.terminalHandler
      .write(session_id, terminal_id, data)
      .then(() => {
        this.send(buildAck(msg.id, 0, 'success', { accepted: true }));
      })
      .catch((error: unknown) => {
        this.sendTerminalErrorAck(msg.id, error, 'terminal_input failed');
      });
  }

  private onTerminalResize(msg: TerminalResizeMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id, cols, rows } = msg.payload;
    this.terminalHandler
      .resize(session_id, terminal_id, cols, rows)
      .then(() => {
        this.send(buildAck(msg.id, 0, 'success', { resized: true }));
      })
      .catch((error: unknown) => {
        this.sendTerminalErrorAck(msg.id, error, 'terminal_resize failed');
      });
  }

  private onTerminalClose(msg: TerminalCloseMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id } = msg.payload;
    this.terminalHandler
      .close(session_id, terminal_id)
      .then((result) => {
        this.send(buildAck(msg.id, 0, 'success', result));
      })
      .catch((error: unknown) => {
        this.sendTerminalErrorAck(msg.id, error, 'terminal_close failed');
      });
  }

  private sendTerminalErrorAck(id: string, err: unknown, fallback: string): void {
    if (hasErrorName(err, 'TerminalNotFoundError')) {
      this.send(buildAck(id, ErrorCode.TERMINAL_NOT_FOUND, 'terminal not found', {}));
      return;
    }
    if (hasErrorName(err, 'SessionNotFoundError')) {
      this.send(buildAck(id, ErrorCode.SESSION_NOT_FOUND, 'session not found', {}));
      return;
    }
    this.logger.warn({ err: String(err) }, fallback);
    this.send(buildAck(id, ErrorCode.INTERNAL_ERROR, fallback, {}));
  }

  private subscribe(sid: string): void {
    if (this.subscriptions.has(sid)) return;
    this.subscriptions.add(sid);
    this.sessionClients.subscribe(this, sid);
  }

  private unsubscribe(sid: string): void {
    if (!this.subscriptions.has(sid)) return;
    this.subscriptions.delete(sid);
    this.sessionClients.unsubscribe(this, sid);
  }

  private startPingTimer(): void {
    this.pingTimer = setInterval(() => {
      if (this.closed) return;
      this.send(buildPing());

      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        if (this.closed) return;
        this.logger.warn('pong timeout — terminating socket');
        try {
          this.socket.terminate();
        } catch {

        }
      }, this.pongTimeoutMs);
      this.pongTimer.unref?.();
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  private onPong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  private onClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.handshakeState = 'closing';
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);

    this.sessionClients.forgetConnection(this);
    this.subscriptions.clear();

    if (this.fsWatchHandler !== undefined) {
      try {
        this.fsWatchHandler.cleanupConnection(this.id);
      } catch (error) {
        this.logger.warn(
          { err: String(error) },
          'fsWatchHandler.cleanupConnection threw',
        );
      }
    }
    if (this.terminalHandler !== undefined) {
      try {
        this.terminalHandler.cleanupConnection(this.id);
      } catch (error) {
        this.logger.warn(
          { err: String(error) },
          'terminalHandler.cleanupConnection threw',
        );
      }
    }
    this.logger.info({ code, reason, handshakeState: this.handshakeState }, 'connection closed');
  }

  public send(message: unknown): void {
    if (this.closed) return;
    if (this.socket.readyState !== this.socket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(message), (err) => {
        if (err) this.logger.warn({ err: String(err) }, 'ws send failed');
      });
    } catch (error) {
      this.logger.warn({ err: String(error) }, 'ws send threw');
    }
  }

  private sendAndWait(message: unknown): Promise<boolean> {
    if (this.closed || this.socket.readyState !== this.socket.OPEN) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        this.socket.send(JSON.stringify(message), (err) => {
          if (err) this.logger.warn({ err: String(err) }, 'ws send failed');
          resolve(!err);
        });
      } catch (error) {
        this.logger.warn({ err: String(error) }, 'ws send threw');
        resolve(false);
      }
    });
  }

  public close(code = 1000, reason?: string): void {
    if (this.closed) return;
    this.handshakeState = 'closing';
    try {
      this.socket.close(code, reason);
    } catch {

    }

  }

  public get hasClientHello(): boolean {
    return this.handshakeState === 'ready';
  }

  private closeProtocol(): void {
    this.close(1002, 'protocol.handshake_required');
  }
}

function frameType(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return undefined;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

function frameId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

function frameProtocolVersion(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const payload = (value as { payload?: unknown }).payload;
  if (typeof payload !== 'object' || payload === null) return undefined;
  return (payload as { protocol_version?: unknown }).protocol_version;
}

function hasErrorName(err: unknown, name: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === name
  );
}
