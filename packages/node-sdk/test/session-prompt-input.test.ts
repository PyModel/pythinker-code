import { describe, expect, it, vi } from 'vitest';
import type { CoreAPI, RPCMethods } from '@pymodel/agent-core';

import type { SessionStatus, SetSessionDynamicWorkflowModeRpcInput } from '../src/index';
import { SDKRpcClientBase } from '../src/rpc';
import { Session } from '../src/session';

class CapturingRpc extends SDKRpcClientBase {
  readonly promptCalls: unknown[] = [];
  readonly enterPlanCalls: unknown[] = [];
  readonly cancelPlanCalls: unknown[] = [];
  readonly getPlanCalls: unknown[] = [];
  readonly clearPlanCalls: unknown[] = [];
  readonly setModelCalls: unknown[] = [];
  readonly enterDynamicWorkflowCalls: unknown[] = [];
  readonly exitDynamicWorkflowCalls: unknown[] = [];
  readonly getDynamicWorkflowModeCalls: unknown[] = [];
  private getRpcDelay: Promise<void> | undefined;
  private getRpcCallCount = 0;
  private readonly getRpcWaiters = new Set<() => void>();

  delayGetRpcUntil(promise: Promise<void>): void {
    this.getRpcDelay = promise;
  }

  waitForGetRpcCalls(count: number): Promise<void> {
    if (this.getRpcCallCount >= count) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = () => {
        if (this.getRpcCallCount < count) return;
        this.getRpcWaiters.delete(check);
        resolve();
      };
      this.getRpcWaiters.add(check);
    });
  }

  protected async getRpc(): Promise<RPCMethods<CoreAPI>> {
    this.getRpcCallCount += 1;
    for (const waiter of this.getRpcWaiters) waiter();
    if (this.getRpcDelay !== undefined) await this.getRpcDelay;
    return {
      prompt: async (input: unknown) => {
        this.promptCalls.push(input);
      },
      setModel: async (input: unknown) => {
        this.setModelCalls.push(input);
        return { model: 'captured-model' };
      },
      enterPlan: async (input: unknown) => {
        this.enterPlanCalls.push(input);
      },
      cancelPlan: async (input: unknown) => {
        this.cancelPlanCalls.push(input);
      },
      getPlan: async (input: unknown) => {
        this.getPlanCalls.push(input);
        return null;
      },
      clearPlan: async (input: unknown) => {
        this.clearPlanCalls.push(input);
      },
      enterDynamicWorkflow: async (input: unknown) => {
        this.enterDynamicWorkflowCalls.push(input);
      },
      exitDynamicWorkflow: async (input: unknown) => {
        this.exitDynamicWorkflowCalls.push(input);
      },
      getDynamicWorkflowMode: async (input: unknown) => {
        this.getDynamicWorkflowModeCalls.push(input);
        return true;
      },
      getConfig: async () => ({
        thinkingLevel: 'off',
        modelCapabilities: {
          max_context_tokens: 128_000,
          cost: { input: 3, output: 15 },
        },
      }),
      getContext: async () => ({ tokenCount: 256 }),
      getPermission: async () => ({ mode: 'manual' }),
      getUsage: async () => ({ totalCostUsd: 0.125 }),
    } as unknown as RPCMethods<CoreAPI>;
  }
}

describe('Session.prompt input normalization', () => {
  it('passes multimodal prompt parts through to the core RPC client', async () => {
    const prompt = vi.fn(async () => {});
    const session = new Session({
      id: 'ses_multimodal_prompt',
      workDir: '/tmp/work',
      rpc: { prompt } as unknown as SDKRpcClientBase,
    });
    const input = [
      { type: 'text', text: 'describe these' },
      { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
      { type: 'video_url', videoUrl: { url: 'ms://file-123', id: 'file-123' } },
    ] as const;

    await session.prompt(input);

    expect(prompt).toHaveBeenCalledWith({
      sessionId: 'ses_multimodal_prompt',
      input,
    });
  });

  it('passes a structured output schema through to the core RPC client', async () => {
    const prompt = vi.fn(async () => {});
    const session = new Session({
      id: 'ses_structured_prompt',
      workDir: '/tmp/work',
      rpc: { prompt } as unknown as SDKRpcClientBase,
    });
    const outputSchema = {
      type: 'object',
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
      additionalProperties: false,
    } as const;

    await session.prompt('answer briefly', { outputSchema });

    expect(prompt).toHaveBeenCalledWith({
      sessionId: 'ses_structured_prompt',
      input: [{ type: 'text', text: 'answer briefly' }],
      outputSchema,
    });
  });

  it('starts btw and returns the forked agent id', async () => {
    const startBtw = vi.fn(async () => 'agent-btw');
    const session = new Session({
      id: 'ses_btw_start',
      workDir: '/tmp/work',
      rpc: { startBtw } as unknown as SDKRpcClientBase,
    });

    await expect(session.startBtw()).resolves.toBe('agent-btw');
    expect(startBtw).toHaveBeenCalledWith({
      sessionId: 'ses_btw_start',
    });
  });

  it('manages additional workspace directories through session-scoped RPC', async () => {
    const listWorkspaceDirectories = vi.fn(async () => [
      { path: '/tmp/extra', source: 'session' as const },
    ]);
    const addWorkspaceDirectory = vi.fn(async () => ({
      path: '/tmp/extra',
      source: 'session' as const,
    }));
    const removeWorkspaceDirectory = vi.fn(async () => {});
    const session = new Session({
      id: 'ses_workspace_directories',
      workDir: '/tmp/work',
      rpc: {
        listWorkspaceDirectories,
        addWorkspaceDirectory,
        removeWorkspaceDirectory,
      } as unknown as SDKRpcClientBase,
    });

    await expect(session.listWorkspaceDirectories()).resolves.toEqual([
      { path: '/tmp/extra', source: 'session' },
    ]);
    await expect(session.addWorkspaceDirectory('/tmp/extra')).resolves.toEqual({
      path: '/tmp/extra',
      source: 'session',
    });
    await session.removeWorkspaceDirectory('/tmp/extra');

    expect(listWorkspaceDirectories).toHaveBeenCalledWith({
      sessionId: 'ses_workspace_directories',
    });
    expect(addWorkspaceDirectory).toHaveBeenCalledWith({
      sessionId: 'ses_workspace_directories',
      path: '/tmp/extra',
    });
    expect(removeWorkspaceDirectory).toHaveBeenCalledWith({
      sessionId: 'ses_workspace_directories',
      path: '/tmp/extra',
    });
  });

  it('lists files currently loaded into the interactive agent context', async () => {
    const listContextFiles = vi.fn(async () => ['/tmp/work/src/main.ts']);
    const session = new Session({
      id: 'ses_context_files',
      workDir: '/tmp/work',
      rpc: { listContextFiles } as unknown as SDKRpcClientBase,
    });

    await expect(session.listContextFiles()).resolves.toEqual(['/tmp/work/src/main.ts']);
    expect(listContextFiles).toHaveBeenCalledWith({ sessionId: 'ses_context_files' });
  });

  it('gets the interactive agent context usage report', async () => {
    const report = {
      model: 'mock-model',
      estimatedTokens: 120,
      maxTokens: 1_000,
      percentage: 12,
      messageCount: 2,
      categories: [{ name: 'User messages', tokens: 20, percentage: 2 }],
      tools: [{ name: 'Read', source: 'builtin' as const, tokens: 30 }],
    };
    const getContextUsage = vi.fn(async () => report);
    const session = new Session({
      id: 'ses_context_usage',
      workDir: '/tmp/work',
      rpc: { getContextUsage } as unknown as SDKRpcClientBase,
    });

    await expect(session.getContextUsage()).resolves.toEqual(report);
    expect(getContextUsage).toHaveBeenCalledWith({ sessionId: 'ses_context_usage' });
  });

  it('refreshes the active session instructions', async () => {
    const refreshInstructions = vi.fn(async () => {});
    const session = new Session({
      id: 'ses_refresh_instructions',
      workDir: '/tmp/work',
      rpc: { refreshInstructions } as unknown as SDKRpcClientBase,
    });

    await session.refreshInstructions();

    expect(refreshInstructions).toHaveBeenCalledWith({
      sessionId: 'ses_refresh_instructions',
    });
  });

  it('lists working-tree changes and gets a file diff', async () => {
    const changes = {
      branch: 'feature',
      additions: 2,
      deletions: 1,
      truncated: false,
      files: [
        {
          path: 'src/main.ts',
          status: 'modified' as const,
          additions: 2,
          deletions: 1,
          binary: false,
        },
      ],
    };
    const diff = {
      path: 'src/main.ts',
      diff: '@@ -1 +1 @@\n-old\n+new',
      truncated: false,
    };
    const listWorkingTreeChanges = vi.fn(async () => changes);
    const getWorkingTreeDiff = vi.fn(async () => diff);
    const session = new Session({
      id: 'ses_working_tree',
      workDir: '/tmp/work',
      rpc: {
        listWorkingTreeChanges,
        getWorkingTreeDiff,
      } as unknown as SDKRpcClientBase,
    });

    await expect(session.listWorkingTreeChanges()).resolves.toEqual(changes);
    await expect(session.getWorkingTreeDiff('src/main.ts')).resolves.toEqual(diff);
    expect(listWorkingTreeChanges).toHaveBeenCalledWith({ sessionId: 'ses_working_tree' });
    expect(getWorkingTreeDiff).toHaveBeenCalledWith({
      sessionId: 'ses_working_tree',
      path: 'src/main.ts',
    });
  });

  it('scopes interactive agent id across awaited session operations', async () => {
    const rpc = new CapturingRpc();
    const session = new Session({
      id: 'ses_scoped_agent',
      workDir: '/tmp/work',
      rpc,
    });

    await rpc.withInteractiveAgent('agent-btw', async () => {
      await Promise.resolve();
      await session.prompt('side question');
      await session.setPlanMode(true);
      await session.getPlan();
      await session.clearPlan();
      await session.setPlanMode(false);
      expect(rpc.interactiveAgentId).toBe('agent-btw');
    });

    expect(rpc.interactiveAgentId).toBe('main');
    expect(rpc.promptCalls).toEqual([
      {
        sessionId: 'ses_scoped_agent',
        agentId: 'agent-btw',
        input: [{ type: 'text', text: 'side question' }],
      },
    ]);
    expect(rpc.enterPlanCalls).toEqual([{ sessionId: 'ses_scoped_agent', agentId: 'agent-btw' }]);
    expect(rpc.getPlanCalls).toEqual([{ sessionId: 'ses_scoped_agent', agentId: 'agent-btw' }]);
    expect(rpc.clearPlanCalls).toEqual([{ sessionId: 'ses_scoped_agent', agentId: 'agent-btw' }]);
    expect(rpc.cancelPlanCalls).toEqual([{ sessionId: 'ses_scoped_agent', agentId: 'agent-btw' }]);
  });

  it('uses only dynamic workflow RPC names and maps the required status field', async () => {
    const rpc = new CapturingRpc();
    const session = new Session({
      id: 'ses_dynamic_workflow',
      workDir: '/tmp/work',
      rpc,
    });
    const modeInput: SetSessionDynamicWorkflowModeRpcInput = {
      sessionId: 'ses_dynamic_workflow',
      enabled: true,
      trigger: 'manual',
    };

    await session.dynamicWorkflow('Audit the terminal UI');
    await session.setDynamicWorkflowMode(modeInput.enabled, modeInput.trigger);
    await session.setDynamicWorkflowMode(false, 'manual');
    const status: SessionStatus = await session.getStatus();

    expect(rpc.enterDynamicWorkflowCalls).toEqual([
      { sessionId: 'ses_dynamic_workflow', agentId: 'main', trigger: 'task' },
      { sessionId: 'ses_dynamic_workflow', agentId: 'main', trigger: 'manual' },
    ]);
    expect(rpc.exitDynamicWorkflowCalls).toEqual([
      { sessionId: 'ses_dynamic_workflow', agentId: 'main' },
    ]);
    expect(rpc.getDynamicWorkflowModeCalls).toEqual([
      { sessionId: 'ses_dynamic_workflow', agentId: 'main' },
    ]);
    expect(rpc.promptCalls).toEqual([
      {
        sessionId: 'ses_dynamic_workflow',
        agentId: 'main',
        input: [{ type: 'text', text: 'Audit the terminal UI' }],
      },
    ]);
    expect(status).toMatchObject({
      dynamicWorkflowMode: true,
      contextTokens: 256,
      maxContextTokens: 128_000,
      modelCostRates: { input: 3, output: 15 },
      usage: { totalCostUsd: 0.125 },
    });
  });

  it('isolates overlapping interactive agent scopes while RPC resolution is pending', async () => {
    let releaseRpc!: () => void;
    const getRpcDelay = new Promise<void>((resolve) => {
      releaseRpc = resolve;
    });
    const rpc = new CapturingRpc();
    rpc.delayGetRpcUntil(getRpcDelay);
    const session = new Session({
      id: 'ses_overlapping_agents',
      workDir: '/tmp/work',
      rpc,
    });

    const first = rpc.withInteractiveAgent('agent-a', () => session.setModel('model-a'));
    const second = rpc.withInteractiveAgent('agent-b', () => session.setModel('model-b'));
    await rpc.waitForGetRpcCalls(2);

    expect(rpc.setModelCalls).toEqual([]);
    releaseRpc();
    await Promise.all([first, second]);

    expect(rpc.interactiveAgentId).toBe('main');
    expect(rpc.setModelCalls).toHaveLength(2);
    expect(rpc.setModelCalls).toEqual(
      expect.arrayContaining([
        { sessionId: 'ses_overlapping_agents', agentId: 'agent-a', model: 'model-a' },
        { sessionId: 'ses_overlapping_agents', agentId: 'agent-b', model: 'model-b' },
      ]),
    );
  });
});
