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
