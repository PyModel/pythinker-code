import { afterEach, describe, expect, it, vi } from 'vitest';

import { DaemonPythinkerWebApi } from '../src/api/daemon/client';
import { toAppTask, toWirePromptSubmission } from '../src/api/daemon/mappers';
import { SLASH_COMMANDS } from '../src/lib/slashCommands';

const now = '2026-08-01T00:00:00.000Z';

function okEnvelope(data: unknown): Response {
  return new Response(
    JSON.stringify({ code: 0, msg: 'ok', data, request_id: 'req_1' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function wireSession() {
  return {
    id: 'ses_1',
    title: 'Session',
    created_at: now,
    updated_at: now,
    status: 'idle',
    archived: false,
    metadata: { cwd: '/repo' },
    agent_config: { model: 'test/model' },
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_cost_usd: 0,
      context_tokens: 0,
      context_limit: 128_000,
      turn_count: 0,
    },
    permission_rules: [],
    message_count: 0,
    last_seq: 0,
  };
}

function api(): DaemonPythinkerWebApi {
  return new DaemonPythinkerWebApi({
    serverHttpUrl: 'http://example.test:58627',
    clientId: 'web_test',
    clientName: 'pythinker-code-web',
    clientVersion: '0.1.1',
    clientUiMode: 'web',
  });
}

async function setupClient() {
  vi.resetModules();
  vi.stubGlobal('WebSocket', class WebSocket {});
  vi.doMock('../src/api', () => ({ getPythinkerWebApi: () => ({}) }));
  const { usePythinkerWebClient } = await import('../src/composables/usePythinkerWebClient');
  return { client: usePythinkerWebClient() };
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('dynamic workflow daemon contracts', () => {
  it('maps the application prompt and task fields without legacy wire aliases', () => {
    const prompt = toWirePromptSubmission({
      content: [{ type: 'text', text: 'Audit' }],
      dynamicWorkflowMode: true,
    });
    const task = toAppTask({
      id: 'task_1',
      session_id: 'ses_1',
      kind: 'subagent',
      description: 'Audit',
      status: 'running',
      created_at: now,
      dynamic_workflow_index: 2,
    });

    expect(prompt).toMatchObject({ dynamic_workflow_mode: true });
    expect(Object.keys(prompt)).toEqual(expect.arrayContaining(['dynamic_workflow_mode']));
    expect(task).toMatchObject({ dynamicWorkflowIndex: 2 });
    expect(Object.keys(task)).toEqual(expect.arrayContaining(['dynamicWorkflowIndex']));
  });

  it('registers /workflow and omits /swarm', () => {
    expect(SLASH_COMMANDS.some((command) => command.name === '/workflow')).toBe(true);
    expect(SLASH_COMMANDS.some((command) => command.name === '/swarm')).toBe(false);
  });

  it('writes dynamic_workflow_mode and reads only that runtime status field', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okEnvelope(wireSession()))
      .mockResolvedValueOnce(okEnvelope({
        model: 'test/model',
        thinking_level: 'high',
        permission: 'manual',
        plan_mode: false,
        dynamic_workflow_mode: true,
        context_tokens: 0,
        max_context_tokens: 128_000,
        context_usage: 0,
      }));
    vi.stubGlobal('fetch', fetchMock);

    const client = api();
    await client.updateSession('ses_1', { dynamicWorkflowMode: true });
    const profileRequest = fetchMock.mock.calls[0]![1] as RequestInit;
    if (typeof profileRequest.body !== 'string') throw new Error('profile request body must be text');
    const profileBody = JSON.parse(profileRequest.body) as {
      agent_config: Record<string, unknown>;
    };
    expect(profileBody.agent_config).toEqual({ dynamic_workflow_mode: true });

    const status = await client.getSessionStatus('ses_1');
    expect(status).toMatchObject({ dynamicWorkflowMode: true });
    expect(Object.keys(status)).toEqual(expect.arrayContaining(['dynamicWorkflowMode']));
  });

  it('ignores and preserves the removed storage key', async () => {
    localStorage.setItem('pythinker-web.swarm-mode', 'true');
    const { client } = await setupClient();
    const dynamicClient = client as unknown as { dynamicWorkflowMode: { value: boolean } };

    expect(localStorage.getItem('pythinker-web.swarm-mode')).toBe('true');
    expect(dynamicClient.dynamicWorkflowMode.value).toBe(false);
  });
});

describe('provider daemon contracts', () => {
  it('adds a provider through one POST to the providers collection', async () => {
    const provider = {
      id: 'openai_responses',
      type: 'openai_responses',
      base_url: 'https://api.example.test/v1',
      default_model: 'gpt_5-mini',
      has_api_key: true,
      status: 'connected',
      models: ['openai_responses/gpt_5-mini'],
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(okEnvelope(provider));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api().addProvider({
      type: 'openai_responses',
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'gpt_5-mini',
    })).resolves.toMatchObject({ id: 'openai_responses', defaultModel: 'gpt_5-mini' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://example.test:58627/api/v1/providers');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      type: 'openai_responses',
      api_key: 'sk-test',
      base_url: 'https://api.example.test/v1',
      default_model: 'gpt_5-mini',
    });
  });

  it('deletes a provider through the provider resource route', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okEnvelope({ deleted: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api().deleteProvider('openai/custom')).resolves.toEqual({ deleted: true });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://example.test:58627/api/v1/providers/openai%2Fcustom',
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body).toBeUndefined();
  });

  it('refreshes a provider through the :refresh action', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okEnvelope({
      changed: [{ provider_id: 'openai', provider_name: 'OpenAI', added: ['openai/gpt-5'], removed: [] }],
      unchanged: 0,
      failed: [],
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api().refreshProvider('openai')).resolves.toMatchObject({
      changed: [{ providerId: 'openai', added: ['openai/gpt-5'] }],
      unchanged: 0,
      failed: [],
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://example.test:58627/api/v1/providers/openai:refresh',
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
  });
});
