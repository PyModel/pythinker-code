import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import type { PermissionMode } from '#/agent/permissionPolicy/types';
import type { AgentContext } from '#/agent/agentContext/agentContext';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentTaskService } from '#/agent/task/task';
import { TowerStore } from '#/features/tower/protocol/index';
import { IAgentTowerService } from '#/features/tower/tower';
import { ITowerRateLimitService } from '#/features/tower/towerRateLimit';
import { SubagentTask } from '#/agent/tools/agent/subagent-task';
import { ITowerSpawnTool, type TowerSpawnToolInput } from '#/features/tower/tools/spawn/spawn';
import { TowerSpawnTool } from '#/features/tower/tools/spawn/spawnTool';
import { IConfigService } from '#/app/config/config';
import { IEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { IFlagService } from '#/app/flag/flag';
import { UNKNOWN_CAPABILITY } from '#/kosong/contract/capability';
import { IModelCatalog, type Model } from '#/kosong/model/catalog';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import {
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  SECONDARY_MODEL_SECTION,
} from '#/session/subagent/configSection';
import { SECONDARY_MODEL_FLAG_ID } from '#/session/subagent/flag';
import {
  ISessionSubagentService,
  type AgentRunHandle,
} from '#/session/subagent/subagent';
import type {
  SpawnSubagentOptions,
  SubagentSpawnPlanInput,
} from '#/session/subagent/spawn';
import type { ExecutableToolResult } from '#/tool/toolContract';

import { executeTool } from '../../../tools/fixtures/execute-tool';
import { stubAgentContext } from '../../../agent/agentContext/stubs';

const execFileAsync = promisify(execFile);
const signal = new AbortController().signal;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TowerSpawnTool', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let repo: string;
  let store: TowerStore;

  let towerActive: boolean;
  let gate: { readonly ok: true } | { readonly ok: false; readonly reason: string };
  let release: Mock<() => void>;
  let createAgent: Mock<IAgentLifecycleService['create']>;
  let planSpawn: ReturnType<typeof vi.fn>;
  let spawnAgent: ReturnType<typeof vi.fn>;
  let runAgent: Mock<ISessionSubagentService['run']>;
  let registerTask: Mock<IAgentTaskService['registerTask']>;
  let completion: Deferred<{ readonly summary: string }>;
  let secondaryFlagOn: boolean;
  let secondaryModel: { readonly model: string; readonly defaultEffort?: string } | undefined;
  let thinkingEnabled: boolean | undefined;
  let modelMeta: Record<string, Partial<Model>>;
  let createdSetMode: Mock<(mode: PermissionMode) => void>;

  async function git(cwd: string, ...args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd });
  }

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'tower-spawn-test-'));
    await git(repo, 'init', '-b', 'main');
    await git(repo, 'config', 'user.email', 'tower-test@example.com');
    await git(repo, 'config', 'user.name', 'Tower Test');
    await writeFile(join(repo, 'README.md'), '# fixture\n');
    await git(repo, 'add', 'README.md');
    await git(repo, 'commit', '-m', 'initial');
    store = new TowerStore(repo);
    await store.init();
    await store.plan([{ title: 'Build gemm', scope: ['src/**'] }]);

    towerActive = true;
    gate = { ok: true };
    release = vi.fn();
    completion = deferred();
    secondaryFlagOn = false;
    secondaryModel = undefined;
    thinkingEnabled = undefined;
    modelMeta = {};
    createdSetMode = vi.fn();
    createAgent = vi.fn(async () => stubAgentContext('agent-7', 1));
    planSpawn = vi.fn(async (input: SubagentSpawnPlanInput) => {
      const primary = input.preferredModel === 'primary';
      const model =
        primary || !secondaryFlagOn || secondaryModel === undefined
          ? 'pythinker-code'
          : secondaryModel.model;
      const thinking =
        thinkingEnabled === false
          ? undefined
          : primary || secondaryModel === undefined
            ? 'off'
            : secondaryModel.defaultEffort ?? modelMeta[model]?.defaultEffort;
      return {
        profileName: input.profileName ?? 'coder',
        model,
        thinking,
        fork: false,
      };
    });
    spawnAgent = vi.fn(async (options: SpawnSubagentOptions) => ({
      agentId: 'agent-7',
      profileName: options.plan.profileName,
      model: options.plan.model,
      promptText: options.prompt,
    }));
    runAgent = vi.fn(
      async (agent: AgentContext) =>
        ({
          agentId: agent.agentId,
          turn: undefined,
          completion: completion.promise,
        }) as unknown as AgentRunHandle,
    );
    registerTask = vi.fn(() => 'task-1');

    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.set(IEventBus, new SyncDescriptor(EventBusService));
    ix.stub(IAgentTowerService, {
      get isActive() {
        return towerActive;
      },
      enter: () => {},
      exit: () => {},
    } as unknown as IAgentTowerService);
    ix.stub(ITowerRateLimitService, {
      acquire: () => gate,
      release,
    } as unknown as ITowerRateLimitService);
    ix.stub(ISessionContext, { cwd: repo, sessionId: 'session-spawn-test' } as unknown as ISessionContext);
    ix.stub(IAgentScopeContext, { agentId: 'main', scope: (subKey?: string) => subKey ?? '' });
    const createdHandle = {
      id: 'agent-7',
      accessor: {
        get: (id: unknown) => {
          if (id === (IAgentPermissionModeService as unknown)) {
            return { setMode: createdSetMode };
          }
          if (id === (IAgentScopeContext as unknown)) {
            return {
              agentId: 'agent-7',
              agentContext: stubAgentContext('agent-7', 1),
            };
          }
          return undefined;
        },
      },
    } as never;
    const mainHandle = {
      id: 'main',
      accessor: {
        get: (id: unknown) =>
          id === (IEventBus as unknown)
            ? ix.get(IEventBus)
            : id === (IAgentLifecycleService as unknown)
              ? { list: () => [], handleOf: () => undefined }
              : undefined,
      },
    } as never;
    ix.stub(IAgentLifecycleService, {
      handleOf: (agentId: string) => {
        if (agentId === 'main') return mainHandle;
        if (agentId === 'agent-7') return createdHandle;
        return undefined;
      },
      create: createAgent,
    } as unknown as IAgentLifecycleService);
    ix.stub(ISessionSubagentService, {
      planSpawn,
      spawn: spawnAgent,
      run: runAgent,
    } as unknown as ISessionSubagentService);
    ix.stub(IAgentTaskService, { registerTask } as unknown as IAgentTaskService);
    ix.stub(IAgentProfileService, {
      data: () => ({ profileName: 'agent', modelAlias: 'pythinker-code', thinkingLevel: 'off' }),
    } as unknown as IAgentProfileService);
    ix.stub(IConfigService, {
      get: ((domain: string) =>
        domain === SECONDARY_MODEL_SECTION
          ? secondaryModel
          : domain === 'thinking' && thinkingEnabled !== undefined
            ? { enabled: thinkingEnabled }
            : undefined) as IConfigService['get'],
    });
    ix.stub(IFlagService, {
      enabled: (id: string) => id === SECONDARY_MODEL_FLAG_ID && secondaryFlagOn,
    } as unknown as IFlagService);
    ix.stub(IModelCatalog, {
      get: (alias: string) => ({ id: alias, ...modelMeta[alias] }) as Model,
    } as unknown as IModelCatalog);
    ix.set(ITowerSpawnTool, new SyncDescriptor(TowerSpawnTool));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    disposables.dispose();
    await rm(repo, { recursive: true, force: true });
  });

  function execute(args: TowerSpawnToolInput): Promise<ExecutableToolResult> {
    return executeTool(ix.get(ITowerSpawnTool), {
      args,
      turnId: 0,
      toolCallId: 'call_spawn',
      signal,
    });
  }

  const WORKER_ARGS: TowerSpawnToolInput = {
    name: 'agent-build',
    kind: 'worker',
    mission_id: 'M1',
  };

  it('refuses when tower mode is not active', async () => {
    towerActive = false;

    const result = await execute(WORKER_ARGS);

    expect(result).toEqual({
      output: 'tower mode is not active — run TowerInit first',
      isError: true,
    });
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('rejects non-main callers with the main-agent-only error before any work', async () => {
    ix.stub(IAgentScopeContext, { agentId: 'agent-w1', scope: (subKey?: string) => subKey ?? '' });

    const result = await execute(WORKER_ARGS);

    expect(result).toEqual({
      output: 'Tower orchestration tools are only supported by the main agent.',
      isError: true,
    });
    expect(createAgent).not.toHaveBeenCalled();
    expect(registerTask).not.toHaveBeenCalled();
  });

  it('surfaces the rate-limit reason as an error result', async () => {
    gate = { ok: false, reason: 'tower spawn paused: provider is rate-limiting' };

    const result = await execute(WORKER_ARGS);

    expect(result).toEqual({ output: gate.ok === false ? gate.reason : '', isError: true });
    expect(createAgent).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();

    const mission = (await store.load()).missions.find((m) => m.id === 'M1');
    expect(mission?.status).toBe('planned');
    expect(mission?.owner).toBeUndefined();
  });

  it('leaves the mission untouched when the launch fails', async () => {
    spawnAgent.mockRejectedValue(new Error('provider unavailable'));

    const result = await execute(WORKER_ARGS);

    expect(result).toEqual({ output: 'tower spawn failed: provider unavailable', isError: true });
    const state = await store.load();
    const mission = state.missions.find((m) => m.id === 'M1');
    expect(mission?.status).toBe('planned');
    expect(mission?.owner).toBeUndefined();
    expect(state.roster.agents).toHaveLength(0);
  });

  it('reports the child id when the first run cannot start', async () => {
    runAgent.mockRejectedValueOnce(new Error('start failed'));

    const result = await execute(WORKER_ARGS);

    expect(result).toEqual({
      output:
        'tower spawn failed after creating agent "agent-7": start failed\n' +
        'recover with Agent(resume="agent-7", prompt="continue")',
      isError: true,
    });
    expect(release).toHaveBeenCalledOnce();
    const state = await store.load();
    expect(state.roster.agents).toHaveLength(0);
  });

  it('reports the child id when detached task registration fails', async () => {
    registerTask.mockImplementationOnce(() => {
      throw new Error('task store unavailable');
    });

    const result = await execute(WORKER_ARGS);

    expect(result).toEqual({
      output:
        'tower task registration failed after creating agent "agent-7": task store unavailable\n' +
        'recover with Agent(resume="agent-7", prompt="continue") after the aborted run stops',
      isError: true,
    });
    expect((runAgent.mock.calls[0]?.[2] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    expect((await store.load()).roster.agents).toHaveLength(0);
  });

  it('reports the child id when roster registration fails', async () => {
    vi.spyOn(TowerStore.prototype, 'registerAgent').mockRejectedValueOnce(
      new Error('roster unavailable'),
    );

    const result = await execute(WORKER_ARGS);

    expect(result).toEqual({
      output:
        'tower roster registration failed after creating agent "agent-7": roster unavailable\n' +
        'recover with Agent(resume="agent-7", prompt="continue") after the aborted run stops',
      isError: true,
    });
    expect((runAgent.mock.calls[0]?.[2] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect((await store.load()).roster.agents).toHaveLength(0);
    completion.reject(new Error('aborted'));
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledOnce();
    });
  });

  it('keeps a registered child running when non-critical bookkeeping fails', async () => {
    vi.spyOn(TowerStore.prototype, 'updateMission').mockRejectedValueOnce(
      new Error('mission file unavailable'),
    );
    vi.spyOn(TowerStore.prototype, 'appendLog')
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('activity log unavailable'));

    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain(
      'mission status warning (agent is running): mission file unavailable',
    );
    expect(result.output).toContain(
      'activity log warning (agent is running): activity log unavailable',
    );
    expect((runAgent.mock.calls[0]?.[2] as { signal: AbortSignal }).signal.aborted).toBe(false);
    expect((await store.load()).roster.agents).toContainEqual(
      expect.objectContaining({ name: 'agent-build', agentId: 'agent-7' }),
    );
  });

  it('spawns a detached tower-worker, registers the roster entry, and releases the slot on settle', async () => {
    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    const worktreeAbs = join(repo, '.tower/worktrees/wt-1');
    expect(result.output).toContain('agent_id: agent-7');
    expect(result.output).toContain('task_id: task-1');
    expect(result.output).toContain('status: running');
    expect(result.output).toContain(`worktree: ${worktreeAbs}`);

    expect(planSpawn).toHaveBeenCalledWith({
      callerAgentId: 'main',
      profileName: 'tower-worker',
      allowUnlistedProfile: true,
      preferredModel: undefined,
    });
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        callerAgentId: 'main',
        plan: expect.objectContaining({ profileName: 'tower-worker', model: 'pythinker-code' }),
        labels: { parentAgentId: 'main' },
      }),
    );

    expect(createAgent).not.toHaveBeenCalled();
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-7' }),
      { kind: 'prompt', prompt: expect.stringContaining(worktreeAbs) },
      { signal: expect.any(AbortSignal) },
    );
    expect(registerTask).toHaveBeenCalledWith(expect.any(SubagentTask), {
      detached: true,
      timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
      signal: undefined,
    });

    const state = await store.load();
    const entry = state.roster.agents.find((agent) => agent.name === 'agent-build');
    expect(entry).toMatchObject({
      agentId: 'agent-7',
      sessionId: 'session-spawn-test',
      kind: 'worker',
      missionId: 'M1',
      worktree: 'wt-1',
      branch: 'feat/build-gemm',
    });
    const mission = state.missions.find((m) => m.id === 'M1');
    expect(mission?.status).toBe('active');
    expect(mission?.owner).toBe('agent-build');

    expect(release).not.toHaveBeenCalled();
    completion.resolve({ summary: 'worker done' });
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledTimes(1);
    });
  });

  it('pins the spawned agent to the auto permission mode', async () => {
    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(createdSetMode).toHaveBeenCalledWith('auto');
  });

  it('binds the configured secondary model and reports it in the output and activity log', async () => {
    secondaryFlagOn = true;
    secondaryModel = { model: 'cheap/fast' };

    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('model: cheap/fast');
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          profileName: 'tower-worker',
          model: 'cheap/fast',
          thinking: undefined,
        }),
      }),
    );
    const activityLog = await readFile(join(repo, '.tower/comms/log/activity.log'), 'utf8');
    expect(activityLog).toMatch(/spawn .*model=cheap\/fast/);
  });

  it('passes the secondary section effort to the spawned worker', async () => {
    secondaryFlagOn = true;
    secondaryModel = { model: 'cheap/fast', defaultEffort: 'low' };

    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          profileName: 'tower-worker',
          model: 'cheap/fast',
          thinking: 'low',
        }),
      }),
    );
  });

  it('falls back to the bound model default effort for a tower worker', async () => {
    secondaryFlagOn = true;
    secondaryModel = { model: 'cheap/fast' };
    modelMeta['cheap/fast'] = {
      capabilities: { ...UNKNOWN_CAPABILITY, thinking: true },
      supportEfforts: ['low', 'high', 'max'],
      defaultEffort: 'max',
    };

    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          profileName: 'tower-worker',
          model: 'cheap/fast',
          thinking: 'max',
        }),
      }),
    );
  });

  it('keeps tower worker thinking unset when global thinking is disabled', async () => {
    secondaryFlagOn = true;
    secondaryModel = { model: 'cheap/fast' };
    thinkingEnabled = false;
    modelMeta['cheap/fast'] = {
      capabilities: { ...UNKNOWN_CAPABILITY, thinking: true },
      supportEfforts: ['low', 'high', 'max'],
      defaultEffort: 'max',
    };

    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({
          profileName: 'tower-worker',
          model: 'cheap/fast',
          thinking: undefined,
        }),
      }),
    );
  });

  it('inherits the tower model when the secondary-model experiment is off', async () => {
    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('model: pythinker-code');
    const activityLog = await readFile(join(repo, '.tower/comms/log/activity.log'), 'utf8');
    expect(activityLog).toMatch(/spawn .*model=pythinker-code/);
  });

  it('binds reviewers to the tower model even when the secondary model is configured', async () => {
    secondaryFlagOn = true;
    secondaryModel = { model: 'cheap/fast' };

    const result = await execute({
      name: 'reviewer-a',
      kind: 'reviewer',
      review_target: 'feat/build-gemm',
    });

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('model: pythinker-code');
    expect(planSpawn).toHaveBeenCalledWith({
      callerAgentId: 'main',
      profileName: 'tower-worker',
      allowUnlistedProfile: true,
      preferredModel: 'primary',
    });
  });

  it('registers a reviewer without a worktree', async () => {
    const result = await execute({
      name: 'reviewer-a',
      kind: 'reviewer',
      review_target: 'feat/build-gemm',
    });

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('review_target: feat/build-gemm');
    const state = await store.load();
    const entry = state.roster.agents.find((agent) => agent.name === 'reviewer-a');
    expect(entry).toMatchObject({
      agentId: 'agent-7',
      kind: 'reviewer',
      reviewTarget: 'feat/build-gemm',
    });
    expect(entry?.worktree).toBeUndefined();
  });

  it('refuses a duplicate name and points at resume', async () => {
    await store.registerAgent({
      name: 'agent-build',
      agentId: 'agent-old',
      kind: 'worker',
      missionId: 'M1',
      worktree: 'wt-1',
      branch: 'feat/build-gemm',
      spawnedAt: new Date().toISOString(),
    });

    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBe(true);
    expect(result.output).toContain('already registered');
    expect(result.output).toContain('Agent(resume="agent-old"');
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('snapshots base WIP into the worker branch and records the spawn base', async () => {
    await writeFile(join(repo, 'wip.ts'), 'export const wip = 1;\n');

    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('base snapshot:');
    const worktreeAbs = join(repo, '.tower/worktrees/wt-1');
    expect(await readFile(join(worktreeAbs, 'wip.ts'), 'utf8')).toBe('export const wip = 1;\n');
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-7' }),
      { kind: 'prompt', prompt: expect.stringContaining('snapshot commit') },
      { signal: expect.any(AbortSignal) },
    );
    const mission = (await store.load()).missions.find((m) => m.id === 'M1');
    expect(mission?.spawnBase).toBeDefined();
  });

  it('bases the reviewer prompt on the base branch once a rebase drops the snapshot', async () => {
    await writeFile(join(repo, 'wip.ts'), 'export const wip = 1;\n');
    const workerResult = await execute(WORKER_ARGS);
    expect(workerResult.isError).toBeUndefined();
    const snapshot = (await store.load()).missions.find((m) => m.id === 'M1')?.spawnBase;
    expect(snapshot).toBeDefined();
    const worktreeAbs = join(repo, '.tower/worktrees/wt-1');

    await git(repo, 'add', 'wip.ts');
    await git(repo, 'commit', '-m', 'commit my wip');
    await git(worktreeAbs, 'rebase', 'main');
    await expect(
      git(worktreeAbs, 'merge-base', '--is-ancestor', snapshot!, 'feat/build-gemm'),
    ).rejects.toThrow();

    const result = await execute({
      name: 'reviewer-a',
      kind: 'reviewer',
      review_target: 'feat/build-gemm',
    });

    expect(result.isError).toBeUndefined();
    expect(runAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: 'agent-7' }),
      { kind: 'prompt', prompt: expect.stringContaining('against base "main"') },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('records no spawn base when the base checkout is clean', async () => {
    const result = await execute(WORKER_ARGS);

    expect(result.isError).toBeUndefined();
    expect(result.output).not.toContain('base snapshot:');
    const mission = (await store.load()).missions.find((m) => m.id === 'M1');
    expect(mission?.spawnBase).toBeUndefined();
  });
});
