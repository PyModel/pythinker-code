import { afterEach, describe, expect, it, vi } from 'vitest';

import { DaemonPythinkerWebApi } from '../src/api/daemon/client';
import { createCatalogProviderApi } from '../src/api/daemon/catalog';
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

function apiConfig() {
  return {
    serverHttpUrl: 'http://example.test:58627',
    clientId: 'web_test',
    clientName: 'pythinker-code-web',
    clientVersion: '0.1.1',
    clientUiMode: 'web',
  };
}

function api(): DaemonPythinkerWebApi {
  return new DaemonPythinkerWebApi(apiConfig());
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
      agent_id: 'agent_1',
      model: 'secondary/model',
      thinking_effort: 'high',
      dynamic_workflow_index: 2,
    });

    expect(prompt).toMatchObject({ dynamic_workflow_mode: true });
    expect(Object.keys(prompt)).toEqual(expect.arrayContaining(['dynamic_workflow_mode']));
    expect(task).toMatchObject({
      agentId: 'agent_1',
      model: 'secondary/model',
      thinkingEffort: 'high',
      dynamicWorkflowIndex: 2,
    });
    expect(Object.keys(task)).toEqual(
      expect.arrayContaining(['agentId', 'model', 'thinkingEffort', 'dynamicWorkflowIndex']),
    );
  });

  it('loads one subagent transcript from the agent-scoped transcript route', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okEnvelope({
      agent_id: 'agent_1',
      items: [],
      has_more: false,
      tasks: [],
      interactions: [],
      attachments: [],
      todos: [],
      prompts: [],
      meta: { activity: 'idle' },
      agents: [{ agentId: 'agent_1', type: 'sub', label: 'Review files' }],
      pending_interactions: [],
      seq: 4,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      api().getSessionTranscript('ses_1', { agentId: 'agent_1', pageSize: 20 }),
    ).resolves.toMatchObject({
      agentId: 'agent_1',
      seq: 4,
      snapshot: { items: [], hasMoreOlder: false },
    });
    expect(fetchMock.mock.calls[0]![0]).toContain(
      '/api/v1/sessions/ses_1/transcript?agent_id=agent_1&page_size=20',
    );
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
  it('lists all importable providers from the server catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okEnvelope({
      items: [
        {
          id: 'anthropic',
          name: 'Anthropic',
          wire_type: 'anthropic',
          guessed: false,
          needs_base_url: false,
          rejected: false,
          reject_reason: null,
          env_key: 'ANTHROPIC_API_KEY',
          models: [{
            id: 'claude/sonnet',
            name: 'Claude Sonnet',
            max_context_size: 200_000,
            capabilities: ['vision'],
            reasoning: false,
          }],
        },
        {
          id: 'local',
          name: 'Local endpoint',
          wire_type: null,
          guessed: true,
          needs_base_url: true,
          rejected: false,
          reject_reason: null,
          env_key: null,
          models: [{
            id: 'local/model',
            max_context_size: 32_000,
            reasoning: true,
          }],
        },
      ],
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createCatalogProviderApi(apiConfig()).listCatalogProviders()).resolves.toEqual([
      {
        id: 'anthropic',
        name: 'Anthropic',
        wireType: 'anthropic',
        guessed: false,
        needsBaseUrl: false,
        rejected: false,
        rejectReason: null,
        envKey: 'ANTHROPIC_API_KEY',
        models: [{
          id: 'claude/sonnet',
          name: 'Claude Sonnet',
          maxContextSize: 200_000,
          capabilities: ['vision'],
          reasoning: false,
        }],
      },
      {
        id: 'local',
        name: 'Local endpoint',
        wireType: null,
        guessed: true,
        needsBaseUrl: true,
        rejected: false,
        rejectReason: null,
        envKey: null,
        models: [{
          id: 'local/model',
          name: undefined,
          maxContextSize: 32_000,
          capabilities: undefined,
          reasoning: true,
        }],
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://example.test:58627/api/v1/catalog/providers');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'GET' });
  });

  it('imports a catalog provider with credentials and base URL', async () => {
    const provider = {
      id: 'openai_responses',
      name: 'OpenAI Responses',
      wire_type: 'openai_responses',
      guessed: false,
      needs_base_url: false,
      rejected: false,
      reject_reason: null,
      env_key: 'OPENAI_API_KEY',
      models: [{
        id: 'openai_responses/gpt-5-mini',
        name: 'GPT-5 mini',
        max_context_size: 400_000,
        capabilities: ['tool_use'],
        reasoning: true,
      }],
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(okEnvelope({
      provider,
      models_imported: 1,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createCatalogProviderApi(apiConfig()).importCatalogProvider({
      catalogId: 'openai_responses',
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.test/v1',
    })).resolves.toMatchObject({
      modelsImported: 1,
      provider: { id: 'openai_responses', name: 'OpenAI Responses' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://example.test:58627/api/v1/providers:import_catalog',
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      catalog_id: 'openai_responses',
      api_key: 'sk-test',
      base_url: 'https://api.example.test/v1',
    });
  });

  it('creates and replaces manual providers with complete model banks', async () => {
    const provider = {
      id: 'local',
      type: 'openai',
      base_url: 'https://api.example.test/v1',
      has_api_key: true,
      status: 'connected',
      models: ['local/model-a'],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okEnvelope(provider))
      .mockResolvedValueOnce(okEnvelope({ provider: { ...provider, id: 'renamed' } }));
    vi.stubGlobal('fetch', fetchMock);

    await api().addProvider({
      id: 'local',
      type: 'openai',
      apiKey: 'secret',
      baseUrl: 'https://api.example.test/v1',
      models: [{ model: 'model-a', maxContextSize: 128_000, displayName: 'Model A' }],
    });
    await api().updateProvider('local', {
      newId: 'renamed',
      type: 'openai',
      baseUrl: 'https://api.example.test/v1',
      defaultModel: 'model-a',
      models: [{ model: 'model-a', maxContextSize: 128_000 }],
    });

    expect(fetchMock.mock.calls[0]![0]).toBe('http://example.test:58627/api/v1/providers');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      id: 'local',
      type: 'openai',
      api_key: 'secret',
      base_url: 'https://api.example.test/v1',
      models: [{ model: 'model-a', max_context_size: 128_000, display_name: 'Model A' }],
    });
    expect(fetchMock.mock.calls[1]![0]).toBe('http://example.test:58627/api/v1/providers/local');
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string)).toEqual({
      new_id: 'renamed',
      type: 'openai',
      base_url: 'https://api.example.test/v1',
      default_model: 'model-a',
      models: [{ model: 'model-a', max_context_size: 128_000 }],
    });
  });

  it('imports a private provider registry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okEnvelope({
      providers: [{
        id: 'private', type: 'openai', has_api_key: true, status: 'connected', models: ['private/model-a'],
      }],
      models_imported: 1,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api().importCustomRegistry({
      url: 'https://registry.example.test/api.json',
      apiKey: 'registry-secret',
    })).resolves.toMatchObject({
      providers: [{ id: 'private' }],
      modelsImported: 1,
    });
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      url: 'https://registry.example.test/api.json',
      api_key: 'registry-secret',
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
