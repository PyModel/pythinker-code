import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { makeAgentScopeContext } from '#/agent/scopeContext/scopeContext';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { DEFAULT_SUBAGENT_TIMEOUT_MS } from '#/session/subagent/configSection';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ISessionDynamicWorkflowService, type SessionDynamicWorkflowRunResult, type SessionDynamicWorkflowTask } from '#/session/dynamic_workflow/sessionDynamicWorkflow';
import { IAgentSystemReminderService } from '#/agent/systemReminder/systemReminder';
import { AgentSystemReminderService } from '#/agent/systemReminder/systemReminderService';
import { IAgentDynamicWorkflowService } from '#/agent/dynamic_workflow/dynamic_workflow';
import { AgentDynamicWorkflowService } from '#/agent/dynamic_workflow/dynamic_workflowService';
import { DynamicWorkflowModel } from '#/agent/dynamic_workflow/dynamic_workflowOps';
import { SECONDARY_DERIVED_MODEL_ID } from '#/app/kosongConfig/secondaryModelOverlay';
import { AgentDynamicWorkflowToolInputSchema } from '#/agent/tools/agent-dynamic_workflow/agent-dynamic_workflow';
import { AgentDynamicWorkflowTool } from '#/agent/tools/agent-dynamic_workflow/agentDynamicWorkflowTool';
import { IAgentToolApprovalService } from '#/agent/toolApproval/toolApproval';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import type {
  BeforeExecuteDecision,
  ResolvedToolExecutionHookContext,
} from '#/agent/toolExecutor/toolHooks';
import type { ToolCall } from '#/kosong/contract/message';
import type { ModelCapability } from '#/kosong/contract/capability';
import { IModelCatalog } from '#/kosong/model/catalog';
import type { ExecutableToolContext } from '#/tool/toolContract';
import { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import { AgentToolRegistryService } from '#/agent/toolRegistry/toolRegistryService';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IConfigService } from '#/app/config/config';
import { normalizeAgentProfile, type AgentProfile } from '#/app/agentProfileCatalog/agentProfileCatalog';
import { ISessionAgentProfileCatalog } from '#/session/sessionAgentProfileCatalog/sessionAgentProfileCatalog';
import { IAgentProfileService } from '#/agent/profile/profile';
import { AppendLogStore } from '#/persistence/backends/node-fs/appendLogStore';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IAppendLogStore } from '#/persistence/interface/appendLogStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { AGENT_WIRE_RECORD_KEY, type WireRecord } from '#/wire/record';
import { type DomainEvent, IEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';

import { stubContextMemory } from '../contextMemory/stubs';
import { executeTool } from '../../tools/fixtures/execute-tool';
import { registerTestAgentWire, restoreTestAgentWire, testWireScope } from '../../wire/stubs';
import { stubLoopWithHooks } from '../loop/stubs';
import { stubToolExecutorEvents, type ToolExecutorEventStubs } from '../toolExecutor/stubs';
import { stubFlag } from '../../app/flag/stubs';

const signal = new AbortController().signal;

function context<Input>(
  args: Input,
  toolCallId = 'call_dynamic_workflow',
): ExecutableToolContext & { readonly args: Input } {
  return { turnId: 0, toolCallId, args, signal };
}

function toolCall(name: string, id: string): ToolCall {
  return { type: 'function', id, name, arguments: '{}' };
}

function hookContext(toolCalls: ToolCall[]): ResolvedToolExecutionHookContext {
  return {
    turnId: 0,
    signal,
    toolCall: toolCalls[0]!,
    toolCalls,
    args: {},
    execution: { approvalRule: toolCalls[0]!.name, execute: async () => ({ output: '' }) },
  };
}

function mockDynamicWorkflowHost({
  run = vi.fn().mockResolvedValue([]),
  getDynamicWorkflowItem = vi.fn().mockResolvedValue(undefined),
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly run?: (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly getDynamicWorkflowItem?: (...args: any[]) => any;
} = {}) {
  return {
    dynamic_workflowService: { _serviceBrand: undefined, getDynamicWorkflowItem, run, cancel: vi.fn() },
    callerAgentId: 'main',
  };
}

function mockDynamicWorkflowMode() {
  return { _serviceBrand: undefined, isActive: false, enter: vi.fn(), exit: vi.fn() };
}

function stubConfig(section?: {
  timeoutMs?: number;
  model?: string;
  defaultEffort?: string;
}): IConfigService {
  return {
    _serviceBrand: undefined,
    get: () => section,
  } as unknown as IConfigService;
}

const DEFAULT_CALLER_PROFILE: AgentProfile = normalizeAgentProfile({
  name: 'agent',
  description: 'test caller',
  systemPrompt: () => 'caller',
});

const DEFAULT_DYNAMIC_WORKFLOW_TARGET_PROFILES: readonly AgentProfile[] = [
  normalizeAgentProfile({
    name: 'coder',
    description: 'test coder',
    systemPrompt: () => 'coder',
  }),
  normalizeAgentProfile({
    name: 'explore',
    description: 'test explorer',
    systemPrompt: () => 'explore',
  }),
];

function stubDynamicWorkflowCatalog(
  defaultProfile: AgentProfile = DEFAULT_CALLER_PROFILE,
  targetProfiles: readonly AgentProfile[] = DEFAULT_DYNAMIC_WORKFLOW_TARGET_PROFILES,
): ISessionAgentProfileCatalog {
  return {
    _serviceBrand: undefined,
    ready: Promise.resolve(),
    get: (name: string) =>
      [defaultProfile, ...targetProfiles].find((profile) => profile.name === name),
    getDefault: () => defaultProfile,
  } as unknown as ISessionAgentProfileCatalog;
}

function stubCallerProfile(
  data?: {
    readonly profileName?: string;
    readonly subagents?: readonly string[];
    readonly modelAlias?: string;
    readonly thinkingLevel?: string;
  },
): IAgentProfileService {
  return {
    _serviceBrand: undefined,
    data: () => data ?? { profileName: undefined },
  } as unknown as IAgentProfileService;
}

function stubModelCatalog(
  capabilities: Readonly<Record<string, ModelCapability>> = {},
): IModelCatalog {
  return {
    _serviceBrand: undefined,
    get: (id: string) => {
      const capability = capabilities[id];
      if (capability === undefined) throw new Error(`Model "${id}" is not configured.`);
      return { capabilities: capability };
    },
  } as unknown as IModelCatalog;
}

describe('AgentDynamicWorkflowService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let executorEvents: ToolExecutorEventStubs;
  let permissionGateRan: boolean;
  let formatDenyMessage: Mock<(message: string) => string>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IAgentContextMemoryService, stubContextMemory());
    ix.stub(IFileSystemStorageService, new InMemoryStorageService());
    ix.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
    ix.set(IEventBus, new SyncDescriptor(EventBusService));
    ix.stub(IAgentLoopService, stubLoopWithHooks());
    ix.set(IAgentToolRegistryService, new SyncDescriptor(AgentToolRegistryService));
    ix.stub(IAgentLifecycleService, {});
    ix.stub(ISessionDynamicWorkflowService, {
      getDynamicWorkflowItem: async () => undefined,
      run: async () => [],
      cancel: () => {},
    });
    // A stand-in listener registered after the dynamic_workflow listener proves whether
    // the dynamic-workflow-exclusive veto ended adjudication or abstained.
    executorEvents = stubToolExecutorEvents();
    permissionGateRan = false;
    ix.stub(IAgentToolExecutorService, executorEvents.executor);
    formatDenyMessage = vi.fn((message: string) => message);
    ix.stub(IAgentToolApprovalService, { formatDenyMessage });
    registerTestAgentWire(ix, testWireScope('wire', 'dynamic-workflow-test'), {
      log: ix.get(IAppendLogStore),
      eventBus: ix.get(IEventBus),
    });
    ix.set(IAgentSystemReminderService, new SyncDescriptor(AgentSystemReminderService));
    ix.set(IAgentDynamicWorkflowService, new SyncDescriptor(AgentDynamicWorkflowService));
  });
  afterEach(() => disposables.dispose());

  async function fire(
    ctx: ResolvedToolExecutionHookContext,
  ): Promise<BeforeExecuteDecision | undefined> {
    disposables.add(
      executorEvents.executor.onBeforeExecuteTool(() => {
        permissionGateRan = true;
      }),
    );
    return executorEvents.fireBeforeExecute(ctx);
  }

  it('enter / exit toggle isActive and emit agent.status.updated via wire', () => {
    const dynamic_workflow = ix.get(IAgentDynamicWorkflowService);
    const events: DomainEvent[] = [];
    disposables.add(ix.get(IEventBus).subscribe((e) => events.push(e)));

    expect(dynamic_workflow.isActive).toBe(false);
    dynamic_workflow.enter('manual');
    expect(dynamic_workflow.isActive).toBe(true);
    dynamic_workflow.exit();
    expect(dynamic_workflow.isActive).toBe(false);

    expect(events).toEqual([
      { type: 'agent.status.updated', dynamicWorkflowMode: true },
      { type: 'agent.status.updated', dynamicWorkflowMode: false },
      { type: 'context.spliced', start: 0, deleteCount: 1, messages: [] },
    ]);
  });

  it('dispatch persists enter/exit records and replay rebuilds the trigger (silent)', async () => {
    const dynamic_workflow = ix.get(IAgentDynamicWorkflowService);
    dynamic_workflow.enter('manual');

    const log = ix.get(IAppendLogStore);
    const records: WireRecord[] = [];
    for await (const record of log.read<WireRecord>(
      testWireScope('wire', 'dynamic-workflow-test'),
      AGENT_WIRE_RECORD_KEY,
    )) {
      records.push(record);
    }
    expect(records).toEqual([
      { type: 'dynamic_workflow_mode.enter', trigger: 'manual', time: expect.any(Number) },
    ]);

    const ix2 = disposables.add(new TestInstantiationService());
    ix2.stub(IFileSystemStorageService, new InMemoryStorageService());
    ix2.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
    const fresh = registerTestAgentWire(ix2, testWireScope('wire', 'dynamic-workflow-replay'), {
      log: ix2.get(IAppendLogStore),
    });
    await restoreTestAgentWire(
      fresh,
      ix2.get(IAppendLogStore),
      testWireScope('wire', 'dynamic-workflow-replay'),
      records,
    );
    expect(fresh.getModel(DynamicWorkflowModel)).toBe('manual');
  });

  it('blocks a batch with multiple AgentDynamicWorkflow calls before any other adjudication', async () => {
    ix.get(IAgentDynamicWorkflowService);
    const decision = await fire(
      hookContext([toolCall('AgentDynamicWorkflow', 'call_dynamic_workflow_1'), toolCall('AgentDynamicWorkflow', 'call_dynamic_workflow_2')]),
    );

    expect(decision).toEqual({
      veto: {
        output: expect.stringContaining('one dynamic_workflow at a time'),
        isError: true,
      },
    });
    expect(permissionGateRan).toBe(false);
    expect(formatDenyMessage).toHaveBeenCalledTimes(1);
  });

  it('blocks an AgentDynamicWorkflow call mixed with other tools in one batch', async () => {
    ix.get(IAgentDynamicWorkflowService);
    const decision = await fire(
      hookContext([toolCall('AgentDynamicWorkflow', 'call_dynamic_workflow'), toolCall('Bash', 'call_bash')]),
    );

    expect(decision).toEqual({
      veto: {
        output: expect.stringContaining('must be the only tool call'),
        isError: true,
      },
    });
    expect(permissionGateRan).toBe(false);
    expect(formatDenyMessage).toHaveBeenCalledTimes(1);
  });

  it('abstains on a single AgentDynamicWorkflow call', async () => {
    ix.get(IAgentDynamicWorkflowService);
    const decision = await fire(hookContext([toolCall('AgentDynamicWorkflow', 'call_dynamic_workflow')]));

    expect(decision).toBeUndefined();
    expect(permissionGateRan).toBe(true);
    expect(formatDenyMessage).not.toHaveBeenCalled();
  });

  it('abstains on tool batches without AgentDynamicWorkflow', async () => {
    ix.get(IAgentDynamicWorkflowService);
    const decision = await fire(
      hookContext([toolCall('Bash', 'call_bash'), toolCall('Read', 'call_read')]),
    );

    expect(decision).toBeUndefined();
    expect(permissionGateRan).toBe(true);
    expect(formatDenyMessage).not.toHaveBeenCalled();
  });
});

describe('AgentDynamicWorkflowTool', () => {
  it('applies one subagent_type across templated subagents', async () => {
    const host = mockDynamicWorkflowHost({
      run: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: {
              kind: 'spawn',
              index: 1,
              item: 'src/a.ts',
              prompt: 'Review src/a.ts',
            },
            profileName: 'explore',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (explore)',
            runInBackground: false,
          },
          agentId: 'agent-explore-1',
          status: 'completed',
          result: 'explore result a',
        },
        {
          task: {
            kind: 'spawn',
            data: {
              kind: 'spawn',
              index: 2,
              item: 'src/b.ts',
              prompt: 'Review src/b.ts',
            },
            profileName: 'explore',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (explore)',
            runInBackground: false,
          },
          agentId: 'agent-explore-2',
          status: 'completed',
          result: 'explore result b',
        },
      ]),
    });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), dynamicWorkflowMode, stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());
    const input = {
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts'],
      subagent_type: 'explore',
    };

    expect(AgentDynamicWorkflowToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      AgentDynamicWorkflowToolInputSchema.safeParse({
        ...input,
        items: Array.from({ length: 128 }, (_, index) => `src/${String(index + 1)}.ts`),
      }).success,
    ).toBe(true);
    expect(
      AgentDynamicWorkflowToolInputSchema.safeParse({
        ...input,
        items: Array.from({ length: 129 }, (_, index) => `src/${String(index + 1)}.ts`),
      }).success,
    ).toBe(false);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        subagent_type: { type: 'string' },
      },
    });
    expect(
      (
        tool.parameters['properties'] as Record<
          string,
          { readonly description?: string }
        >
      )['subagent_type']?.description,
    ).toBe(
      'Subagent type used for every new subagent spawned from items; defaults to coder when omitted. Resumed subagents always keep their original type, so passing subagent_type together with resume_agent_ids is allowed — it only affects the item-based spawns.',
    );
    expect(Object.keys(tool.parameters['properties'] as Record<string, unknown>).at(-1)).toBe(
      'model',
    );

    const result = await executeTool(tool, context(input));

    expect(dynamicWorkflowMode.enter).toHaveBeenCalledWith('tool');
    expect(host.dynamic_workflowService.run).toHaveBeenCalledTimes(1);
    expect(host.dynamic_workflowService.run).toHaveBeenCalledWith(expect.objectContaining({ tasks: [
      {
        kind: 'spawn',
        data: {
          kind: 'spawn',
          index: 1,
          item: 'src/a.ts',
          prompt: 'Review src/a.ts',
        },
        profileName: 'explore',
        parentToolCallId: 'call_dynamic_workflow',
        prompt: 'Review src/a.ts',
        description: 'Review files #1 (explore)',
        dynamicWorkflowIndex: 1,
        dynamic_workflowItem: 'src/a.ts',
        runInBackground: false,
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      },
      {
        kind: 'spawn',
        data: {
          kind: 'spawn',
          index: 2,
          item: 'src/b.ts',
          prompt: 'Review src/b.ts',
        },
        profileName: 'explore',
        parentToolCallId: 'call_dynamic_workflow',
        prompt: 'Review src/b.ts',
        description: 'Review files #2 (explore)',
        dynamicWorkflowIndex: 2,
        dynamic_workflowItem: 'src/b.ts',
        runInBackground: false,
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      },
    ] }));
    expect(result.output).toBe(
      [
        '<agent_dynamic_workflow_result>',
        '<summary>completed: 2</summary>',
        '<subagent agent_id="agent-explore-1" item="src/a.ts" outcome="completed">explore result a</subagent>',
        '<subagent agent_id="agent-explore-2" item="src/b.ts" outcome="completed">explore result b</subagent>',
        '</agent_dynamic_workflow_result>',
      ].join('\n'),
    );
    expect(result.isError).toBeUndefined();
  });

  it('does not expose permission rule argument matching', () => {
    const host = mockDynamicWorkflowHost();
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());
    const execution = tool.resolveExecution({
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts'],
    });

    expect(execution.isError).toBeUndefined();
    if (execution.isError === true) throw new Error('expected a successful execution');
    expect(execution.approvalRule).toBe('AgentDynamicWorkflow');
    expect(execution.matchesRule).toBeUndefined();
  });

  it('description states the enforced input requirements', () => {
    const host = mockDynamicWorkflowHost();
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());
    expect(tool.description).toContain('at least 2');
    expect(tool.description).toContain('{{item}}');
    expect(tool.description.toLowerCase()).toContain('distinct');
  });

  it('uses the persisted caller allowlist instead of the current catalog profile', async () => {
    const host = mockDynamicWorkflowHost();
    const caller: AgentProfile = normalizeAgentProfile({
      name: 'orchestrator',
      description: 'Orchestrator',
      subagents: ['coder'],
      systemPrompt: () => 'orchestrator',
    });
    const tool = new AgentDynamicWorkflowTool(
      host.dynamic_workflowService,
      makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }),
      mockDynamicWorkflowMode(),
      stubConfig(),
      stubFlag(true),
      stubDynamicWorkflowCatalog(caller),
      stubCallerProfile({ profileName: 'deleted-profile', subagents: ['explore'] }),
      stubModelCatalog(),
    );

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: ['src/a.ts', 'src/b.ts'],
        subagent_type: 'coder',
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('Subagent type "coder" is not allowed for this agent');
    expect(host.dynamic_workflowService.run).not.toHaveBeenCalled();
  });

  it('rejects invalid launch shapes at execution time', async () => {
    const cases = [
      {
        input: {
          description: 'Review files',
          prompt_template: 'Review {{item}}',
          items: Array.from({ length: 129 }, (_, index) => `src/${String(index + 1)}.ts`),
        },
        output: 'AgentDynamicWorkflow supports at most 128 subagents.',
      },
      {
        input: {
          description: 'Review one file',
          prompt_template: 'Review {{item}}',
          items: ['src/only.ts'],
        },
        output: 'AgentDynamicWorkflow requires at least 2 items unless resume_agent_ids is provided.',
      },
      {
        input: {
          description: 'Review files',
          items: ['src/a.ts', 'src/b.ts'],
        },
        output: 'prompt_template is required when items are provided.',
      },
      {
        input: {
          description: 'Review files',
          prompt_template: 'Review files',
          items: ['src/a.ts', 'src/b.ts'],
        },
        output: 'prompt_template must include the {{item}} placeholder.',
      },
      {
        input: {
          description: 'Review files',
          prompt_template: 'Review {{item}}',
          items: ['same', 'same'],
        },
        output:
          'Duplicate subagent prompts from items 1 and 2. AgentDynamicWorkflow requires distinct subagents.',
      },
    ];

    for (const testCase of cases) {
      const host = mockDynamicWorkflowHost();
      const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());

      const result = await executeTool(tool, context(testCase.input));

      expect(result.output).toBe(testCase.output);
      expect(result.isError).toBe(true);
      expect(host.dynamic_workflowService.run).not.toHaveBeenCalled();
    }
  });

  it('resumes mapped agents before spawning item subagents', async () => {
    const run = vi.fn(
      async <T>({
        tasks,
      }: {
        tasks: readonly SessionDynamicWorkflowTask<T>[];
      }): Promise<Array<SessionDynamicWorkflowRunResult<T>>> => {
        return tasks.map((task, index) => ({
          task,
          agentId: task.kind === 'resume' ? task.resumeAgentId : `agent-new-${String(index + 1)}`,
          status: 'completed' as const,
          result: `result ${String(index + 1)}`,
        }));
      },
    );
    const persistedItems: Record<string, string> = {
      'agent-old-1': 'src/old-a.ts',
      'agent-old-2': 'src/old-b.ts',
    };
    const getDynamicWorkflowItem = vi.fn(
      async ({ agentId }: { readonly agentId: string }) => persistedItems[agentId],
    );
    const host = mockDynamicWorkflowHost({ run, getDynamicWorkflowItem });
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());
    const input = {
      description: 'Finish review',
      subagent_type: 'explore',
      prompt_template: 'Review {{item}}',
      items: ['src/new.ts'],
      resume_agent_ids: {
        'agent-old-1': 'Continue previous review A',
        'agent-old-2': 'Continue previous review B',
      },
    };

    expect(AgentDynamicWorkflowToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      AgentDynamicWorkflowToolInputSchema.safeParse({
        description: 'Resume one agent',
        resume_agent_ids: { 'agent-old-1': 'Continue previous review A' },
      }).success,
    ).toBe(true);

    const result = await executeTool(tool, context(input));

    expect(getDynamicWorkflowItem).toHaveBeenCalledWith({
      callerAgentId: 'main',
      agentId: 'agent-old-1',
    });
    expect(getDynamicWorkflowItem).toHaveBeenCalledWith({
      callerAgentId: 'main',
      agentId: 'agent-old-2',
    });
    expect(host.dynamic_workflowService.run).toHaveBeenCalledWith(expect.objectContaining({ tasks: [
      {
        kind: 'resume',
        data: {
          kind: 'resume',
          index: 1,
          agentId: 'agent-old-1',
          item: 'src/old-a.ts',
          prompt: 'Continue previous review A',
        },
        profileName: 'subagent',
        parentToolCallId: 'call_dynamic_workflow',
        prompt: 'Continue previous review A',
        description: 'Finish review #1 (resume)',
        dynamicWorkflowIndex: 1,
        dynamic_workflowItem: 'src/old-a.ts',
        runInBackground: false,
        resumeAgentId: 'agent-old-1',
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      },
      {
        kind: 'resume',
        data: {
          kind: 'resume',
          index: 2,
          agentId: 'agent-old-2',
          item: 'src/old-b.ts',
          prompt: 'Continue previous review B',
        },
        profileName: 'subagent',
        parentToolCallId: 'call_dynamic_workflow',
        prompt: 'Continue previous review B',
        description: 'Finish review #2 (resume)',
        dynamicWorkflowIndex: 2,
        dynamic_workflowItem: 'src/old-b.ts',
        runInBackground: false,
        resumeAgentId: 'agent-old-2',
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      },
      {
        kind: 'spawn',
        data: {
          kind: 'spawn',
          index: 3,
          item: 'src/new.ts',
          prompt: 'Review src/new.ts',
        },
        profileName: 'explore',
        parentToolCallId: 'call_dynamic_workflow',
        prompt: 'Review src/new.ts',
        description: 'Finish review #3 (explore)',
        dynamicWorkflowIndex: 3,
        dynamic_workflowItem: 'src/new.ts',
        runInBackground: false,
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      },
    ] }));
    expect(result.output).toBe(
      [
        '<agent_dynamic_workflow_result>',
        '<summary>completed: 3</summary>',
        '<subagent mode="resume" agent_id="agent-old-1" item="src/old-a.ts" outcome="completed">result 1</subagent>',
        '<subagent mode="resume" agent_id="agent-old-2" item="src/old-b.ts" outcome="completed">result 2</subagent>',
        '<subagent agent_id="agent-new-3" item="src/new.ts" outcome="completed">result 3</subagent>',
        '</agent_dynamic_workflow_result>',
      ].join('\n'),
    );
    expect(result.isError).toBeUndefined();
  });

  it('allows a single resumed subagent without item subagents', async () => {
    const run = vi.fn(
      async <T>({
        tasks,
      }: {
        tasks: readonly SessionDynamicWorkflowTask<T>[];
      }): Promise<Array<SessionDynamicWorkflowRunResult<T>>> => {
        return tasks.map((task, index) => ({
          task,
          agentId: task.kind === 'resume' ? task.resumeAgentId : `agent-new-${String(index + 1)}`,
          status: 'completed' as const,
          result: 'resumed result',
        }));
      },
    );
    const getDynamicWorkflowItem = vi.fn(async () => 'src/old-a.ts');
    const host = mockDynamicWorkflowHost({ run, getDynamicWorkflowItem });
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());
    const input = {
      description: 'Resume review',
      resume_agent_ids: {
        'agent-old-1': 'Continue previous review A',
      },
    };

    const result = await executeTool(tool, context(input));

    expect(getDynamicWorkflowItem).toHaveBeenCalledWith({
      callerAgentId: 'main',
      agentId: 'agent-old-1',
    });
    expect(host.dynamic_workflowService.run).toHaveBeenCalledWith(expect.objectContaining({ tasks: [
      {
        kind: 'resume',
        data: {
          kind: 'resume',
          index: 1,
          agentId: 'agent-old-1',
          item: 'src/old-a.ts',
          prompt: 'Continue previous review A',
        },
        profileName: 'subagent',
        parentToolCallId: 'call_dynamic_workflow',
        prompt: 'Continue previous review A',
        description: 'Resume review #1 (resume)',
        dynamicWorkflowIndex: 1,
        dynamic_workflowItem: 'src/old-a.ts',
        runInBackground: false,
        resumeAgentId: 'agent-old-1',
        signal,
        timeout: DEFAULT_SUBAGENT_TIMEOUT_MS,
      },
    ] }));
    expect(result.output).toBe(
      [
        '<agent_dynamic_workflow_result>',
        '<summary>completed: 1</summary>',
        '<subagent mode="resume" agent_id="agent-old-1" item="src/old-a.ts" outcome="completed">resumed result</subagent>',
        '</agent_dynamic_workflow_result>',
      ].join('\n'),
    );
  });

  it('reports failed subagents inside the XML result without failing the tool', async () => {
    const host = mockDynamicWorkflowHost({
      run: vi.fn().mockImplementation(async ({ tasks }) => [
        {
          task: tasks[0],
          agentId: 'agent-coder-1',
          status: 'completed',
          result: 'imports are stable',
        },
        {
          task: tasks[1],
          agentId: 'agent-coder-2',
          status: 'failed',
          error: 'Agent timed out after 30s.',
        },
      ]),
    });
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: ['src/a.ts', 'src/b.ts'],
      }),
    );

    expect(result.output).toBe(
      [
        '<agent_dynamic_workflow_result>',
        '<summary>completed: 1, failed: 1</summary>',
        '<resume_hint>Call AgentDynamicWorkflow with resume_agent_ids using the agent_id values in this result to continue unfinished work.</resume_hint>',
        '<subagent agent_id="agent-coder-1" item="src/a.ts" outcome="completed">imports are stable</subagent>',
        '<subagent agent_id="agent-coder-2" item="src/b.ts" outcome="failed">Agent timed out after 30s.</subagent>',
        '</agent_dynamic_workflow_result>',
      ].join('\n'),
    );
    expect(result.isError).toBeUndefined();
  });

  it('passes the configured subagent timeout to dynamic_workflow tasks', async () => {
    const host = mockDynamicWorkflowHost();
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig({ timeoutMs: 5_000 }), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());

    await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: ['src/a.ts', 'src/b.ts'],
      }),
    );

    expect(host.dynamic_workflowService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({ timeout: 5_000 }),
          expect.objectContaining({ timeout: 5_000 }),
        ],
      }),
    );
  });

  it('resolves spawn task bindings from the configured secondary model', async () => {
    const host = mockDynamicWorkflowHost();
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig({ model: 'provider/secondary', defaultEffort: 'low' }), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile({ modelAlias: 'main-model', thinkingLevel: 'high' }), stubModelCatalog());

    await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: ['src/a.ts', 'src/b.ts'],
      }),
    );

    expect(host.dynamic_workflowService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({ binding: { model: SECONDARY_DERIVED_MODEL_ID, thinking: 'low' } }),
          expect.objectContaining({ binding: { model: SECONDARY_DERIVED_MODEL_ID, thinking: 'low' } }),
        ],
      }),
    );
  });

  it('lets the tool call opt back into the primary model', async () => {
    const host = mockDynamicWorkflowHost();
    const secondaryCoder: AgentProfile = normalizeAgentProfile({
      name: 'coder',
      description: 'test coder',
      modelPreference: 'secondary',
      systemPrompt: () => 'coder',
    });
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig({ model: 'provider/secondary', defaultEffort: 'low' }), stubFlag(true), stubDynamicWorkflowCatalog(DEFAULT_CALLER_PROFILE, [secondaryCoder]), stubCallerProfile({ modelAlias: 'main-model', thinkingLevel: 'high' }), stubModelCatalog());

    await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: ['src/a.ts', 'src/b.ts'],
        model: 'primary',
      }),
    );

    expect(host.dynamic_workflowService.run).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({ binding: { model: 'main-model', thinking: 'high' } }),
          expect.objectContaining({ binding: { model: 'main-model', thinking: 'high' } }),
        ],
      }),
    );
  });

  it('advertises both selectable models in the description only when configured', async () => {
    const host = mockDynamicWorkflowHost();
    const configured = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig({ model: 'provider/secondary' }), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile({ modelAlias: 'main-model' }), stubModelCatalog({
      'provider/secondary': { image_in: true, video_in: false, audio_in: false, thinking: true, tool_use: true, max_context_tokens: 262_144 },
      'main-model': { image_in: false, video_in: false, audio_in: false, thinking: false, tool_use: true, max_context_tokens: 262_144 },
    }));

    expect(configured.description).toContain('Available models (pass via model):');
    expect(configured.description).toContain(
      '- secondary: provider/secondary (default) — the configured secondary model; prefer it for routine subagent tasks; capabilities: image_in, thinking, tool_use',
    );
    expect(configured.description).toContain(
      '- primary: main-model — the main model you are running on; use it for hard, quality-sensitive subagent tasks; capabilities: tool_use',
    );

    const unconfigured = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile({ modelAlias: 'main-model' }), stubModelCatalog());

    expect(unconfigured.description).not.toContain('Available models');
  });

  it('reads secondary capabilities from the derived entry when the recipe carries patch fields', async () => {
    const host = mockDynamicWorkflowHost();
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig({ model: 'provider/secondary', defaultEffort: 'low' }), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile({ modelAlias: 'main-model' }), stubModelCatalog({
      [SECONDARY_DERIVED_MODEL_ID]: { image_in: false, video_in: false, audio_in: false, thinking: true, tool_use: true, max_context_tokens: 131_072 },
      'main-model': { image_in: true, video_in: false, audio_in: false, thinking: false, tool_use: true, max_context_tokens: 262_144 },
    }));

    expect(tool.description).toContain(
      '- secondary: provider/secondary (default) — the configured secondary model; prefer it for routine subagent tasks; capabilities: thinking, tool_use',
    );
    expect(tool.description).toContain('capabilities: image_in, tool_use');
  });

  it('omits the capabilities suffix for models the catalog cannot resolve', async () => {
    const host = mockDynamicWorkflowHost();
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig({ model: 'provider/secondary' }), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile({ modelAlias: 'main-model' }), stubModelCatalog());

    expect(tool.description).toContain('- secondary: provider/secondary (default)');
    expect(tool.description).toContain('- primary: main-model');
    expect(tool.description).not.toContain('capabilities:');
  });

  it('omits resume hint when incomplete subagents have no agent ids', async () => {
    const host = mockDynamicWorkflowHost({
      run: vi.fn().mockImplementation(async ({ tasks }) => [
        {
          task: tasks[0],
          status: 'failed',
          error: 'Agent did not start.',
        },
        {
          task: tasks[1],
          status: 'failed',
          error: 'Agent also did not start.',
        },
      ]),
    });
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: ['src/a.ts', 'src/b.ts'],
      }),
    );

    expect(result.output).toBe(
      [
        '<agent_dynamic_workflow_result>',
        '<summary>failed: 2</summary>',
        '<subagent item="src/a.ts" outcome="failed">Agent did not start.</subagent>',
        '<subagent item="src/b.ts" outcome="failed">Agent also did not start.</subagent>',
        '</agent_dynamic_workflow_result>',
      ].join('\n'),
    );
  });

  it('reports partial aborted subagents inside the XML result', async () => {
    const host = mockDynamicWorkflowHost({
      run: vi.fn().mockImplementation(async ({ tasks }) => [
        {
          task: tasks[0],
          agentId: 'agent-coder-1',
          status: 'completed',
          result: 'imports are stable',
        },
        {
          task: tasks[1],
          agentId: 'agent-coder-2',
          status: 'aborted',
          state: 'started',
          error: 'The user manually interrupted this subagent batch before this subagent finished.',
        },
        {
          task: tasks[2],
          status: 'aborted',
          state: 'not_started',
          error:
            'The user manually interrupted this subagent batch before this subagent was started.',
        },
      ]),
    });
    const tool = new AgentDynamicWorkflowTool(host.dynamic_workflowService, makeAgentScopeContext({ agentId: host.callerAgentId, agentScope: '' }), mockDynamicWorkflowMode(), stubConfig(), stubFlag(true), stubDynamicWorkflowCatalog(), stubCallerProfile(), stubModelCatalog());

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      }),
    );

    expect(result.output).toBe(
      [
        '<agent_dynamic_workflow_result>',
        '<summary>completed: 1, aborted: 2</summary>',
        '<resume_hint>Call AgentDynamicWorkflow with resume_agent_ids using the agent_id values in this result to continue unfinished work.</resume_hint>',
        '<subagent agent_id="agent-coder-1" item="src/a.ts" outcome="completed">imports are stable</subagent>',
        '<subagent agent_id="agent-coder-2" item="src/b.ts" state="started" outcome="aborted">The user manually interrupted this subagent batch before this subagent finished.</subagent>',
        '<subagent item="src/c.ts" state="not_started" outcome="aborted">The user manually interrupted this subagent batch before this subagent was started.</subagent>',
        '</agent_dynamic_workflow_result>',
      ].join('\n'),
    );
    expect(result.isError).toBeUndefined();
  });
});
