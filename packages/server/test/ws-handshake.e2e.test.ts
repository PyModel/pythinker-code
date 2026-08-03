/**
 * WS handshake + heartbeat e2e (W5.1 / P0.15).
 *
 * Boots `startServer` on port 0 with a tmpdir lock, then connects a real
 * `ws` client. Validates the full WS.md §1 lifecycle:
 *
 *   1. Server immediately sends `server_hello`.
 *   2. Client sends `client_hello` → server acks (code=0).
 *   3. Server pings every `pingIntervalMs` (overridden to 60ms here so the
 *      test finishes in <1s instead of waiting 30s).
 *   4. Client `pong` resets the pong timer — connection stays alive.
 *   5. Daemon close → WS code 1001 (going away).
 *
 * Uses `wsGatewayOptions.pingIntervalMs` + `.pongTimeoutMs` to shrink timers.
 * The connection's `WsConnection` reads those through the gateway.
 */

import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ILogService, TelemetryClient, TelemetryProperties } from '@pythoughts/agent-core';
import {
  ErrorCode,
  WS_PROTOCOL_VERSION,
  clientHelloAckMessageSchema,
} from '@pythoughts/protocol';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import {
  IConnectionRegistry,
  ISessionClientsService,
  IWSBroadcastService,
  IWSGateway,
  startServer,
  type RunningServer,
} from '../src';
import { WsConnection } from '../src/ws/connection';
import { rawDataToString } from '../src/ws/rawData';

interface TelemetryRecord {
  readonly event: string;
  readonly properties?: TelemetryProperties;
}

function recordingTelemetry(records: TelemetryRecord[]): TelemetryClient {
  const client: TelemetryClient = {
    track: (event, properties) => {
      records.push({ event, properties });
    },
    withContext: () => client,
    setContext: () => {},
  };
  return client;
}

async function waitForEvent(
  records: readonly TelemetryRecord[],
  event: string,
  timeoutMs: number,
): Promise<TelemetryRecord> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = records.find((r) => r.event === event);
    if (found !== undefined) return found;
    await new Promise((res) => {
      setTimeout(res, 10);
    });
  }
  throw new Error(`event ${event} not observed; got ${JSON.stringify(records)}`);
}

let tmpDir: string;
let lockPath: string;
let bridgeHome: string;
const running: RunningServer[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pythinker-server-ws-handshake-'));
  lockPath = join(tmpDir, 'lock');
  bridgeHome = mkdtempSync(join(tmpdir(), 'pythinker-server-ws-handshake-home-'));
});

afterEach(async () => {
  for (const r of running.splice(0)) {
    try {
      await r.close();
    } catch {
      // ignore
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(bridgeHome, { recursive: true, force: true });
});

async function spawn(): Promise<RunningServer> {
  const r = await startServer({
    host: '127.0.0.1',
    port: 0,
    lockPath,
    logger: pino({ level: 'silent' }),
    coreProcessOptions: { homeDir: bridgeHome },
    wsGatewayOptions: { pingIntervalMs: 60, pongTimeoutMs: 200 },
  });
  running.push(r);
  return r;
}

function wsUrl(http: string): string {
  return http.replace(/^http:\/\//, 'ws://') + '/api/v1/ws';
}

function writeEmptyJournal(sessionId: string): void {
  const journalDir = join(bridgeHome, 'server', 'events-v3');
  mkdirSync(journalDir, { recursive: true });
  writeFileSync(join(journalDir, `${sessionId}.jsonl`), '', 'utf8');
}

async function poisonJournal(runningServer: RunningServer, sessionId: string): Promise<void> {
  await expect(
    runningServer.services.invokeFunction((accessor) =>
      accessor.get(IWSBroadcastService).getCursor(sessionId),
    ),
  ).rejects.toThrow('event journal is empty');
}

interface WsFrame {
  type: string;
  payload?: unknown;
  id?: string;
  code?: number;
  [k: string]: unknown;
}

/**
 * Wraps a `WebSocket` with a message queue. Frames received between socket
 * open and the first `await receive(...)` call go into `queue` so the test
 * doesn't race the server's first push (which can land within the same tick
 * as the upgrade callback). Without this, fast tests miss `server_hello`.
 */
interface Conn {
  ws: WebSocket;
  queue: WsFrame[];
  waiters: Array<(frame: WsFrame) => void>;
  closed: Promise<{ code: number; reason: string }>;
  timeline: Array<{ kind: 'frame'; raw: string } | { kind: 'close'; code: number; reason: string }>;
}

function openConn(url: string): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const queue: WsFrame[] = [];
    const waiters: Array<(frame: WsFrame) => void> = [];
    const timeline: Conn['timeline'] = [];
    let closedResolve: (v: { code: number; reason: string }) => void;
    const closed = new Promise<{ code: number; reason: string }>((res) => {
      closedResolve = res;
    });
    ws.on('message', (data) => {
      const raw = rawDataToString(data);
      timeline.push({ kind: 'frame', raw });
      let parsed: WsFrame;
      try {
        parsed = JSON.parse(raw) as WsFrame;
      } catch {
        return;
      }
      if (waiters.length > 0) {
        const w = waiters.shift();
        w?.(parsed);
      } else {
        queue.push(parsed);
      }
    });
    ws.on('close', (code, reason) => {
      const close = { code, reason: String(reason) };
      timeline.push({ kind: 'close', ...close });
      closedResolve(close);
    });
    ws.once('open', () => resolve({ ws, queue, waiters, closed, timeline }));
    ws.once('error', (err) => reject(err));
  });
}

async function waitForCondition(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`condition not satisfied within ${timeoutMs}ms`);
}

class DelayedSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = this.OPEN;
  readonly sent: Array<{ frame: WsFrame; callback?: (error?: Error) => void }> = [];
  closeArgs: { code: number; reason: string } | undefined;

  send(raw: string, callback?: (error?: Error) => void): void {
    this.sent.push({ frame: JSON.parse(raw) as WsFrame, callback });
  }

  close(code = 1000, reason = ''): void {
    this.closeArgs = { code, reason };
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason));
  }

  releaseAck(): void {
    this.sent.find((entry) => entry.frame.type === 'ack')?.callback?.();
  }
}

class RecordingSessionClients {
  readonly subscribed: string[] = [];

  subscribe(_connection: WsConnection, sessionId: string): void {
    this.subscribed.push(sessionId);
  }

  unsubscribe(): void {}

  forgetConnection(): void {}

  getConnections(): Iterable<WsConnection> {
    return [];
  }
}

function createDelayedConnection(): {
  socket: DelayedSocket;
  connection: WsConnection;
  sessionClients: RecordingSessionClients;
} {
  const socket = new DelayedSocket();
  const sessionClients = new RecordingSessionClients();
  const connection = new WsConnection({
    socket: socket as unknown as WebSocket,
    logger: pino({ level: 'silent' }) as unknown as ILogService,
    sessionClients: sessionClients as never,
    wsBroadcast: {
      getBufferedSince: async () => ({
        events: [],
        resyncRequired: false,
        currentSeq: 0,
        epoch: 'ep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      }),
      getCursor: async () => ({ seq: 0, epoch: 'ep_01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
    },
  });
  return { socket, connection, sessionClients };
}

/** Pop the next frame (queued or yet-to-arrive). Rejects on timeout. */
function receive(conn: Conn, timeoutMs: number): Promise<WsFrame> {
  return new Promise((resolve, reject) => {
    if (conn.queue.length > 0) {
      resolve(conn.queue.shift()!);
      return;
    }
    const t = setTimeout(() => {
      const idx = conn.waiters.indexOf(waiter);
      if (idx >= 0) conn.waiters.splice(idx, 1);
      reject(new Error(`no message in ${timeoutMs}ms`));
    }, timeoutMs);
    const waiter = (frame: WsFrame): void => {
      clearTimeout(t);
      resolve(frame);
    };
    conn.waiters.push(waiter);
  });
}

/** Drain until a frame with the given `type` arrives. */
async function receiveType(conn: Conn, type: string, timeoutMs: number): Promise<WsFrame> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`no message of type ${type} within ${timeoutMs}ms`);
    const frame = await receive(conn, remaining);
    if (frame.type === type) return frame;
  }
}

describe('WS gateway handshake + heartbeat (W5.1)', () => {
  it('sends server_hello on connect and acks client_hello', async () => {
    const r = await spawn();
    const conn = await openConn(wsUrl(r.address));

    const hello = await receiveType(conn, 'server_hello', 1000);
    const helloPayload = hello.payload as {
      heartbeat_ms: number;
      max_event_buffer_size: number;
      protocol_version: number;
    };
    expect(helloPayload.heartbeat_ms).toBe(60);
    expect(helloPayload.max_event_buffer_size).toBe(1000);
    expect(helloPayload.protocol_version).toBe(WS_PROTOCOL_VERSION);

    conn.ws.send(
      JSON.stringify({
        type: 'client_hello',
        id: 'cli_test_1',
        payload: {
          client_id: 'cli_1',
          protocol_version: WS_PROTOCOL_VERSION,
          subscriptions: [],
        },
      }),
    );

    const ack = await receiveType(conn, 'ack', 1000);
    expect(ack.id).toBe('cli_test_1');
    expect(ack.code).toBe(0);

    // The registry should now have exactly one attached connection.
    r.services.invokeFunction((a) => {
      expect(a.get(IConnectionRegistry).size()).toBe(1);
      expect(a.get(IWSGateway).size).toBe(1);
    });

    conn.ws.close();
    await conn.closed;
  });

  it('sends ping after pingIntervalMs', async () => {
    const r = await spawn();
    const conn = await openConn(wsUrl(r.address));

    await receiveType(conn, 'server_hello', 1000);
    // First ping should land within ~pingIntervalMs (=60ms). Give 5x slack.
    const ping = await receiveType(conn, 'ping', 600);
    const pingPayload = ping.payload as { nonce: string };
    expect(pingPayload.nonce).toMatch(/^[0-9A-Z]{26}$/);

    conn.ws.close();
    await conn.closed;
  });

  it('pong from client keeps the connection alive past pongTimeout', async () => {
    const r = await spawn();
    const conn = await openConn(wsUrl(r.address));
    await receiveType(conn, 'server_hello', 1000);

    conn.ws.send(
      JSON.stringify({
        type: 'client_hello',
        id: 'cli_pong',
        payload: {
          client_id: 'cli_pong',
          protocol_version: WS_PROTOCOL_VERSION,
          subscriptions: [],
        },
      }),
    );
    await receiveType(conn, 'ack', 1_000);

    const ping = await receiveType(conn, 'ping', 600);
    const nonce = (ping.payload as { nonce: string }).nonce;
    conn.ws.send(JSON.stringify({ type: 'pong', payload: { nonce } }));

    // Wait > pongTimeoutMs (200ms) — without the pong reset above we'd be
    // terminated. Assert by observing the next ping arrives normally.
    const nextPing = await receiveType(conn, 'ping', 600);
    expect(nextPing.type).toBe('ping');
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);

    conn.ws.close();
    await conn.closed;
  });

  it('server close sends WS close code 1001 to attached clients', async () => {
    const r = await spawn();
    const conn = await openConn(wsUrl(r.address));
    await receiveType(conn, 'server_hello', 1000);

    await r.close();

    const { code } = await conn.closed;
    expect(code).toBe(1001);
  });

  it('non-/api/v1/ws upgrade requests are rejected', async () => {
    const r = await spawn();
    const badUrl = r.address.replace(/^http:\/\//, 'ws://') + '/api/v1/other';
    await expect(openConn(badUrl)).rejects.toBeInstanceOf(Error);
  });

  it.each([
    ['missing', undefined],
    ['non-numeric', '3'],
    ['older', WS_PROTOCOL_VERSION - 1],
    ['newer', WS_PROTOCOL_VERSION + 1],
  ])('acks and closes a %s client protocol version mismatch', async (_label, protocolVersion) => {
    const r = await spawn();
    const conn = await openConn(wsUrl(r.address));
    await receiveType(conn, 'server_hello', 1_000);
    const payload: Record<string, unknown> = {
      client_id: 'version-mismatch-client',
      subscriptions: ['sid_version_mismatch'],
    };
    if (protocolVersion !== undefined) payload['protocol_version'] = protocolVersion;

    conn.ws.send(
      JSON.stringify({ type: 'client_hello', id: 'hello-version-mismatch', payload }),
    );

    const ack = await receiveType(conn, 'ack', 1_000);
    expect(clientHelloAckMessageSchema.safeParse(ack).success).toBe(true);
    expect(ack).toMatchObject({
      id: 'hello-version-mismatch',
      code: ErrorCode.PROTOCOL_VERSION_MISMATCH,
      msg: 'protocol.version_mismatch',
      payload: { accepted_subscriptions: [], resync_required: [] },
    });
    const closed = await conn.closed;
    expect(closed).toMatchObject({ code: 1002, reason: 'protocol.version_mismatch' });
    const ackIndex = conn.timeline.findIndex(
      (entry) =>
        entry.kind === 'frame' &&
        (JSON.parse(entry.raw) as WsFrame).type === 'ack' &&
        (JSON.parse(entry.raw) as WsFrame).id === 'hello-version-mismatch',
    );
    const closeIndex = conn.timeline.findIndex((entry) => entry.kind === 'close');
    expect(ackIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeGreaterThan(ackIndex);
    await waitForCondition(() =>
      r.services.invokeFunction((accessor) => accessor.get(IConnectionRegistry).size()) === 0,
    );
  });

  it('refuses a hello subscription to a poisoned journal without an ack or registration', async () => {
    const sessionId = 'sid_poisoned_hello';
    writeEmptyJournal(sessionId);
    const r = await spawn();
    await poisonJournal(r, sessionId);
    const conn = await openConn(wsUrl(r.address));
    await receiveType(conn, 'server_hello', 1_000);

    conn.ws.send(
      JSON.stringify({
        type: 'client_hello',
        id: 'hello-poisoned',
        payload: {
          client_id: 'poisoned-hello-client',
          protocol_version: WS_PROTOCOL_VERSION,
          subscriptions: [sessionId],
        },
      }),
    );

    await waitForCondition(
      () =>
        conn.timeline.some(
          (entry) =>
            entry.kind === 'frame' &&
            (JSON.parse(entry.raw) as WsFrame).type === 'ack' &&
            (JSON.parse(entry.raw) as WsFrame).id === 'hello-poisoned',
        ) || conn.timeline.some((entry) => entry.kind === 'close'),
    );
    expect(
      conn.timeline.some(
        (entry) =>
          entry.kind === 'frame' &&
          (JSON.parse(entry.raw) as WsFrame).type === 'ack' &&
          (JSON.parse(entry.raw) as WsFrame).id === 'hello-poisoned' &&
          (JSON.parse(entry.raw) as WsFrame).code === 0,
      ),
    ).toBe(false);
    expect(
      r.services.invokeFunction((accessor) =>
        accessor.get(ISessionClientsService).subscriberCount(sessionId),
      ),
    ).toBe(0);
    await expect(conn.closed).resolves.toMatchObject({ code: 1002 });
  });

  it('refuses ordinary subscribe to a poisoned journal without an ack or registration', async () => {
    const sessionId = 'sid_poisoned_subscribe';
    writeEmptyJournal(sessionId);
    const r = await spawn();
    await poisonJournal(r, sessionId);
    const conn = await openConn(wsUrl(r.address));
    await receiveType(conn, 'server_hello', 1_000);

    conn.ws.send(
      JSON.stringify({
        type: 'client_hello',
        id: 'hello-ready',
        payload: {
          client_id: 'poisoned-subscribe-client',
          protocol_version: WS_PROTOCOL_VERSION,
          subscriptions: [],
        },
      }),
    );
    await receiveType(conn, 'ack', 1_000);

    conn.ws.send(
      JSON.stringify({
        type: 'subscribe',
        id: 'subscribe-poisoned',
        payload: { session_ids: [sessionId] },
      }),
    );

    await expect(receiveType(conn, 'ack', 120)).rejects.toBeInstanceOf(Error);
    expect(
      conn.timeline.some(
        (entry) =>
          entry.kind === 'frame' &&
          (JSON.parse(entry.raw) as WsFrame).type === 'ack' &&
          (JSON.parse(entry.raw) as WsFrame).id === 'subscribe-poisoned' &&
          (JSON.parse(entry.raw) as WsFrame).code === 0,
      ),
    ).toBe(false);
    expect(
      r.services.invokeFunction((accessor) =>
        accessor.get(ISessionClientsService).subscriberCount(sessionId),
      ),
    ).toBe(0);
    expect(conn.ws.readyState).toBe(WebSocket.OPEN);
    conn.ws.close();
    await conn.closed;
  });

  it.each([
    {
      label: 'an id-bearing control',
      frame: { type: 'subscribe', id: 'early-subscribe', payload: { session_ids: ['sid_early'] } },
    },
    { label: 'an id-less pong', frame: { type: 'pong', payload: { nonce: 'nonce_early' } } },
  ])('closes %s before client_hello without dispatching it', async ({ frame }) => {
    const r = await spawn();
    const conn = await openConn(wsUrl(r.address));
    await receiveType(conn, 'server_hello', 1_000);

    conn.ws.send(JSON.stringify(frame));

    await expect(conn.closed).resolves.toMatchObject({ code: 1002 });
    expect(
      conn.timeline.some(
        (entry) =>
          entry.kind === 'frame' &&
          (JSON.parse(entry.raw) as WsFrame).type === 'ack' &&
          (JSON.parse(entry.raw) as WsFrame).id === (frame as WsFrame).id,
      ),
    ).toBe(false);
    await waitForCondition(() =>
      r.services.invokeFunction((accessor) => accessor.get(IConnectionRegistry).size()) === 0,
    );
  });

  it('does not commit hello subscriptions until its success ack write completes', async () => {
    const { socket, connection, sessionClients } = createDelayedConnection();
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'client_hello',
          id: 'hello-delayed',
          payload: {
            client_id: 'delayed-client',
            protocol_version: WS_PROTOCOL_VERSION,
            subscriptions: ['sid_delayed'],
          },
        }),
      ),
    );

    await waitForCondition(() => socket.sent.some((entry) => entry.frame.type === 'ack'));
    expect(connection.hasClientHello).toBe(false);
    expect([...connection.subscriptions]).toEqual([]);
    expect(sessionClients.subscribed).toEqual([]);

    socket.releaseAck();
    await waitForCondition(() => connection.hasClientHello);
    expect([...connection.subscriptions]).toEqual(['sid_delayed']);
    expect(sessionClients.subscribed).toEqual(['sid_delayed']);
    connection.close();
  });

  it.each([
    {
      label: 'a duplicate hello',
      frame: {
        type: 'client_hello',
        id: 'hello-duplicate',
        payload: { client_id: 'duplicate', protocol_version: WS_PROTOCOL_VERSION, subscriptions: [] },
      },
    },
    {
      label: 'an ordinary control',
      frame: { type: 'subscribe', id: 'subscribe-early', payload: { session_ids: ['sid_early'] } },
    },
  ])('closes %s received while the first hello ack is pending', async ({ frame }) => {
    const { socket, connection, sessionClients } = createDelayedConnection();
    socket.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'client_hello',
          id: 'hello-first',
          payload: {
            client_id: 'first-client',
            protocol_version: WS_PROTOCOL_VERSION,
            subscriptions: ['sid_first'],
          },
        }),
      ),
    );
    await waitForCondition(() => socket.sent.some((entry) => entry.frame.type === 'ack'));

    socket.emit('message', Buffer.from(JSON.stringify(frame)));

    expect(socket.closeArgs?.code).toBe(1002);
    expect(connection.hasClientHello).toBe(false);
    expect([...connection.subscriptions]).toEqual([]);
    expect(sessionClients.subscribed).toEqual([]);
    socket.releaseAck();
  });
});

async function waitForCount(
  counts: readonly number[],
  target: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (counts.includes(target)) return;
    await new Promise((res) => {
      setTimeout(res, 10);
    });
  }
  throw new Error(`count ${String(target)} not observed; got ${JSON.stringify(counts)}`);
}

describe('WS gateway connection-count observer', () => {
  it('reports size 1 after a connect and size 0 after the last disconnect', async () => {
    const counts: number[] = [];
    const r = await startServer({
      host: '127.0.0.1',
      port: 0,
      lockPath,
      logger: pino({ level: 'silent' }),
      coreProcessOptions: { homeDir: bridgeHome },
      wsGatewayOptions: {
        pingIntervalMs: 60,
        pongTimeoutMs: 200,
        onConnectionCountChange: (size) => {
          counts.push(size);
        },
      },
    });
    running.push(r);

    const conn = await openConn(wsUrl(r.address));
    await receiveType(conn, 'server_hello', 1000);
    await waitForCount(counts, 1, 1000);

    conn.ws.close();
    await conn.closed;
    await waitForCount(counts, 0, 1000);

    expect(counts.at(-1)).toBe(0);
  });

  it('tracks multiple concurrent connections independently', async () => {
    const counts: number[] = [];
    const r = await startServer({
      host: '127.0.0.1',
      port: 0,
      lockPath,
      logger: pino({ level: 'silent' }),
      coreProcessOptions: { homeDir: bridgeHome },
      wsGatewayOptions: {
        pingIntervalMs: 60,
        pongTimeoutMs: 200,
        onConnectionCountChange: (size) => {
          counts.push(size);
        },
      },
    });
    running.push(r);

    const a = await openConn(wsUrl(r.address));
    await receiveType(a, 'server_hello', 1000);
    const b = await openConn(wsUrl(r.address));
    await receiveType(b, 'server_hello', 1000);
    await waitForCount(counts, 2, 1000);

    a.ws.close();
    await a.closed;
    await waitForCount(counts, 1, 1000);

    b.ws.close();
    await b.closed;
    await waitForCount(counts, 0, 1000);

    expect(counts).toEqual([1, 2, 1, 0]);
  });
});

describe('WS gateway telemetry (ws_connected / ws_disconnected)', () => {
  it('emits ws_connected on connect and ws_disconnected on close', async () => {
    const records: TelemetryRecord[] = [];
    const r = await startServer({
      host: '127.0.0.1',
      port: 0,
      lockPath,
      logger: pino({ level: 'silent' }),
      coreProcessOptions: { homeDir: bridgeHome },
      wsGatewayOptions: {
        pingIntervalMs: 60,
        pongTimeoutMs: 200,
        telemetry: recordingTelemetry(records),
      },
    });
    running.push(r);

    const conn = await openConn(wsUrl(r.address));
    await receiveType(conn, 'server_hello', 1000);

    const connected = await waitForEvent(records, 'ws_connected', 1000);
    expect(connected.properties).toMatchObject({
      connection_id: expect.any(String),
      connection_count: 1,
    });

    conn.ws.close();
    await conn.closed;

    const disconnected = await waitForEvent(records, 'ws_disconnected', 1000);
    expect(disconnected.properties).toMatchObject({
      connection_id: expect.any(String),
      connection_count: 0,
      duration_ms: expect.any(Number),
    });
  });
});
