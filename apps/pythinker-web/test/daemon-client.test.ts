// apps/pythinker-web/test/daemon-client.test.ts
// DaemonPythinkerWebApi public REST adapter: session export binary/error contracts,
// getSessionGoal wire → app mapping, and raw stream-coordinate delivery.
// Wiring: real client/projector; fetch or WebSocket is stubbed at the network boundary.
// Run: pnpm --filter @pymodel/pythinker-web exec vitest run test/daemon-client.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonPythinkerWebApi } from '../src/api/daemon/client';
import { DaemonApiError, DaemonNetworkError } from '../src/api/errors';
import { clearTrace, traceToJsonl } from '../src/debug/trace';
import type { AppEvent, PythinkerEventConnection, PythinkerEventMeta } from '../src/api/types';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly OPEN = FakeWebSocket.OPEN;
  readyState = FakeWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event?: CloseEvent) => void) | null = null;

  constructor(_url: string, _protocols?: string | string[]) {
    FakeWebSocket.instances.push(this);
  }

  send(_data: string): void {}

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  emit(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
}

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, msg: '', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const WIRE_GOAL = {
  goalId: 'goal_1',
  objective: 'fix all lint warnings',
  status: 'active',
  turnsUsed: 1,
  tokensUsed: 0,
  wallClockMs: 0,
  budget: {
    tokenBudget: null,
    turnBudget: null,
    wallClockBudgetMs: null,
    remainingTokens: null,
    remainingTurns: null,
    remainingWallClockMs: null,
    tokenBudgetReached: false,
    turnBudgetReached: false,
    wallClockBudgetReached: false,
    overBudget: false,
  },
};

const WIRE_EXPERT_TALK_STATUS = {
  schema_version: 1,
  feature: 'enabled' as const,
  resource_version: '7',
  config: {
    fusion_lead_model_id: 'provider/lead',
    peer_model_id: 'provider/peer',
  },
  activation: { state: 'armed' as const, arm_id: 'arm_1' },
  active_run_id: 'run_1',
  pair_validation: { state: 'valid' as const },
};

const WIRE_EXPERT_TALK_RUN = {
  schema_version: 1 as const,
  run_id: 'run_1',
  session_id: 'sess_1',
  turn_id: 1,
  prompt_id: 'prompt_1',
  state: 'running' as const,
  stage: 'review' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:01.000Z',
  bindings: {
    fusion_lead: { requested_model_id: 'provider/lead', effective_model_id: 'provider/lead' },
    peer: { requested_model_id: 'provider/peer', effective_model_id: 'provider/peer' },
  },
  opening: {
    lead: {
      role: 'fusion_lead' as const,
      stage: 'opening' as const,
      state: 'completed' as const,
      partial: false,
      text: 'Lead opening',
      started_at: '2026-01-01T00:00:00.000Z',
      ended_at: '2026-01-01T00:00:02.000Z',
      usage: { input_other: 1024, output: 600, input_cache_read: 512, input_cache_creation: 0 },
      request_count: 1,
      provider_attempt_count: 1,
      tool_call_count: 2,
      tool_result_tokens: 64,
    },
    peer: { role: 'peer' as const, stage: 'opening' as const, state: 'completed' as const, partial: false, text: 'Peer opening' },
  },
  review: {
    lead: { role: 'fusion_lead' as const, stage: 'review' as const, state: 'running' as const, partial: true, text: 'Lead review' },
    peer: { role: 'peer' as const, stage: 'review' as const, state: 'pending' as const, partial: false },
  },
  usage: { complete: false, request_count: 3, provider_attempt_count: 3 },
  revision: 4,
};

function createApi(): DaemonPythinkerWebApi {
  return new DaemonPythinkerWebApi({
    serverHttpUrl: 'http://daemon.test',
    clientId: 'web_test',
    clientName: 'test',
    clientVersion: '0.0.0',
    clientUiMode: 'test',
  });
}

describe('DaemonPythinkerWebApi.listSessionGroupsV2', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the v2 grouped route and maps its session summary', async () => {
    vi.stubGlobal('location', { search: '?debug=1' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        envelope({
          groups: [
            {
              workspace: { id: 'ws_1', cwd: '/repo' },
              sessions: [
                {
                  id: 'sess_1',
                  workspace: { id: 'ws_1', cwd: '/repo' },
                  meta: {
                    title: null,
                    last_prompt: 'Fix startup',
                    created_at: Date.parse('2026-08-01T00:00:00.000Z'),
                    updated_at: Date.parse('2026-08-02T00:00:00.000Z'),
                    archived: false,
                    archived_at: null,
                  },
                  activity: { status: 'approval', model: 'test/model' },
                },
              ],
              total: 7,
            },
          ],
          total: 1,
          has_more: true,
          next_page_token: 'next',
        }),
      ),
    );

    const page = await createApi().listSessionGroupsV2({
      groupPageSize: 5,
      hasPrompt: true,
      pageToken: 'cursor',
    });

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v2/sessions?view=by_workspace&group.page_size=5&meta.has_prompt=true&page_token=cursor',
    );
    expect(page).toMatchObject({
      hasMore: true,
      nextPageToken: 'next',
      groups: [
        {
          total: 7,
          sessions: [
            {
              id: 'sess_1',
              title: 'Fix startup',
              pendingInteraction: 'approval',
              cwd: '/repo',
              model: 'test/model',
            },
          ],
        },
      ],
    });
  });
});

describe('DaemonPythinkerWebApi.exportSession', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { search: '?debug=1' });
    vi.stubGlobal('fetch', vi.fn());
    clearTrace();
  });

  afterEach(() => {
    clearTrace();
    vi.unstubAllGlobals();
  });

  it('posts the Web log to the encoded session export endpoint and returns the ZIP', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([80, 75, 3, 4]), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="session-export.zip"',
        },
      }),
    );

    const result = await createApi().exportSession('sess/1', '{"event":"safe"}');

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/sessions/sess%2F1/export',
    );
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ web_log: '{"event":"safe"}' }),
    });
    expect(result.fileName).toBe('session-export.zip');
    expect(result.blob.size).toBe(4);
  });

  it('falls back to a session-id ZIP name for an unsafe response filename', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([80, 75]), {
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="../credentials.zip"',
        },
      }),
    );

    const result = await createApi().exportSession('sess_1');

    expect(result.fileName).toBe('sess_1.zip');
  });

  it('parses a JSON error envelope returned by the export endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ code: 41301, msg: 'export too large', request_id: 'req_server' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const caught = await createApi()
      .exportSession('sess_1', 'log')
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(DaemonApiError);
    expect(caught).toMatchObject({ code: 41301, requestId: 'req_server' });
  });

  it('rejects a successful response whose media type is not a ZIP', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('not a zip', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    const caught = await createApi().exportSession('sess_1').catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(DaemonNetworkError);
    expect(caught).toMatchObject({ phase: 'parse', contentType: 'text/plain' });
  });

  it('records only Web-log counts in the request trace', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([80, 75]), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      }),
    );
    const secret = 'PROMPT_CONTENT_MUST_NOT_ENTER_TRACE';

    await createApi().exportSession('sess_1', `${secret}\nsecond line`);

    const trace = traceToJsonl();
    expect(trace).not.toContain(secret);
    expect(trace).toContain('web_log_bytes');
    expect(trace).toContain('web_log_entries');
  });
});

describe('DaemonPythinkerWebApi.getSessionGoal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a present goal snapshot', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope(WIRE_GOAL));
    const goal = await createApi().getSessionGoal('sess_1');
    expect(goal?.objective).toBe('fix all lint warnings');
    expect(goal?.status).toBe('active');
    expect(goal?.turnsUsed).toBe(1);
  });

  it('maps null to null (no active goal)', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope(null));
    const goal = await createApi().getSessionGoal('sess_1');
    expect(goal).toBeNull();
  });

  it('requests the session goal endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(envelope(null));
    await createApi().getSessionGoal('sess_42');
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(
      'http://daemon.test/api/v1/sessions/sess_42/goal',
    );
  });
});

describe('DaemonPythinkerWebApi Expert Talk', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps status and configures the ordered pair with CAS', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(envelope(WIRE_EXPERT_TALK_STATUS))
      .mockResolvedValueOnce(envelope(WIRE_EXPERT_TALK_STATUS))
      .mockResolvedValueOnce(envelope(WIRE_EXPERT_TALK_STATUS));
    const api = createApi();

    const status = await api.getExpertTalkStatus('sess_1');
    await api.configureExpertTalk(
      'sess_1',
      { fusionLeadModelId: 'provider/lead', peerModelId: 'provider/peer' },
      status.resourceVersion,
    );
    await api.armExpertTalk('sess_1', status.resourceVersion);

    expect(status.activation.armId).toBe('arm_1');
    expect(status.config?.fusionLeadModelId).toBe('provider/lead');
    const [url, init] = vi.mocked(fetch).mock.calls[1]!;
    expect(url).toBe('http://daemon.test/api/v1/sessions/sess_1/expert-talk');
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('If-Match')).toBe('"7"');
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(body)).toEqual({
      fusion_lead_model_id: 'provider/lead',
      peer_model_id: 'provider/peer',
    });
    const [armUrl, armInit] = vi.mocked(fetch).mock.calls[2]!;
    expect(armUrl).toBe('http://daemon.test/api/v1/sessions/sess_1/expert-talk:arm');
    expect(armInit?.method).toBe('POST');
    expect(new Headers(armInit?.headers).get('If-Match')).toBe('"7"');
  });

  it('maps a run and sends the owned arm with the prompt', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(envelope(WIRE_EXPERT_TALK_RUN))
      .mockResolvedValueOnce(envelope({
        prompt_id: 'prompt_1',
        user_message_id: 'prompt_1',
        status: 'running',
        expert_talk_run_id: 'run_1',
      }));
    const api = createApi();

    const run = await api.getExpertTalkRun('sess_1', 'run_1');
    const accepted = await api.submitPrompt('sess_1', {
      content: [{ type: 'text', text: 'Compare' }],
      expertTalkArmId: 'arm_1',
    });

    expect(run.stage).toBe('review');
    expect(run.opening.peer.text).toBe('Peer opening');
    expect(run.review.peer.state).toBe('pending');
    expect(run.opening.lead).toMatchObject({
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:02.000Z',
      usage: { inputOther: 1024, output: 600, inputCacheRead: 512, inputCacheCreation: 0 },
      requestCount: 1,
      providerAttemptCount: 1,
      toolCallCount: 2,
      toolResultTokens: 64,
    });
    expect(run.turnId).toBe(1);
    expect(accepted.expertTalkRunId).toBe('run_1');
    const [, init] = vi.mocked(fetch).mock.calls[1]!;
    const body = init?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    expect(JSON.parse(body)).toMatchObject({ expert_talk_arm_id: 'arm_1' });
  });

  it('maps paginated runs and sends the cursor and limit', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(envelope({
      runs: [WIRE_EXPERT_TALK_RUN],
      next_cursor: 'run_1',
    }));
    const api = createApi();

    const page = await api.listExpertTalkRuns('sess_1', { cursor: 'run_2', limit: 1 });

    expect(page.runs).toHaveLength(1);
    expect(page.nextCursor).toBe('run_1');
    const [rawUrl] = vi.mocked(fetch).mock.calls[0]!;
    if (typeof rawUrl !== 'string') throw new TypeError('expected a string URL');
    const url = new URL(rawUrl);
    expect(url.pathname).toBe('/api/v1/sessions/sess_1/expert-talk/runs');
    expect(Object.fromEntries(url.searchParams)).toEqual({ cursor: 'run_2', limit: '1' });
  });
});

describe('DaemonPythinkerWebApi.connectEvents', () => {
  let connection: PythinkerEventConnection | undefined;

  afterEach(() => {
    connection?.close();
    connection = undefined;
    vi.unstubAllGlobals();
  });

  it('delivers raw assistant stream coordinates with the projected delta', () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    const received: Array<{ event: AppEvent; meta: PythinkerEventMeta }> = [];
    connection = createApi().connectEvents({
      onEvent(event, meta) {
        received.push({ event, meta });
      },
      onResync() {},
      onError() {},
      onConnectionChange() {},
    });
    const socket = FakeWebSocket.instances[0]!;

    socket.emit({ type: 'server_hello', payload: { protocol_version: 2 } });
    socket.emit({
      type: 'turn.started',
      seq: 1,
      session_id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { agentId: 'main', turnId: 7 },
    });
    socket.emit({
      type: 'turn.step.started',
      seq: 2,
      session_id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { agentId: 'main', turnId: 7, step: 1 },
    });
    socket.emit({
      type: 'assistant.delta',
      seq: 2,
      session_id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      volatile: true,
      offset: 0,
      payload: { agentId: 'main', turnId: 7, delta: 'hello' },
    });
    socket.emit({
      type: 'thinking.delta',
      seq: 2,
      session_id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      volatile: true,
      offset: 0,
      payload: { agentId: 'main', turnId: 7, delta: 'thought' },
    });

    const delta = received.find(({ event }) => event.type === 'assistantDelta');
    expect(delta).toMatchObject({
      event: {
        type: 'assistantDelta',
        sessionId: 'session-1',
        delta: { text: 'hello' },
      },
      meta: {
        sessionId: 'session-1',
        seq: 2,
        stream: { turnId: 7, offset: 0, kind: 'text' },
      },
    });

    const thinking = received.find(
      ({ event }) => event.type === 'assistantDelta' && event.delta.thinking !== undefined,
    );
    expect(thinking).toMatchObject({
      event: {
        type: 'assistantDelta',
        sessionId: 'session-1',
        delta: { thinking: 'thought' },
      },
      meta: {
        sessionId: 'session-1',
        seq: 2,
        stream: { turnId: 7, offset: 0, kind: 'thinking' },
      },
    });
  });

  it('projects the opted-in Expert Talk status event', () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    const received: AppEvent[] = [];
    connection = createApi().connectEvents({
      onEvent(event) {
        received.push(event);
      },
      onResync() {},
      onError() {},
      onConnectionChange() {},
    });
    const socket = FakeWebSocket.instances[0]!;

    socket.emit({ type: 'server_hello', payload: { protocol_version: 2 } });
    socket.emit({
      type: 'expert_talk.changed',
      seq: 8,
      session_id: 'sess_1',
      timestamp: '2026-01-01T00:00:00.000Z',
      volatile: true,
      payload: { type: 'expert_talk.changed', status: WIRE_EXPERT_TALK_STATUS },
    });

    expect(received).toContainEqual({
      type: 'expertTalkChanged',
      sessionId: 'sess_1',
      status: expect.objectContaining({ activeRunId: 'run_1' }),
    });
  });

  it('projects list-level work facts from the global session event', () => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    const received: AppEvent[] = [];
    connection = createApi().connectEvents({
      onEvent(event) {
        received.push(event);
      },
      onResync() {},
      onError() {},
      onConnectionChange() {},
    });
    const [socket] = FakeWebSocket.instances;
    if (socket === undefined) throw new Error('WebSocket was not created');

    socket.emit({ type: 'server_hello', payload: { protocol_version: 2 } });
    socket.emit({
      type: 'event.session.work_changed',
      seq: 1,
      session_id: 'session-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: {
        busy: true,
        main_turn_active: false,
        pending_interaction: 'question',
      },
    });

    expect(received).toContainEqual({
      type: 'sessionWorkChanged',
      sessionId: 'session-1',
      busy: true,
      mainTurnActive: false,
      pendingInteraction: 'question',
      lastTurnReason: undefined,
    });
  });
});
