import { ITelemetryService } from '#/app/telemetry/telemetry';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { Event } from '#/_base/event';
import { LifecycleScope } from '#/app/scopes';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import type { AgentContext } from '#/agent/agentContext/agentContext';
import { IConfigService } from '#/app/config/config';
import { IFlagService } from '#/app/flag/flag';
import { ILogService } from '#/_base/log/log';
import {
  normalizeAgentProfile,
  type AgentProfile,
} from '#/app/agentProfileCatalog/agentProfileCatalog';
import { IAgentProfileService, type ProfileData } from '#/agent/profile/profile';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { IAgentUserToolService } from '#/agent/userTool/userTool';
import { IAgentRuntimeService } from '#/agent/runtimeBinding/agentRuntime';
import { Error2, ErrorCodes, isError2 } from '#/errors';
import { UNKNOWN_CAPABILITY } from '#/kosong/contract/capability';
import { IModelCatalog, type Model } from '#/kosong/model/catalog';
import type { RuntimeLease } from '#/runtime/runtime';
import { FakeRuntime } from '#/runtime/fakeRuntime';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { ISessionAgentProfileCatalog } from '#/session/sessionAgentProfileCatalog/sessionAgentProfileCatalog';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { SECONDARY_MODEL_SECTION } from '#/session/subagent/configSection';
import { SECONDARY_MODEL_FLAG_ID } from '#/session/subagent/flag';
import { ISessionSubagentService } from '#/session/subagent/subagent';
import { SessionSubagentService } from '#/session/subagent/subagentService';
import {
  IAgentBindingProvenanceService,
  type IAgentBindingProvenanceService as AgentBindingProvenanceServiceContract,
} from '#/session/subagent/bindingProvenance';
import type { SubagentBindingProvenance } from '#/session/subagent/routing';
import { ISubagentModelPolicyService } from '#/session/subagent/subagentModelPolicy';
import { SubagentModelPolicyService } from '#/session/subagent/subagentModelPolicyService';
import {
  ISubagentRoutingService,
  SessionSubagentRoutingService,
} from '#/session/subagent/subagentRoutingService';
import {
  FORK_CONTEXT_NOTICE,
  FORK_WITH_THINKING_UNAVAILABLE,
  type SpawnedSubagent,
  type SpawnSubagentOptions,
  type SubagentSpawnPlan,
  type SubagentSpawnPlanInput,
} from '#/session/subagent/spawn';

import { stubLog } from '../../_base/log/stubs';
import { stubFlag } from '../../app/flag/stubs';
import { StubConfigService } from '../../kosong/stubs';
import { stubAgentContext } from '../../agent/agentContext/stubs';

const CALLER_ID = 'main';

describe('SessionSubagentService planSpawn and spawn', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let callerData: ProfileData;
  let profiles: AgentProfile[];
  let modelIds: Set<string>;
  let modelMeta: Map<string, Partial<Model>>;
  let caller: IAgentScopeHandle;
  let createdHandles: Map<string, IAgentScopeHandle>;
  let recordedProvenance: Map<string, SubagentBindingProvenance[]>;
  let telemetry: ITelemetryService;
  let createAgent: ReturnType<typeof vi.fn>;
  let forkAgent: ReturnType<typeof vi.fn>;
  let removeAgent: ReturnType<typeof vi.fn>;
  let acquireRuntime: ReturnType<typeof vi.fn>;
  let callerPermissionMode: { mode: string; setMode: ReturnType<typeof vi.fn> };
  let createdPermissionMode: { mode: string; setMode: ReturnType<typeof vi.fn> };
  let callerUserTools: IAgentUserToolService;
  let createdUserTools: IAgentUserToolService;
  let lease: RuntimeLease;

  function userToolsStub(): IAgentUserToolService {
    return {
      _serviceBrand: undefined,
      list: () => [],
      inheritUserTools: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
    } as unknown as IAgentUserToolService;
  }

  function profileServiceStub(data: ProfileData): IAgentProfileService {
    return {
      _serviceBrand: undefined,
      data: () => data,
      getActiveToolNames: () => data.activeToolNames,
    } as unknown as IAgentProfileService;
  }

  function createdHandle(agentId: string): IAgentScopeHandle {
    return {
      id: agentId,
      kind: LifecycleScope.Agent,
      accessor: {
        get: (serviceId: unknown) => {
          if (serviceId === IAgentProfileService) {
            return profileServiceStub({ ...callerData, modelCapabilities: {} as never });
          }
          if (serviceId === IAgentPermissionModeService) return createdPermissionMode;
          if (serviceId === IAgentUserToolService) return createdUserTools;
          if (serviceId === IAgentScopeContext) {
            return {
              _serviceBrand: undefined,
              agentId,
              agentContext: stubAgentContext(agentId, 1),
              scope: () => '',
            };
          }
          if (serviceId === IAgentBindingProvenanceService) {
            return {
              _serviceBrand: undefined,
              current: () => recordedProvenance.get(agentId)?.at(-1),
              record: (provenance: SubagentBindingProvenance) => {
                recordedProvenance.set(agentId, [...(recordedProvenance.get(agentId) ?? []), provenance]);
              },
            } satisfies AgentBindingProvenanceServiceContract;
          }
          return undefined;
        },
      } as IAgentScopeHandle['accessor'],
      dispose: () => {},
    };
  }

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    callerData = {
      profileName: 'orchestrator',
      modelAlias: 'main-model',
      thinkingLevel: 'high',
      systemPrompt: 'caller prompt',
      modelCapabilities: {} as never,
    };
    profiles = [
      normalizeAgentProfile({
        name: 'coder',
        description: 'Coder',
        systemPrompt: () => 'coder',
      }),
      normalizeAgentProfile({
        name: 'explore',
        description: 'Explorer',
        systemPrompt: () => 'explore',
      }),
    ];
    modelIds = new Set(['main-model']);
    modelMeta = new Map();
    callerPermissionMode = { mode: 'auto', setMode: vi.fn() };
    createdPermissionMode = { mode: 'manual', setMode: vi.fn() };
    callerUserTools = userToolsStub();
    createdUserTools = userToolsStub();
    lease = {
      runtime: new FakeRuntime({ workspaceId: 'w1', runtimeId: 'acp:s1', generation: 'g1' }),
      track: (resource) => resource,
      dispose: vi.fn(),
    };
    acquireRuntime = vi.fn(() => lease);
    caller = {
      id: CALLER_ID,
      kind: LifecycleScope.Agent,
      accessor: {
        get: (serviceId: unknown) => {
          if (serviceId === IAgentProfileService) return profileServiceStub(callerData);
          if (serviceId === IAgentPermissionModeService) return callerPermissionMode;
          if (serviceId === IAgentUserToolService) return callerUserTools;
          if (serviceId === IAgentRuntimeService) {
            return {
              _serviceBrand: undefined,
              acquire: acquireRuntime,
            };
          }
          if (serviceId === IAgentScopeContext) {
            return {
              _serviceBrand: undefined,
              agentId: CALLER_ID,
              agentContext: stubAgentContext(CALLER_ID, 1),
              scope: () => '',
            };
          }
          return undefined;
        },
      } as IAgentScopeHandle['accessor'],
      dispose: () => {},
    };
    createdHandles = new Map();
    recordedProvenance = new Map();
    telemetry = { _serviceBrand: undefined, track2: vi.fn(), track: vi.fn() } as unknown as ITelemetryService;
    createAgent = vi.fn(async (input: { readonly agentId?: string } = {}) => {
      const agentId = input.agentId ?? 'agent-child';
      createdHandles.set(agentId, createdHandle(agentId));
      return stubAgentContext(agentId, 1);
    });
    forkAgent = vi.fn(async () => {
      createdHandles.set('agent-fork', createdHandle('agent-fork'));
      return stubAgentContext('agent-fork', 1);
    });
    removeAgent = vi.fn(async (agent: { readonly agentId: string }) => {
      createdHandles.delete(agent.agentId);
    });
    ix.stub(IAgentLifecycleService, {
      _serviceBrand: undefined,
      onDidCreate: Event.None,
      onDidCreateScope: Event.None,
      onWillClose: Event.None,
      onDidClose: Event.None,
      create: createAgent,
      fork: forkAgent,
      get: (agentId: string) => (agentId === CALLER_ID ? stubAgentContext(CALLER_ID, 1) : undefined),
      handleOf: (agentId: string) =>
        agentId === CALLER_ID ? caller : createdHandles.get(agentId),
      list: () => [stubAgentContext(CALLER_ID, 1)],
      remove: removeAgent,
      broadcastPermissionMode: () => {},
    } as unknown as IAgentLifecycleService);
    ix.stub(ISessionAgentProfileCatalog, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: Event.None,
      get: (name: string) => profiles.find((profile) => profile.name === name),
      getDefault: () => profiles[0]!,
      list: () => profiles,
      inspect: (name: string) =>
        profiles.some((profile) => profile.name === name) ? { sourceId: 'builtin' } : undefined,
    } as unknown as ISessionAgentProfileCatalog);
    ix.stub(IModelCatalog, {
      _serviceBrand: undefined,
      get: (alias: string) => {
        if (!modelIds.has(alias)) {
          throw new Error2(
            ErrorCodes.CONFIG_INVALID,
            `Model "${alias}" is not configured in config.toml.`,
            { details: { model: alias } },
          );
        }
        return { id: alias, ...modelMeta.get(alias) } as Model;
      },
    } as unknown as IModelCatalog);
    ix.stub(ISessionContext, { _serviceBrand: undefined, cwd: '/repo' } as unknown as ISessionContext);
    ix.stub(ILogService, stubLog());
  });

  afterEach(() => {
    disposables.dispose();
  });

  function service(
    configValues: Record<string, unknown> = {},
    secondaryModelEnabled = false,
  ): ISessionSubagentService {
    ix.stub(IConfigService, new StubConfigService(configValues));
    ix.stub(
      IFlagService,
      stubFlag((id) => secondaryModelEnabled && id === SECONDARY_MODEL_FLAG_ID),
    );
    ix.stub(ITelemetryService, telemetry);
    ix.set(ISubagentModelPolicyService, new SyncDescriptor(SubagentModelPolicyService));
    ix.set(ISubagentRoutingService, new SyncDescriptor(SessionSubagentRoutingService));
    ix.set(ISessionSubagentService, new SyncDescriptor(SessionSubagentService));
    return ix.get(ISessionSubagentService);
  }

  async function planSpawnError(
    svc: ISessionSubagentService,
    input: SubagentSpawnPlanInput,
  ): Promise<Error2> {
    try {
      await svc.planSpawn(input);
    } catch (error) {
      if (!isError2(error)) throw error;
      return error;
    }
    throw new Error('planSpawn did not throw');
  }

  async function spawnError(
    svc: ISessionSubagentService,
    options: SpawnSubagentOptions,
  ): Promise<Error2> {
    try {
      await svc.spawn(options);
    } catch (error) {
      if (!isError2(error)) throw error;
      return error;
    }
    throw new Error('spawn did not throw');
  }

  function spawnNonForkChild(svc: ISessionSubagentService): Promise<SpawnedSubagent> {
    return svc.spawn({
      callerAgentId: CALLER_ID,
      plan: { profileName: 'coder', model: 'provider/fast', thinking: 'low', fork: false },
      labels: { parentAgentId: 'main' },
      prompt: 'Review the file',
    });
  }

  function spawnForkChild(svc: ISessionSubagentService): Promise<SpawnedSubagent> {
    return svc.spawn({
      callerAgentId: CALLER_ID,
      plan: { profileName: 'orchestrator', model: 'main-model', thinking: 'high', fork: true },
      labels: { parentAgentId: 'main' },
      prompt: 'Continue the analysis',
    });
  }

  it('rejects an unknown subagent type', async () => {
    const svc = service();

    const error = await planSpawnError(svc, { callerAgentId: CALLER_ID, profileName: 'ghost' });

    expect(error.code).toBe(ErrorCodes.PROFILE_UNKNOWN);
    expect(error.message).toBe('Unknown agent type: "ghost"');
  });

  it('rejects a subagent type outside the caller allowlist', async () => {
    callerData = { ...callerData, subagents: ['explore'] };
    const svc = service();

    const error = await planSpawnError(svc, { callerAgentId: CALLER_ID, profileName: 'coder' });

    expect(error.code).toBe(ErrorCodes.AGENT_TYPE_NOT_ALLOWED);
    expect(error.message).toBe(
      'Subagent type "coder" is not allowed for this agent. Allowed subagent types: explore.',
    );
  });

  it('allows a known internal profile through an explicit trusted route', async () => {
    profiles.push(
      normalizeAgentProfile({
        name: 'tower-worker',
        description: 'Tower worker',
        systemPrompt: () => 'tower worker',
      }),
    );
    callerData = { ...callerData, subagents: ['explore'] };
    const svc = service();

    await expect(
      svc.planSpawn({
        callerAgentId: CALLER_ID,
        profileName: 'tower-worker',
        allowUnlistedProfile: true,
      }),
    ).resolves.toMatchObject({ profileName: 'tower-worker', model: 'main-model' });
  });

  it('rejects when the caller agent has no model bound', async () => {
    callerData = { ...callerData, modelAlias: undefined };
    const svc = service();

    const error = await planSpawnError(svc, { callerAgentId: CALLER_ID, profileName: 'coder' });

    expect(error.code).toBe(ErrorCodes.MODEL_NOT_CONFIGURED);
    expect(error.message).toBe('Caller agent has no model bound');
  });

  it('wraps an unresolvable pool model with the secondary-model config hint', async () => {
    const svc = service(
      {
        [SECONDARY_MODEL_SECTION]: {
          defaultModel: 'provider/bad',
          models: { 'provider/bad': 'broken' },
        },
      },
      true,
    );

    const error = await planSpawnError(svc, { callerAgentId: CALLER_ID, profileName: 'coder' });

    expect(error.code).toBe(ErrorCodes.CONFIG_INVALID);
    expect(error.message).toContain('Model "provider/bad" is not configured in config.toml.');
    expect(error.message).toContain('comes from [secondary_model.models]');
  });

  it('uses the section effort for a secondary-bound subagent', async () => {
    modelIds.add('provider/fast');
    modelMeta.set('provider/fast', {
      capabilities: { ...UNKNOWN_CAPABILITY, thinking: true },
      supportEfforts: ['low', 'high', 'max'],
      defaultEffort: 'high',
    });
    const svc = service(
      {
        [SECONDARY_MODEL_SECTION]: {
          defaultModel: 'provider/fast',
          models: { 'provider/fast': 'fast model' },
          defaultEffort: 'max',
        },
        thinking: { enabled: false },
      },
      true,
    );

    expect(await svc.planSpawn({ callerAgentId: CALLER_ID, profileName: 'coder' })).toMatchObject({
      profileName: 'coder',
      model: 'provider/fast',
      thinking: 'max',
      fork: false,
    });
  });

  it('hands the planned routing provenance to the created child, for spawn and fork', async () => {
    const svc = service();
    const plan = await svc.planSpawn({ callerAgentId: CALLER_ID, profileName: 'coder' });
    expect(plan.routing).toMatchObject({ operation: 'spawn', modelSource: 'caller', policyMode: 'inherit' });
    await svc.spawn({ callerAgentId: CALLER_ID, plan, prompt: 'do it' });
    expect(recordedProvenance.get('agent-child')).toEqual([plan.routing]);

    const forkPlan = await svc.planSpawn({ callerAgentId: CALLER_ID, fork: true });
    expect(forkPlan.routing).toMatchObject({ operation: 'fork', profileSource: 'fork-inherit', modelSource: 'fork-inherit' });
    await svc.spawn({ callerAgentId: CALLER_ID, plan: forkPlan, prompt: 'forked' });
    expect(recordedProvenance.get('agent-fork')).toEqual([forkPlan.routing]);
  });

  it('falls back to the bound model default effort', async () => {
    modelIds.add('provider/fast');
    modelMeta.set('provider/fast', {
      capabilities: { ...UNKNOWN_CAPABILITY, thinking: true },
      supportEfforts: ['low', 'high', 'max'],
      defaultEffort: 'max',
    });
    const svc = service(
      {
        [SECONDARY_MODEL_SECTION]: {
          defaultModel: 'provider/fast',
          models: { 'provider/fast': 'fast model' },
        },
      },
      true,
    );

    expect((await svc.planSpawn({ callerAgentId: CALLER_ID, profileName: 'coder' })).thinking).toBe(
      'max',
    );
  });

  it('keeps thinking unset when global thinking is disabled', async () => {
    modelIds.add('provider/fast');
    modelMeta.set('provider/fast', {
      capabilities: { ...UNKNOWN_CAPABILITY, thinking: true },
      supportEfforts: ['low', 'high', 'max'],
      defaultEffort: 'max',
    });
    const svc = service(
      {
        [SECONDARY_MODEL_SECTION]: {
          defaultModel: 'provider/fast',
          models: { 'provider/fast': 'fast model' },
        },
        thinking: { enabled: false },
      },
      true,
    );

    expect(
      (await svc.planSpawn({ callerAgentId: CALLER_ID, profileName: 'coder' })).thinking,
    ).toBeUndefined();
  });

  it('ignores an invalid bound model default effort', async () => {
    modelIds.add('provider/fast');
    modelMeta.set('provider/fast', {
      capabilities: { ...UNKNOWN_CAPABILITY, thinking: true },
      supportEfforts: ['low', 'high'],
      defaultEffort: 'max',
    });
    const svc = service(
      {
        [SECONDARY_MODEL_SECTION]: {
          defaultModel: 'provider/fast',
          models: { 'provider/fast': 'fast model' },
        },
      },
      true,
    );

    expect(
      (await svc.planSpawn({ callerAgentId: CALLER_ID, profileName: 'coder' })).thinking,
    ).toBeUndefined();
  });

  it('uses the section effort with a forced secondary model', async () => {
    modelIds.add('provider/fast');
    const svc = service(
      {
        [SECONDARY_MODEL_SECTION]: {
          force: true,
          defaultModel: 'provider/fast',
          defaultEffort: 'max',
        },
      },
      true,
    );

    expect(await svc.planSpawn({ callerAgentId: CALLER_ID, profileName: 'coder' })).toMatchObject({
      profileName: 'coder',
      model: 'provider/fast',
      thinking: 'max',
      fork: false,
    });
  });

  it('treats a preferred model as a fallback under a forced policy', async () => {
    modelIds.add('provider/fast');
    const svc = service(
      {
        [SECONDARY_MODEL_SECTION]: {
          force: true,
          defaultModel: 'provider/fast',
        },
      },
      true,
    );

    await expect(
      svc.planSpawn({
        callerAgentId: CALLER_ID,
        profileName: 'coder',
        preferredModel: 'primary',
      }),
    ).resolves.toMatchObject({ model: 'provider/fast', routing: { modelSource: 'policy-force' } });
  });

  it('skips the allowlist check when forking', async () => {
    callerData = { ...callerData, profileName: 'coder', subagents: ['explore'] };
    const svc = service();

    const plan = await svc.planSpawn({ callerAgentId: CALLER_ID, fork: true });

    expect(plan.profileName).toBe('coder');
  });

  it('skips the unknown-profile check when forking', async () => {
    callerData = { ...callerData, profileName: 'ghost' };
    const svc = service();

    const plan = await svc.planSpawn({ callerAgentId: CALLER_ID, fork: true });

    expect(plan.profileName).toBe('ghost');
  });

  it('returns the caller binding when forking', async () => {
    const svc = service();

    const plan = await svc.planSpawn({ callerAgentId: CALLER_ID, fork: true });

    expect(plan).toMatchObject({
      profileName: 'orchestrator',
      model: 'main-model',
      thinking: 'high',
      fork: true,
    });
  });

  it('rejects a direct fork plan with a different thinking level', async () => {
    const svc = service();

    const error = await planSpawnError(svc, {
      callerAgentId: CALLER_ID,
      fork: true,
      thinking: 'low',
    });

    expect(error.code).toBe(ErrorCodes.VALIDATION_FAILED);
    expect(error.message).toBe(FORK_WITH_THINKING_UNAVAILABLE);
  });

  it('creates the child with the plan binding when the plan is not a fork', async () => {
    const svc = service();

    await spawnNonForkChild(svc);

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        binding: { profile: 'coder', model: 'provider/fast', thinking: 'low' },
      }),
    );
    expect(forkAgent).not.toHaveBeenCalled();
  });

  it('creates the child with the task labels when the plan is not a fork', async () => {
    const svc = service();

    await spawnNonForkChild(svc);

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ labels: { parentAgentId: 'main' } }),
    );
  });

  it('creates the child on the acquired runtime lease', async () => {
    const svc = service();

    await spawnNonForkChild(svc);

    expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: 'acp:s1' }));
  });

  it('inherits the caller permission mode and user tools', async () => {
    const svc = service();

    await spawnNonForkChild(svc);

    expect(createdPermissionMode.setMode).toHaveBeenCalledWith('auto');
    expect(createdUserTools.inheritUserTools).toHaveBeenCalledWith(callerUserTools);
  });

  it('applies the profile prompt prefix to the spawned prompt', async () => {
    profiles = [
      normalizeAgentProfile({
        name: 'coder',
        description: 'Coder',
        promptPrefix: async () => 'FIXED-PREFIX',
        systemPrompt: () => 'coder',
      }),
    ];
    const svc = service();

    const spawned = await spawnNonForkChild(svc);

    expect(spawned).toEqual({
      agentId: 'agent-child',
      profileName: 'coder',
      model: 'provider/fast',
      promptText: 'FIXED-PREFIX\n\nReview the file',
    });
  });

  it('creates and reports the child after async prompt-prefix setup completes', async () => {
    let resolvePrefix!: (value: string) => void;
    const prefix = new Promise<string>((resolve) => {
      resolvePrefix = resolve;
    });
    profiles = [
      normalizeAgentProfile({
        name: 'coder',
        description: 'Coder',
        promptPrefix: async () => prefix,
        systemPrompt: () => 'coder',
      }),
    ];
    const onAgentCreated = vi.fn();
    const svc = service();
    const spawning = svc.spawn({
      callerAgentId: CALLER_ID,
      plan: { profileName: 'coder', model: 'provider/fast', thinking: 'low', fork: false },
      labels: { parentAgentId: 'main' },
      prompt: 'Review the file',
      onAgentCreated,
    });

    expect(onAgentCreated).not.toHaveBeenCalled();
    expect(createAgent).not.toHaveBeenCalled();
    resolvePrefix('FIXED-PREFIX');
    await expect(spawning).resolves.toMatchObject({ agentId: 'agent-child' });
    expect(onAgentCreated).toHaveBeenCalledWith('agent-child');
  });

  it('does not create a child when cancellation interrupts prompt-prefix setup', async () => {
    let resolvePrefix!: (value: string) => void;
    const prefix = new Promise<string>((resolve) => {
      resolvePrefix = resolve;
    });
    profiles = [
      normalizeAgentProfile({
        name: 'coder',
        description: 'Coder',
        promptPrefix: async () => prefix,
        systemPrompt: () => 'coder',
      }),
    ];
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const onAgentCreated = vi.fn();
    const svc = service();
    const spawning = svc.spawn({
      callerAgentId: CALLER_ID,
      plan: { profileName: 'coder', model: 'provider/fast', thinking: 'low', fork: false },
      prompt: 'Review the file',
      signal: controller.signal,
      onAgentCreated,
    });

    controller.abort(reason);
    resolvePrefix('FIXED-PREFIX');

    await expect(spawning).rejects.toBe(reason);
    expect(createAgent).not.toHaveBeenCalled();
    expect(onAgentCreated).not.toHaveBeenCalled();
  });

  it('removes a child created while cancellation is pending', async () => {
    let resolveCreate!: (agent: AgentContext) => void;
    const creating = new Promise<AgentContext>((resolve) => {
      resolveCreate = (agent) => {
        createdHandles.set(agent.agentId, createdHandle(agent.agentId));
        resolve(agent);
      };
    });
    createAgent.mockReturnValueOnce(creating);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const onAgentCreated = vi.fn();
    const svc = service();
    const spawning = svc.spawn({
      callerAgentId: CALLER_ID,
      plan: { profileName: 'coder', model: 'provider/fast', thinking: 'low', fork: false },
      prompt: 'Review the file',
      signal: controller.signal,
      onAgentCreated,
    });
    await vi.waitFor(() => {
      expect(createAgent).toHaveBeenCalledOnce();
    });

    controller.abort(reason);
    resolveCreate(stubAgentContext('agent-child', 1));

    await expect(spawning).rejects.toBe(reason);
    expect(removeAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-child' }));
    expect(createdHandles.has('agent-child')).toBe(false);
    expect(onAgentCreated).not.toHaveBeenCalled();
  });

  it('releases the runtime lease after spawn', async () => {
    const svc = service();

    await spawnNonForkChild(svc);

    expect(lease.dispose).toHaveBeenCalled();
  });

  it('removes a created child when post-create setup fails', async () => {
    createdPermissionMode.setMode.mockImplementationOnce(() => {
      throw new Error('permission setup failed');
    });
    const onAgentCreated = vi.fn();
    const svc = service();

    await expect(
      svc.spawn({
        callerAgentId: CALLER_ID,
        plan: { profileName: 'coder', model: 'provider/fast', thinking: 'low', fork: false },
        prompt: 'Review the file',
        onAgentCreated,
      }),
    ).rejects.toThrow('permission setup failed');

    expect(removeAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-child' }));
    expect(createdHandles.has('agent-child')).toBe(false);
    expect(onAgentCreated).not.toHaveBeenCalled();
  });

  it('removes a child when creation returns without an agent scope', async () => {
    createAgent.mockResolvedValueOnce(stubAgentContext('agent-missing', 1));
    const svc = service();

    await expect(spawnNonForkChild(svc)).rejects.toMatchObject({
      code: ErrorCodes.AGENT_NOT_FOUND,
      details: { agentId: 'agent-missing' },
    });

    expect(removeAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-missing' }));
  });

  it('delegates to manager.fork with the caller labels when the plan is a fork', async () => {
    const svc = service();

    await spawnForkChild(svc);

    expect(forkAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'main' }),
      { labels: { parentAgentId: 'main' } },
    );
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('preserves the fork snapshot active tool names when inheriting user tools', async () => {
    callerData = { ...callerData, activeToolNames: ['Agent', 'Read'] };
    const svc = service();

    await spawnForkChild(svc);

    expect(createdUserTools.inheritUserTools).toHaveBeenCalledWith(callerUserTools, [
      'Agent',
      'Read',
    ]);
  });

  it('prefixes the prompt with the fork notice when the plan is a fork', async () => {
    const svc = service();

    const spawned = await spawnForkChild(svc);

    expect(spawned).toEqual({
      agentId: 'agent-fork',
      profileName: 'orchestrator',
      model: 'main-model',
      promptText: `${FORK_CONTEXT_NOTICE}\n\nContinue the analysis`,
    });
  });

  it('does not require the process capability when forking', async () => {
    acquireRuntime.mockImplementation(() => {
      throw new Error('process capability is no longer available');
    });
    const svc = service();

    await expect(spawnForkChild(svc)).resolves.toMatchObject({ agentId: 'agent-fork' });

    expect(acquireRuntime).not.toHaveBeenCalled();
    expect(forkAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'main' }),
      { labels: { parentAgentId: 'main' } },
    );
  });

  it('wraps a create rejection with the secondary-model config hint', async () => {
    createAgent.mockRejectedValueOnce(
      new Error2(
        ErrorCodes.CONFIG_INVALID,
        'Model "provider/bad" is not configured in config.toml.',
        { details: { model: 'provider/bad' } },
      ),
    );
    const svc = service();

    const error = await spawnError(svc, {
      callerAgentId: CALLER_ID,
      plan: { profileName: 'coder', model: 'provider/bad', thinking: 'low', fork: false },
      prompt: 'Review the file',
    });

    expect(error.code).toBe(ErrorCodes.CONFIG_INVALID);
    expect(error.message).toContain('Model "provider/bad" is not configured in config.toml.');
    expect(error.message).toContain('comes from [secondary_model.models]');
  });

  it('spawn throws before creating anything when the caller runtime lease fails', async () => {
    acquireRuntime.mockImplementation(() => {
      throw new Error('process capability is no longer available');
    });
    const svc = service();
    const plan: SubagentSpawnPlan = {
      profileName: 'coder',
      model: 'main-model',
      thinking: 'high',
      fork: false,
    };

    await expect(
      svc.spawn({ callerAgentId: CALLER_ID, plan, prompt: 'Review the file' }),
    ).rejects.toThrow('process capability is no longer available');

    expect(createAgent).not.toHaveBeenCalled();
    expect(forkAgent).not.toHaveBeenCalled();
  });
});
