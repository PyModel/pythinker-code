import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transcriptResponseSchema } from '@pymodel/transcript';

import { ErrorCode } from '../src/protocol/error-codes';
import {
  expertTalkRunListSchema,
  expertTalkRunSchema,
  expertTalkStatusSchema,
} from '../src/protocol/rest-expert-talk';
import { type RunningServer, startServer } from '../src/start';
import { authedFetch } from './helpers/auth';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';

interface Envelope<T> {
  code: number;
  data: T;
}

interface MockRequest {
  readonly model: string;
  readonly body: string;
}

interface MockLlm {
  readonly port: number;
  readonly requests: MockRequest[];
  close(): Promise<void>;
}

const FUSION_MARKDOWN = [
  '## Recommendation',
  '',
  'Fused answer from Expert Talk.',
  '',
  '## Consensus & Divergence',
  '',
  '- Consensus: both experts agree.',
].join('\n');
const FUSION_RESULT = JSON.stringify({
  version: 'expert_talk_result/v1',
  answer: FUSION_MARKDOWN,
  notes: {
    consensus: ['Both experts agree.'],
    divergence: [],
    uncertainty: [],
    attribution: [{ role: 'fusion_lead', stage: 'review', claim: 'Use the shared resolver.' }],
  },
});

function sseText(text: string, completionTokens = 4): string {
  const events = [
    {
      id: 'chatcmpl-expert-talk',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'mock',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-expert-talk',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'mock',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: completionTokens,
        total_tokens: 10 + completionTokens,
      },
    },
  ];
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
}

function sseToolCall(id: string, name: string, args: string): string {
  const events = [
    {
      id: 'chatcmpl-expert-talk',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'mock',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: args } }],
        },
        finish_reason: null,
      }],
    },
    {
      id: 'chatcmpl-expert-talk',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'mock',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
    },
  ];
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
}

async function startMockLlm(): Promise<MockLlm> {
  const requests: MockRequest[] = [];
  const mock: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(body) as {
        model?: unknown;
        messages?: readonly { role?: unknown }[];
      };
      const model = typeof parsed.model === 'string' ? parsed.model : 'unknown';
      requests.push({ model, body });

      if (body.includes('Wait until cancellation.')) {
        await new Promise<void>((resolve) => {
          req.once('aborted', resolve);
          res.once('close', resolve);
        });
        return;
      }

      if (
        body.includes('Provider stream stalls.')
        && body.includes('EXPERT TALK OPENING CONTRACT')
      ) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
        await new Promise<void>((resolve) => {
          req.once('aborted', resolve);
          res.once('close', resolve);
        });
        return;
      }

      if (
        model === 'lead'
        && body.includes('One opening fails.')
        && body.includes('EXPERT TALK OPENING CONTRACT')
      ) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sseToolCall('call_write', 'Write', JSON.stringify({ path: 'forbidden.txt' })));
        return;
      }

      const isOpening = body.includes('EXPERT TALK OPENING CONTRACT');
      const isReview = body.includes('REVIEW OF') && body.includes('CONTRACT');
      const isFusion = body.includes('EXPERT TALK FUSION CONTRACT');
      const isFusionRepair = body.includes('EXPERT TALK FUSION REPAIR CONTRACT');
      if (
        isReview
        && (body.includes('Both reviews fail.')
          || (model === 'peer' && body.includes('One review fails.')))
      ) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sseToolCall('call_write_review', 'Write', JSON.stringify({ path: 'forbidden.txt' })));
        return;
      }
      if (
        isFusion
        && body.includes('Fusion returns malformed output.')
        && (!isFusionRepair || body.includes('Fusion repair also fails.'))
      ) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sseText('not a typed fusion result'));
        return;
      }
      if (
        model === 'lead'
        && isOpening
        && body.includes('Exhaust opening retries.')
      ) {
        res.writeHead(429, {
          'content-type': 'application/json',
          'retry-after': '0',
        });
        res.end(JSON.stringify({ error: { message: 'retry opening', type: 'rate_limit_error' } }));
        return;
      }
      if (
        model === 'lead'
        && isOpening
        && body.includes('Retry one opening.')
        && requests.filter((request) =>
          request.model === 'lead'
          && request.body.includes('Retry one opening.')
          && request.body.includes('EXPERT TALK OPENING CONTRACT')
        ).length === 1
      ) {
        res.writeHead(429, {
          'content-type': 'application/json',
          'retry-after': '0',
        });
        res.end(JSON.stringify({ error: { message: 'retry opening', type: 'rate_limit_error' } }));
        return;
      }

      const toolResults = parsed.messages?.filter((message) => message.role === 'tool').length ?? 0;
      if (body.includes('Stream live progress.') && body.includes('EXPERT TALK OPENING CONTRACT')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-live-discussion',
          object: 'chat.completion.chunk',
          created: 1,
          model,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: `${model} reasoning.`,
              content: `${model} draft.`,
            },
            finish_reason: null,
          }],
        })}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, 50));
        res.end(sseText(`${model} final.`));
        return;
      }
      if (
        model === 'peer'
        && body.includes('Use eight read-only tool calls before answering.')
        && toolResults < 8
      ) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sseToolCall(
          `call_read_${String(toolResults + 1)}`,
          'Read',
          JSON.stringify({ path: 'expert-opinion-fixture.txt' }),
        ));
        return;
      }

      let text = model === 'lead' ? 'Lead opening marker.' : 'Peer opening marker.';
      if (model === 'peer' && body.includes('Use eight read-only tool calls before answering.')) {
        text = 'Peer opening after eight reads.';
      }
      if (body.includes('REVIEW OF') && body.includes('CONTRACT')) {
        text = `${model} review marker.`;
      }
      if (isFusion) {
        text = FUSION_RESULT;
      }
      if (body.includes('Visible answer exceeds the cap.')) {
        text = 'Visible output '.repeat(10_000);
      }

      const completionTokens = body.includes('Provider reports overflow.') ? 4_943 : 4;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sseText(text, completionTokens));
    })();
  });
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const address = mock.address();
  if (address === null || typeof address !== 'object') throw new Error('mock LLM did not bind');
  return {
    port: address.port,
    requests,
    close: () => new Promise<void>((resolve) => mock.close(() => {
      resolve();
    })),
  };
}

function modelsToml(port: number): string {
  return [
  'default_model = "acme/lead"',
  '',
  '[providers.acme]',
  'type = "openai"',
  'api_key = "YOUR_API_KEY"',
  `base_url = "http://127.0.0.1:${String(port)}/v1"`,
  '',
  '[models."acme/lead"]',
  'provider = "acme"',
  'model = "lead"',
  'max_context_size = 100000',
  'capabilities = ["tool_use", "thinking"]',
  'support_efforts = ["low", "high", "max"]',
  'default_effort = "high"',
  '',
  '[models."acme/peer"]',
  'provider = "acme"',
  'model = "peer"',
  'max_context_size = 100000',
  'capabilities = ["tool_use", "thinking"]',
  'support_efforts = ["low", "high", "max"]',
  'default_effort = "high"',
  '',
  '[secondary_model]',
  'default_model = "acme/peer"',
  '',
  '[secondary_model.models]',
  '"acme/lead" = "Fusion Lead"',
  '"acme/peer" = "Peer Expert"',
  '',
  '[llm]',
  'request_idle_timeout_ms = 100',
  '',
  ].join('\n');
}

describe('server-v2 Expert Talk', () => {
  let server: RunningServer | undefined;
  let llm: MockLlm | undefined;
  let home: string | undefined;
  let base: string;

  beforeEach(async () => {
    vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_EXPERT_TALK', '1');
    vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_SECONDARY_MODEL', '1');
    llm = await startMockLlm();
    home = await mkdtemp(join(tmpdir(), 'pythinker-expert-talk-'));
    await writeFile(join(home, 'config.toml'), modelsToml(llm.port), 'utf8');
    await writeFile(join(home, 'expert-opinion-fixture.txt'), 'fixture\n', 'utf8');
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await server?.close();
    server = undefined;
    await llm?.close();
    llm = undefined;
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  });

  async function createSession(): Promise<string> {
    const response = await authedFetch(server as RunningServer, base, '/api/v1/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { cwd: home } }),
    });
    const body = await response.json() as Envelope<{ id: string }>;
    expect(body.code).toBe(0);
    return body.data.id;
  }

  async function call<T>(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    clientId: string,
    body?: unknown,
    etag?: string,
  ): Promise<{ status: number; etag: string | null; body: Envelope<T> }> {
    const connectionId = `test-${clientId}`;
    if (server?.connectionRegistry.get(connectionId) === undefined) {
      const sessionId = path.match(/^\/api\/v1\/sessions\/([^/]+)/)?.[1];
      server?.connectionRegistry.add({
        id: connectionId,
        clientId,
        connectedAt: new Date().toISOString(),
        remoteAddress: '127.0.0.1',
        userAgent: 'test',
        hasClientHello: true,
        subscriptionSessionIds: sessionId === undefined ? [] : [decodeURIComponent(sessionId)],
        close: () => {},
      });
    }
    const response = await authedFetch(server as RunningServer, base, path, {
      method,
      headers: {
        'x-pythinker-client-id': clientId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(etag === undefined ? {} : { 'if-match': etag }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      etag: response.headers.get('etag'),
      body: await response.json() as Envelope<T>,
    };
  }

  async function startRun(
    prompt: string,
    pair: {
      fusion_lead_model_id: string;
      peer_model_id: string;
      fusion_lead_thinking_effort?: string;
      peer_thinking_effort?: string;
    } = { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
  ) {
    const sessionId = await createSession();
    const expertTalkPath = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', expertTalkPath, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      pair,
      initial.etag ?? undefined,
    );
    const armed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    expect(armed.body.code, JSON.stringify(armed.body)).toBe(0);
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: prompt }],
        expert_talk_arm_id: armId,
      },
    );
    expect(submitted.body.code, JSON.stringify(submitted.body)).toBe(0);
    const runId = submitted.body.data.expert_talk_run_id;
    expect(runId).toBeDefined();
    return {
      sessionId,
      expertTalkPath,
      runPath: `${expertTalkPath}/runs/${String(runId)}`,
      runId: String(runId),
    };
  }

  async function waitForTerminal(runPath: string) {
    let run = expertTalkRunSchema.parse(
      (await call<unknown>('GET', runPath, 'client-a')).body.data,
    );
    await vi.waitFor(async () => {
      run = expertTalkRunSchema.parse(
        (await call<unknown>('GET', runPath, 'client-a')).body.data,
      );
      expect(run.state).not.toBe('running');
    }, { timeout: 30_000, interval: 100 });
    return run;
  }

  it('configures, arms, protects the pending turn, and disarms by owner', async () => {
    const sessionId = await createSession();
    const path = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', path, 'client-a');
    const initialStatus = expertTalkStatusSchema.parse(initial.body.data);
    expect(initialStatus).toMatchObject({ feature: 'enabled', config: null });

    const configured = await call<unknown>(
      'PUT',
      path,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    const configuredStatus = expertTalkStatusSchema.parse(configured.body.data);
    expect(configuredStatus.config).toEqual({
      fusion_lead_model_id: 'acme/lead',
      peer_model_id: 'acme/peer',
    });

    const armed = await call<unknown>(
      'POST',
      `${path}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    expect(armed.body.code, JSON.stringify(armed.body)).toBe(0);
    const armedStatus = expertTalkStatusSchema.parse(armed.body.data);
    expect(armedStatus.activation.state).toBe('armed');

    const oldClientPrompt = await call<unknown>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-old',
      { content: [{ type: 'text', text: 'hello' }] },
    );
    expect(oldClientPrompt.body.code).toBe(ErrorCode.EXPERT_TALK_CLIENT_UNSUPPORTED);
    expect(expertTalkStatusSchema.parse((await call<unknown>('GET', path, 'client-a')).body.data)
      .activation.state).toBe('armed');

    const wrongOwner = await call<unknown>(
      'POST',
      `${path}:disarm`,
      'client-b',
      { arm_id: armedStatus.activation.arm_id },
    );
    expect(wrongOwner.body.code).toBe(ErrorCode.EXPERT_TALK_NOT_ARMED);

    const disarmed = await call<unknown>(
      'POST',
      `${path}:disarm`,
      'client-a',
      { arm_id: armedStatus.activation.arm_id },
    );
    expect(expertTalkStatusSchema.parse(disarmed.body.data).activation.state).toBe('idle');
  });

  it('rejects a duplicate configured pair before any run exists', async () => {
    const sessionId = await createSession();
    const response = await call<unknown>(
      'PUT',
      `/api/v1/sessions/${sessionId}/expert-talk`,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/lead' },
    );

    expect(response.body.code).toBe(ErrorCode.EXPERT_TALK_PAIR_INVALID);
  });

  it('persists supported role efforts, freezes them in bindings, and rejects unknown effort', async () => {
    const { runPath, expertTalkPath } = await startRun(
      'Use the selected effort for both experts.',
      {
        fusion_lead_model_id: 'acme/lead',
        peer_model_id: 'acme/peer',
        fusion_lead_thinking_effort: 'max',
        peer_thinking_effort: 'low',
      },
    );
    const configured = expertTalkStatusSchema.parse(
      (await call<unknown>('GET', expertTalkPath, 'client-a')).body.data,
    );
    expect(configured.config).toEqual({
      fusion_lead_model_id: 'acme/lead',
      peer_model_id: 'acme/peer',
      fusion_lead_thinking_effort: 'max',
      peer_thinking_effort: 'low',
    });

    const completed = await waitForTerminal(runPath);
    expect(completed.bindings).toMatchObject({
      fusion_lead: { thinking_effort: 'max' },
      peer: { thinking_effort: 'low' },
    });
    expect(llm?.requests.filter((request) => request.model === 'lead').every((request) =>
      (JSON.parse(request.body) as { reasoning_effort?: string }).reasoning_effort === 'max'
    )).toBe(true);
    expect(llm?.requests.filter((request) => request.model === 'peer').every((request) =>
      (JSON.parse(request.body) as { reasoning_effort?: string }).reasoning_effort === 'low'
    )).toBe(true);

    const invalid = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      {
        fusion_lead_model_id: 'acme/lead',
        peer_model_id: 'acme/peer',
        fusion_lead_thinking_effort: 'ultra',
      },
      (await call<unknown>('GET', expertTalkPath, 'client-a')).etag ?? undefined,
    );
    expect(invalid.body.code).toBe(ErrorCode.EXPERT_TALK_PAIR_INVALID);
  });

  it('keeps a configured pair valid when the subagent routing policy changes', async () => {
    const sessionId = await createSession();
    const path = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', path, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      path,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    expect(configured.body.code).toBe(0);

    const policyCleared = await authedFetch(
      server as RunningServer,
      base,
      '/api/v1/config',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secondary_model: null }),
      },
    );
    expect(policyCleared.status).toBe(200);

    const currentResponse = await call<unknown>('GET', path, 'client-a');
    const current = expertTalkStatusSchema.parse(currentResponse.body.data);
    expect(current.pair_validation).toEqual({ state: 'valid' });

    const armed = await call<unknown>(
      'POST',
      `${path}:arm`,
      'client-a',
      undefined,
      currentResponse.etag ?? undefined,
    );
    expect(armed.body.code, JSON.stringify(armed.body)).toBe(0);
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'Use the configured Discussion models.' }],
        expert_talk_arm_id: armId,
      },
    );
    expect(submitted.body.code, JSON.stringify(submitted.body)).toBe(0);
    const runId = String(submitted.body.data.expert_talk_run_id);
    expect((await waitForTerminal(`${path}/runs/${runId}`)).state).toBe('completed');
  });

  it('runs both openings, reciprocal reviews, and fusion automatically', async () => {
    const { sessionId, expertTalkPath, runPath, runId: firstRunId } = await startRun(
      'Resolve this with both experts.',
    );
    const completed = await waitForTerminal(runPath);

    expect(completed).toMatchObject({
      state: 'completed',
      stage: 'terminal',
      opening: {
        lead: { state: 'completed', text: 'Lead opening marker.' },
        peer: { state: 'completed', text: 'Peer opening marker.' },
      },
      review: {
        lead: { state: 'completed', text: 'lead review marker.' },
        peer: { state: 'completed', text: 'peer review marker.' },
      },
      fusion: { state: 'completed' },
      result: { version: 'expert_talk_result/v1', answer: FUSION_MARKDOWN },
      usage: { complete: true, request_count: 5, provider_attempt_count: 5 },
    });
    expect(llm?.requests).toHaveLength(5);
    const leadReview = llm?.requests.find((request) =>
      request.body.includes('FUSION LEAD REVIEW OF PEER EXPERT CONTRACT'));
    const peerReview = llm?.requests.find((request) =>
      request.body.includes('PEER EXPERT REVIEW OF FUSION LEAD CONTRACT'));
    expect(leadReview?.body).toContain('Peer opening marker.');
    expect(peerReview?.body).toContain('Lead opening marker.');
    expect(llm?.requests.at(-1)).toMatchObject({ model: 'lead' });
    expect(llm?.requests.at(-1)?.body).toContain('lead review marker.');
    expect(llm?.requests.at(-1)?.body).toContain('peer review marker.');
    expect(expertTalkStatusSchema.parse(
      (await call<unknown>('GET', expertTalkPath, 'client-a')).body.data,
    ).pair_validation).toEqual({ state: 'valid' });

    const transcript = transcriptResponseSchema.parse(
      (await call<unknown>(
        'GET',
        `/api/v1/sessions/${sessionId}/transcript?agent_id=main`,
        'client-a',
      )).body.data,
    );
    const turns = transcript.items.filter((item) => item.kind === 'turn');
    expect(turns).toHaveLength(1);
    expect(turns[0]?.prompt).toBe('Resolve this with both experts.');
    const transcriptText = turns.flatMap((turn) => turn.steps)
      .flatMap((step) => step.frames)
      .filter((frame) => frame.kind === 'text')
      .map((frame) => frame.text)
      .join('');
    expect(transcriptText).toContain('Fused answer from Expert Talk.');
    expect(transcriptText).not.toContain('opening marker');
    expect(transcriptText).not.toContain('review marker');

    const current = await call<unknown>('GET', expertTalkPath, 'client-a');
    const rearmed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      current.etag ?? undefined,
    );
    const secondArmId = expertTalkStatusSchema.parse(rearmed.body.data).activation.arm_id;
    const second = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'Resolve a second request.' }],
        expert_talk_arm_id: secondArmId,
      },
    );
    const secondRunId = String(second.body.data.expert_talk_run_id);
    await waitForTerminal(`${expertTalkPath}/runs/${secondRunId}`);
    const firstPage = expertTalkRunListSchema.parse(
      (await call<unknown>('GET', `${expertTalkPath}/runs?limit=1`, 'client-a')).body.data,
    );
    expect(firstPage.runs.map((run) => run.run_id)).toEqual([secondRunId]);
    expect(firstPage.next_cursor).toBe(secondRunId);
    const secondPage = expertTalkRunListSchema.parse(
      (await call<unknown>(
        'GET',
        `${expertTalkPath}/runs?cursor=${encodeURIComponent(secondRunId)}&limit=1`,
        'client-a',
      )).body.data,
    );
    expect(secondPage.runs.map((run) => run.run_id)).toEqual([firstRunId]);
    expect(secondPage.next_cursor).toBeUndefined();
  });

  it('projects live answer and thinking deltas before automatic completion', async () => {
    const { runPath } = await startRun('Stream live progress.');

    await vi.waitFor(async () => {
      const live = expertTalkRunSchema.parse(
        (await call<unknown>('GET', runPath, 'client-a')).body.data,
      );
      expect(live.opening.lead).toMatchObject({
        state: 'running',
        text: 'lead draft.',
        thinking: 'lead reasoning.',
        partial: true,
      });
    }, { timeout: 5_000, interval: 50 });

    expect((await waitForTerminal(runPath)).state).toBe('completed');
  });

  it('cancels both active opening requests', async () => {
    const { expertTalkPath, runId } = await startRun('Wait until cancellation.');
    await vi.waitFor(() => expect(llm?.requests).toHaveLength(2));

    const cancelled = await call<unknown>(
      'POST',
      `${expertTalkPath}/runs/${runId}/cancel`,
      'client-a',
    );

    expect(expertTalkRunSchema.parse(cancelled.body.data).state).toBe('cancelled');
    expect(llm?.requests).toHaveLength(2);
  });

  it('terminalizes a live run after restart even when the feature is disabled', async () => {
    const { sessionId, runPath } = await startRun('Wait until cancellation.');
    await vi.waitFor(() => expect(llm?.requests).toHaveLength(2));
    await server?.close();
    server = undefined;
    vi.stubEnv('PYTHINKER_CODE_EXPERIMENTAL_EXPERT_TALK', '0');
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;

    const recovered = expertTalkRunSchema.parse(
      (await call<unknown>('GET', runPath, 'client-a')).body.data,
    );
    expect(recovered).toMatchObject({
      state: 'interrupted',
      error: { reason: 'INTERRUPTED' },
    });
    const status = expertTalkStatusSchema.parse(
      (await call<unknown>(
        'GET',
        `/api/v1/sessions/${sessionId}/expert-talk`,
        'client-a',
      )).body.data,
    );
    expect(status.feature).toBe('disabled');
    expect(status.active_run_id).toBeUndefined();
    const transcript = transcriptResponseSchema.parse(
      (await call<unknown>(
        'GET',
        `/api/v1/sessions/${sessionId}/transcript?agent_id=main`,
        'client-a',
      )).body.data,
    );
    expect(transcript.items.find((item) => item.kind === 'turn')?.state).toBe('failed');
    expect(llm?.requests).toHaveLength(2);
  });

  it('fails when either mandatory opening fails', async () => {
    const { runPath } = await startRun('One opening fails.');
    const failed = await waitForTerminal(runPath);

    expect(failed).toMatchObject({
      state: 'failed',
      stage: 'opening',
      opening: {
        lead: { state: 'failed', error_reason: 'TOOL_NOT_ALLOWED' },
      },
      error: { reason: 'OPENING_FAILED', role: 'fusion_lead' },
    });
  });

  it('continues to fusion when one reciprocal review fails', async () => {
    const { runPath } = await startRun('One review fails.');
    const completed = await waitForTerminal(runPath);

    expect(completed).toMatchObject({
      state: 'completed',
      review: {
        lead: { state: 'completed' },
        peer: { state: 'failed', error_reason: 'TOOL_NOT_ALLOWED' },
      },
      fusion: { state: 'completed' },
      result: { version: 'expert_talk_result/v1' },
    });
    expect(llm?.requests).toHaveLength(5);
    expect(llm?.requests.at(-1)?.body).toContain('[review unavailable]');
  });

  it('stops before fusion when both reciprocal reviews fail', async () => {
    const { runPath } = await startRun('Both reviews fail.');
    const failed = await waitForTerminal(runPath);

    expect(failed).toMatchObject({
      state: 'failed',
      stage: 'review',
      review: {
        lead: { state: 'failed', error_reason: 'TOOL_NOT_ALLOWED' },
        peer: { state: 'failed', error_reason: 'TOOL_NOT_ALLOWED' },
      },
      error: { reason: 'REVIEW_FAILED' },
    });
    expect(failed.fusion).toBeUndefined();
    expect(llm?.requests).toHaveLength(4);
  });

  it('repairs one malformed fusion result within the existing request budget', async () => {
    const { runPath } = await startRun('Fusion returns malformed output.');
    const completed = await waitForTerminal(runPath);

    expect(completed).toMatchObject({
      state: 'completed',
      fusion: { state: 'completed', request_count: 2 },
      result: { version: 'expert_talk_result/v1' },
      usage: { request_count: 6 },
    });
    expect(llm?.requests.at(-1)?.body).toContain('EXPERT TALK FUSION REPAIR CONTRACT');
  });

  it('publishes no assistant answer when fusion repair is also malformed', async () => {
    const persistentPrompt = 'Fusion returns malformed output. Fusion repair also fails.';
    const persistent = await startRun(persistentPrompt);
    const failed = await waitForTerminal(persistent.runPath);

    expect(failed).toMatchObject({
      state: 'failed',
      stage: 'fusion',
      error: { reason: 'FUSION_RESULT_INVALID' },
      fusion: { state: 'failed', request_count: 2 },
    });
    expect(failed.result).toBeUndefined();
    const transcript = transcriptResponseSchema.parse(
      (await call<unknown>(
        'GET',
        `/api/v1/sessions/${persistent.sessionId}/transcript?agent_id=main`,
        'client-a',
      )).body.data,
    );
    const transcriptText = transcript.items.filter((item) => item.kind === 'turn')
      .flatMap((turn) => turn.steps)
      .flatMap((step) => step.frames)
      .filter((frame) => frame.kind === 'text')
      .map((frame) => frame.text)
      .join('');
    expect(transcriptText).not.toContain('not a typed fusion result');
  });

  it('classifies a provider-idle watchdog failure as a stage timeout', async () => {
    const { runPath } = await startRun('Provider stream stalls.');
    const failed = await waitForTerminal(runPath);

    expect(failed).toMatchObject({
      state: 'failed',
      stage: 'opening',
      opening: {
        lead: { state: 'failed', error_reason: 'STAGE_TIMEOUT' },
        peer: { state: 'failed', error_reason: 'STAGE_TIMEOUT' },
      },
      error: { reason: 'OPENING_FAILED' },
    });
  });

  it('retries one transient provider failure without adding a model request', async () => {
    const { runPath } = await startRun('Retry one opening.');
    const completed = await waitForTerminal(runPath);

    expect(completed).toMatchObject({
      state: 'completed',
      opening: {
        lead: { state: 'completed', request_count: 1, provider_attempt_count: 2 },
      },
      usage: { request_count: 5, provider_attempt_count: 6 },
    });
    expect(llm?.requests).toHaveLength(6);
  });

  it('stops persistent provider retries at the stage attempt ceiling', async () => {
    const { runPath } = await startRun('Exhaust opening retries.');
    const failed = await waitForTerminal(runPath);

    expect(failed).toMatchObject({
      state: 'failed',
      stage: 'opening',
      opening: {
        lead: {
          state: 'failed',
          request_count: 1,
          provider_attempt_count: 2,
        },
      },
    });
    expect(llm?.requests.filter((request) => request.model === 'lead')).toHaveLength(2);
  });

  it('removes tools from the final opening request and stops before a fifth request', async () => {
    const { runPath } = await startRun('Use eight read-only tool calls before answering.');
    const failed = await waitForTerminal(runPath);

    expect(failed).toMatchObject({
      state: 'failed',
      stage: 'opening',
      opening: {
        peer: {
          state: 'failed',
          error_reason: 'STAGE_REQUEST_BUDGET_EXCEEDED',
          request_count: 4,
          provider_attempt_count: 4,
          tool_call_count: 3,
        },
      },
    });
    const peerRequests = llm?.requests.filter((request) => request.model === 'peer') ?? [];
    expect(peerRequests).toHaveLength(4);
    const finalRequest = JSON.parse(peerRequests.at(-1)!.body) as { tools?: readonly unknown[] };
    expect(finalRequest.tools ?? []).toEqual([]);
  });

  it('accepts a short answer when provider usage includes reasoning above the output cap', async () => {
    const { runPath } = await startRun('Provider reports overflow.');
    const completed = await waitForTerminal(runPath);

    expect(completed).toMatchObject({
      state: 'completed',
      opening: {
        lead: { state: 'completed' },
        peer: { state: 'completed' },
      },
    });
  });

  it('fails when the visible answer exceeds the output cap', async () => {
    const { runPath } = await startRun('Visible answer exceeds the cap.');
    const failed = await waitForTerminal(runPath);

    expect(failed).toMatchObject({
      state: 'failed',
      stage: 'opening',
      opening: {
        lead: { state: 'failed', error_reason: 'STAGE_REQUEST_BUDGET_EXCEEDED' },
        peer: { state: 'failed', error_reason: 'STAGE_REQUEST_BUDGET_EXCEEDED' },
      },
    });
  });
});
