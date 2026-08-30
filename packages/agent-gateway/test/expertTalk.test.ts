import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transcriptResponseSchema } from '@pymodel/transcript';

import { ErrorCode } from '../src/protocol/error-codes';
import { expertTalkRunSchema, expertTalkStatusSchema } from '../src/protocol/rest-expert-talk';
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
  'Fused answer from the manual flow.',
  '',
  '## Consensus & Divergence',
  '',
  '- Consensus: both experts agree.',
].join('\n');

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
        model === 'lead'
        && body.includes('One opening fails.')
        && body.includes('DISCUSSION OPENING CONTRACT')
      ) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(sseToolCall('call_write', 'Write', JSON.stringify({ path: 'forbidden.txt' })));
        return;
      }

      const toolResults = parsed.messages?.filter((message) => message.role === 'tool').length ?? 0;
      if (body.includes('Stream live progress.') && body.includes('DISCUSSION OPENING CONTRACT')) {
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
        await new Promise((resolve) => setTimeout(resolve, 500));
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
      if (body.includes('ARCHITECT REVIEW OF BUILDER CONTRACT')) {
        text = 'Architect review marker.';
      }
      if (body.includes('DISCUSSION FUSION CONTRACT')) {
        text = FUSION_MARKDOWN;
      }

      const completionTokens = model === 'peer'
        && body.includes('DISCUSSION OPENING CONTRACT')
        ? 4_943
        : 4;
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
  'capabilities = ["tool_use"]',
  '',
  '[models."acme/peer"]',
  'provider = "acme"',
  'model = "peer"',
  'max_context_size = 100000',
  'capabilities = ["tool_use"]',
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

  it('allows the full eight-tool opening budget plus the final answer request', async () => {
    const sessionId = await createSession();
    const expertTalkPath = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', expertTalkPath, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    const armed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'Use eight read-only tool calls before answering.' }],
        expert_talk_arm_id: armId,
      },
    );
    const runPath = `${expertTalkPath}/runs/${String(submitted.body.data.expert_talk_run_id)}`;
    let settled = expertTalkRunSchema.parse(
      (await call<unknown>('GET', runPath, 'client-a')).body.data,
    );
    await vi.waitFor(async () => {
      settled = expertTalkRunSchema.parse(
        (await call<unknown>('GET', runPath, 'client-a')).body.data,
      );
      expect(settled.state).not.toBe('running');
    }, { timeout: 30_000, interval: 100 });

    expect(settled).toMatchObject({
      state: 'waiting',
      stage: 'opening',
      opening: {
        peer: {
          state: 'completed',
          request_count: 9,
          tool_call_count: 8,
          tools: Array.from({ length: 8 }, (_, index) => ({
            id: `call_read_${String(index + 1)}`,
            name: 'Read',
          })),
          text: 'Peer opening after eight reads.',
        },
      },
    });
    expect(llm?.requests.filter((request) => request.model === 'peer')).toHaveLength(9);
  });

  it('projects live answer and thinking deltas while both opinions run', async () => {
    const sessionId = await createSession();
    const expertTalkPath = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', expertTalkPath, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    const armed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'Stream live progress.' }],
        expert_talk_arm_id: armId,
      },
    );
    const runPath = `${expertTalkPath}/runs/${String(submitted.body.data.expert_talk_run_id)}`;

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

    await vi.waitFor(async () => {
      const settled = expertTalkRunSchema.parse(
        (await call<unknown>('GET', runPath, 'client-a')).body.data,
      );
      expect(settled.state).toBe('waiting');
    }, { timeout: 5_000, interval: 50 });
  });

  it('cancels both active opening requests', async () => {
    const sessionId = await createSession();
    const expertTalkPath = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', expertTalkPath, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    const armed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'Wait until cancellation.' }],
        expert_talk_arm_id: armId,
      },
    );
    const runId = submitted.body.data.expert_talk_run_id;
    expect(runId).toBeDefined();
    await vi.waitFor(() => expect(llm?.requests).toHaveLength(2));

    const cancelled = await call<unknown>(
      'POST',
      `${expertTalkPath}/runs/${String(runId)}/cancel`,
      'client-a',
    );

    expect(expertTalkRunSchema.parse(cancelled.body.data).state).toBe('cancelled');
    expect(llm?.requests).toHaveLength(2);
  });

  it('finishes with the Architect opinion without running Fusion', async () => {
    const sessionId = await createSession();
    const expertTalkPath = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', expertTalkPath, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    const armed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'Finish after the two opinions.' }],
        expert_talk_arm_id: armId,
      },
    );
    const runPath = `${expertTalkPath}/runs/${String(submitted.body.data.expert_talk_run_id)}`;
    await vi.waitFor(async () => {
      expect(expertTalkRunSchema.parse(
        (await call<unknown>('GET', runPath, 'client-a')).body.data,
      )).toMatchObject({ state: 'waiting', stage: 'opening' });
    }, { timeout: 30_000, interval: 100 });

    const completed = expertTalkRunSchema.parse((await call<unknown>(
      'POST',
      `${runPath}/finish`,
      'client-a',
    )).body.data);

    expect(completed).toMatchObject({
      state: 'completed',
      stage: 'terminal',
      result: { answer: 'Lead opening marker.' },
      review: { lead: { state: 'unavailable' } },
      fusion: { state: 'unavailable' },
    });
    expect(llm?.requests).toHaveLength(2);
    const transcript = transcriptResponseSchema.parse(
      (await call<unknown>(
        'GET',
        `/api/v1/sessions/${sessionId}/transcript?agent_id=main`,
        'client-a',
      )).body.data,
    );
    const transcriptText = transcript.items
      .filter((item) => item.kind === 'turn')
      .flatMap((turn) => turn.steps)
      .flatMap((step) => step.frames)
      .filter((frame) => frame.kind === 'text')
      .map((frame) => frame.text)
      .join('');
    expect(transcriptText).toContain('Lead opening marker.');
    expect(transcriptText).not.toContain('Peer opening marker.');
  });

  it('keeps the successful opinion when the other opening fails', async () => {
    const sessionId = await createSession();
    const expertTalkPath = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', expertTalkPath, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    const armed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'One opening fails.' }],
        expert_talk_arm_id: armId,
      },
    );
    const runPath = `${expertTalkPath}/runs/${String(submitted.body.data.expert_talk_run_id)}`;
    let failed = expertTalkRunSchema.parse(
      (await call<unknown>('GET', runPath, 'client-a')).body.data,
    );
    await vi.waitFor(async () => {
      failed = expertTalkRunSchema.parse(
        (await call<unknown>('GET', runPath, 'client-a')).body.data,
      );
      expect(failed.state).toBe('failed');
    }, { timeout: 30_000, interval: 100 });

    expect(failed.opening.lead.state).toBe('failed');
    expect(failed.opening.peer).toMatchObject({
      state: 'completed',
      text: 'Peer opening marker.',
    });
    expect(llm?.requests.some((request) => request.model === 'peer')).toBe(true);
  });

  it('waits after opinions, runs only the Architect review on request, then fuses', async () => {
    const sessionId = await createSession();
    const expertTalkPath = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', expertTalkPath, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    const armed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    expect(armId).toBeDefined();

    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'Resolve this with both experts.' }],
        expert_talk_arm_id: armId,
      },
    );
    expect(submitted.body.code, JSON.stringify(submitted.body)).toBe(0);
    const runId = submitted.body.data.expert_talk_run_id;
    expect(runId).toBeDefined();

    const runPath = `${expertTalkPath}/runs/${String(runId)}`;
    await vi.waitFor(async () => {
      const response = await call<unknown>('GET', runPath, 'client-a');
      expect(expertTalkRunSchema.parse(response.body.data)).toMatchObject({
        state: 'waiting',
        stage: 'opening',
      });
    }, { timeout: 30_000, interval: 100 });
    expect(llm?.requests).toHaveLength(2);

    const reviewStarted = expertTalkRunSchema.parse((await call<unknown>(
      'POST',
      `${runPath}/review`,
      'client-a',
    )).body.data);
    expect(reviewStarted).toMatchObject({ state: 'running', stage: 'review' });
    await vi.waitFor(async () => {
      const response = await call<unknown>('GET', runPath, 'client-a');
      expect(expertTalkRunSchema.parse(response.body.data)).toMatchObject({
        state: 'waiting',
        stage: 'review',
        review: { lead: { state: 'completed', text: 'Architect review marker.' } },
      });
    }, { timeout: 30_000, interval: 100 });
    expect(llm?.requests).toHaveLength(3);
    expect(llm?.requests.at(-1)).toMatchObject({ model: 'lead' });

    const fusionStarted = expertTalkRunSchema.parse((await call<unknown>(
      'POST',
      `${runPath}/fusion`,
      'client-a',
    )).body.data);
    expect(fusionStarted).toMatchObject({ state: 'running', stage: 'fusion' });
    await vi.waitFor(async () => {
      const response = await call<unknown>('GET', runPath, 'client-a');
      expect(expertTalkRunSchema.parse(response.body.data).state).toBe('completed');
    }, { timeout: 30_000, interval: 100 });

    const completed = expertTalkRunSchema.parse(
      (await call<unknown>('GET', runPath, 'client-a')).body.data,
    );
    expect(completed.result?.answer).toBe(FUSION_MARKDOWN);
    expect(completed.opening.peer.usage?.output).toBe(4_943);
    expect(completed.usage.request_count).toBe(4);
    const finalStatus = expertTalkStatusSchema.parse(
      (await call<unknown>('GET', expertTalkPath, 'client-a')).body.data,
    );
    expect(finalStatus.pair_validation).toEqual({ state: 'valid' });
    expect(llm?.requests).toHaveLength(4);
    expect(llm?.requests.filter((request) => request.model === 'lead')).toHaveLength(3);
    expect(llm?.requests.filter((request) => request.model === 'peer')).toHaveLength(1);

    const leadReview = llm?.requests.find((request) =>
      request.model === 'lead' && request.body.includes('ARCHITECT REVIEW OF BUILDER CONTRACT'));
    const peerReview = llm?.requests.find((request) =>
      request.model === 'peer' && request.body.includes('ARCHITECT REVIEW OF BUILDER CONTRACT'));
    expect(leadReview?.body).toContain('Peer opening marker.');
    expect(peerReview).toBeUndefined();
    expect(llm?.requests.at(-1)).toMatchObject({ model: 'lead' });
    expect(llm?.requests.at(-1)?.body).toContain('Architect review marker.');

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
    expect(transcriptText).toContain('Fused answer from the manual flow.');
    expect(transcriptText).not.toContain('opening marker');
    expect(transcriptText).not.toContain('review marker');
  });

  it('can fuse directly from two opinions without a review', async () => {
    const sessionId = await createSession();
    const expertTalkPath = `/api/v1/sessions/${sessionId}/expert-talk`;
    const initial = await call<unknown>('GET', expertTalkPath, 'client-a');
    const configured = await call<unknown>(
      'PUT',
      expertTalkPath,
      'client-a',
      { fusion_lead_model_id: 'acme/lead', peer_model_id: 'acme/peer' },
      initial.etag ?? undefined,
    );
    const armed = await call<unknown>(
      'POST',
      `${expertTalkPath}:arm`,
      'client-a',
      undefined,
      configured.etag ?? undefined,
    );
    const armId = expertTalkStatusSchema.parse(armed.body.data).activation.arm_id;
    const submitted = await call<{ expert_talk_run_id?: string }>(
      'POST',
      `/api/v1/sessions/${sessionId}/prompts`,
      'client-a',
      {
        content: [{ type: 'text', text: 'Fuse these opinions directly.' }],
        expert_talk_arm_id: armId,
      },
    );
    const runPath = `${expertTalkPath}/runs/${String(submitted.body.data.expert_talk_run_id)}`;
    await vi.waitFor(async () => {
      expect(expertTalkRunSchema.parse(
        (await call<unknown>('GET', runPath, 'client-a')).body.data,
      ).state).toBe('waiting');
    }, { timeout: 30_000, interval: 100 });

    await call<unknown>('POST', `${runPath}/fusion`, 'client-a');
    await vi.waitFor(async () => {
      expect(expertTalkRunSchema.parse(
        (await call<unknown>('GET', runPath, 'client-a')).body.data,
      ).state).toBe('completed');
    }, { timeout: 30_000, interval: 100 });

    expect(llm?.requests).toHaveLength(3);
    expect(llm?.requests.filter((request) =>
      request.body.includes('ARCHITECT REVIEW OF BUILDER CONTRACT'))).toHaveLength(0);
    expect(llm?.requests.at(-1)?.body).toContain('[review unavailable]');
  });
});
