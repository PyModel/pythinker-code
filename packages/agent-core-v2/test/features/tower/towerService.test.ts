import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentScopeContext, makeAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentToolApprovalService } from '#/agent/toolApproval/toolApproval';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import type {
  BeforeExecuteDecision,
  ResolvedToolExecutionHookContext,
} from '#/agent/toolExecutor/toolHooks';
import { TowerStore } from '#/features/tower/protocol/index';
import { IAgentTowerService, TOWER_FLAG_ID } from '#/features/tower/tower';
import { _setTowerFeatureAssembledForTests } from '#/features/tower/towerFeature';
import { AgentTowerService } from '#/features/tower/towerService';
import { towerKey } from '#/features/tower/towerOps';
import { IAgentStateService } from '#/agent/state/agentState';
import { AgentStatusUpdated } from '#/agent/usage/usageEvents';
import { IConfigService } from '#/app/config/config';
import { IEventBus, type ISessionEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { IFeatureManager } from '#/app/feature/featureManager';
import { IFlagService } from '#/app/flag/flag';
import { ISessionManager } from '#/app/sessionManager/sessionManager';
import {
  ISessionActivityView,
  type SessionPendingInteraction,
} from '#/session/sessionActivity/sessionActivity';
import type { ToolCall } from '#/kosong/contract/message';
import { AppendLogStore } from '#/persistence/backends/node-fs/appendLogStore';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { IAppendLogStore } from '#/persistence/interface/appendLogStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { ISessionExpertTalkService } from '#/session/expertTalk/expertTalk';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ToolAccesses } from '#/tool/toolContract';
import { AGENT_WIRE_RECORD_KEY, type WireRecord } from '#/wire/record';

import { stubToolExecutorEvents, type ToolExecutorEventStubs } from '../../agent/toolExecutor/stubs';
import { stubFlag } from '../../app/flag/stubs';
import { createReminderStub, lifecycleWithReminder } from '../reminder/stubs';
import {
  registerTestAgentWire,
  registerTestEventDispatcher,
  restoreTestEventDispatcher,
  testWireScope,
} from '../../wire/stubs';

const execFileAsync = promisify(execFile);

_setTowerFeatureAssembledForTests(true);

const signal = new AbortController().signal;

function stubMainAgentScope(ix: TestInstantiationService): void {
  const agentScope = makeAgentScopeContext({
    agentId: 'main',
    agentScope: testWireScope('wire', 'tower-test'),
    generation: 0,
  });
  ix.stub(IAgentScopeContext, agentScope);
  const bus = ix.get(IEventBus) as ISessionEventBus;
  if (typeof bus.activateAgent === 'function') bus.activateAgent(agentScope.agentContext);
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

function writeHookContext(toolName: string, paths: readonly string[]): ResolvedToolExecutionHookContext {
  const call = toolCall(toolName, `call_${toolName.toLowerCase()}`);
  return {
    turnId: 0,
    signal,
    toolCall: call,
    toolCalls: [call],
    args: {},
    execution: {
      approvalRule: toolName,
      accesses: paths.flatMap((path) => ToolAccesses.writeFile(path)),
      execute: async () => ({ output: '' }),
    },
  };
}

describe('AgentTowerService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let executorEvents: ToolExecutorEventStubs;
  let permissionGateRan: boolean;
  let formatDenyMessage: Mock<(message: string) => string>;
  let prepareControllerActivation: Mock<() => void>;
  let towerFlagOn: boolean;
  let liveSessions: Map<
    string,
    { busy: boolean; pendingInteraction: SessionPendingInteraction; exit: Mock<() => void> }
  >;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IFileSystemStorageService, new InMemoryStorageService());
    ix.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
    ix.set(IEventBus, new SyncDescriptor(EventBusService));
    executorEvents = stubToolExecutorEvents();
    permissionGateRan = false;
    ix.stub(IAgentToolExecutorService, executorEvents.executor);
    formatDenyMessage = vi.fn((message: string) => message);
    ix.stub(IAgentToolApprovalService, { formatDenyMessage });
    prepareControllerActivation = vi.fn();
    ix.stub(ISessionExpertTalkService, {
      prepareControllerActivation,
    } as unknown as ISessionExpertTalkService);
    towerFlagOn = true;
    ix.stub(IFlagService, stubFlag((id) => towerFlagOn && id === TOWER_FLAG_ID));
    liveSessions = new Map();
    let activeTools: string[] | undefined;
    ix.stub(IAgentProfileService, {
      data: () => ({ profileName: undefined }),
      getActiveToolNames: () => activeTools,
      addActiveTool: (name: string) => {
        activeTools = [...(activeTools ?? []), name];
      },
    } as unknown as IAgentProfileService);
    ix.stub(ISessionManager, {
      get: (id: string) => {
        const stub = liveSessions.get(id);
        if (stub === undefined) return undefined;
        return {
          accessor: {
            get: (token: unknown) => {
              if (token === (ISessionActivityView as unknown)) {
                return {
                  state: () => ({
                    busy: stub.busy,
                    mainTurnActive: stub.busy,
                    pendingInteraction: stub.pendingInteraction,
                  }),
                };
              }
              if (token === (IAgentLifecycleService as unknown)) {
                return {
                  handleOf: () => ({
                    accessor: {
                      get: (agentToken: unknown) =>
                        agentToken === (IAgentTowerService as unknown)
                          ? { exit: stub.exit }
                          : undefined,
                    },
                  }),
                };
              }
              return undefined;
            },
          },
        };
      },
    } as unknown as ISessionManager);
    ix.stub(IFeatureManager, {
      onDidChangeUnits: () => ({ dispose: () => {} }),
    } as unknown as IFeatureManager);
    ix.stub(IConfigService, {
      onDidChangeConfiguration: () => ({ dispose: () => {} }),
    } as unknown as IConfigService);
    ix.stub(IAgentLifecycleService, lifecycleWithReminder(createReminderStub()));
    ix.stub(IAgentContextMemoryService, {
      get: () => [],
    } as unknown as IAgentContextMemoryService);
    ix.stub(ISessionContext, {
      cwd: '/nonexistent-tower-repo',
      sessionId: 'session-test',
    } as unknown as ISessionContext);
    registerTestAgentWire(ix, testWireScope('wire', 'tower-test'), {
      log: ix.get(IAppendLogStore),
      eventBus: ix.get(IEventBus),
    });
    stubMainAgentScope(ix);
    registerTestEventDispatcher(ix);
    ix.set(IAgentTowerService, new SyncDescriptor(AgentTowerService));
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

  function stubLiveSession(
    id: string,
    init: { busy?: boolean; pendingInteraction?: SessionPendingInteraction } = {},
  ): Mock<() => void> {
    const exit = vi.fn();
    liveSessions.set(id, {
      busy: init.busy ?? false,
      pendingInteraction: init.pendingInteraction ?? 'none',
      exit,
    });
    return exit;
  }

  async function initOwnedTower(owner: string): Promise<string> {
    const repo = await mkdtemp(join(tmpdir(), 'tower-enter-owner-'));
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'tower-test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Tower Test'], { cwd: repo });
    await writeFile(join(repo, 'README.md'), '# fixture\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo });
    await new TowerStore(repo).init(owner);
    return repo;
  }

  it('enter / exit toggle isActive and emit agent.status.updated via wire', async () => {
    const tower = ix.get(IAgentTowerService);
    const events: { readonly type: string; readonly towerMode?: boolean }[] = [];
    disposables.add(
      ix.get(IEventBus).subscribe((e) => {
        if (e.type === 'agent.status.updated') {
          events.push({ type: e.type, towerMode: (e as AgentStatusUpdated).towerMode });
        }
      }),
    );

    expect(tower.isActive).toBe(false);
    await tower.enter();
    expect(tower.isActive).toBe(true);
    expect(prepareControllerActivation).toHaveBeenCalledOnce();
    tower.exit();
    expect(tower.isActive).toBe(false);

    expect(events).toEqual([
      { type: 'agent.status.updated', towerMode: true },
      { type: 'agent.status.updated', towerMode: false },
    ]);
  });

  it('enter / exit are idempotent while already in that state', async () => {
    const tower = ix.get(IAgentTowerService);
    const events: { readonly type: string; readonly towerMode?: boolean }[] = [];
    disposables.add(
      ix.get(IEventBus).subscribe((e) => {
        if (e.type === 'agent.status.updated') {
          events.push({ type: e.type, towerMode: (e as AgentStatusUpdated).towerMode });
        }
      }),
    );

    tower.exit();
    expect(tower.isActive).toBe(false);
    await tower.enter();
    await tower.enter();
    expect(tower.isActive).toBe(true);

    expect(events).toEqual([{ type: 'agent.status.updated', towerMode: true }]);
  });

  it('dispatch persists enter/exit records and replay rebuilds the flag (silent)', async () => {
    const tower = ix.get(IAgentTowerService);
    await tower.enter();

    const log = ix.get(IAppendLogStore);
    const records: WireRecord[] = [];
    for await (const record of log.read<WireRecord>(
      testWireScope('wire', 'tower-test'),
      AGENT_WIRE_RECORD_KEY,
    )) {
      records.push(record);
    }
    expect(records).toEqual([
      {
        type: 'tower_mode.enter',
        agentId: 'main',
        sessionId: 'session-test',
        time: expect.any(Number),
      },
    ]);

    const ix2 = disposables.add(new TestInstantiationService());
    ix2.stub(IFileSystemStorageService, new InMemoryStorageService());
    ix2.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
    registerTestAgentWire(ix2, testWireScope('wire', 'tower-replay'), {
      log: ix2.get(IAppendLogStore),
    });
    stubMainAgentScope(ix2);
    const dispatcher = registerTestEventDispatcher(ix2);
    ix2.get(IAgentStateService).contributeState(towerKey);
    await restoreTestEventDispatcher(
      dispatcher,
      ix2.get(IAppendLogStore),
      testWireScope('wire', 'tower-replay'),
      records,
    );
    expect(ix2.get(IAgentStateService).get(towerKey)).toBe(true);
  });

  it('replays legacy v1 tower_mode records written without a payload', async () => {
    const records: WireRecord[] = [
      { type: 'tower_mode.enter', time: 1 },
      { type: 'tower_mode.exit', time: 2 },
      { type: 'tower_mode.enter', time: 3 },
    ];

    const ix2 = disposables.add(new TestInstantiationService());
    ix2.stub(IFileSystemStorageService, new InMemoryStorageService());
    ix2.set(IAppendLogStore, new SyncDescriptor(AppendLogStore));
    registerTestAgentWire(ix2, testWireScope('wire', 'tower-legacy'), {
      log: ix2.get(IAppendLogStore),
    });
    const dispatcher = registerTestEventDispatcher(ix2);
    ix2.get(IAgentStateService).contributeState(towerKey);
    await restoreTestEventDispatcher(
      dispatcher,
      ix2.get(IAppendLogStore),
      testWireScope('wire', 'tower-legacy'),
      records,
    );
    expect(ix2.get(IAgentStateService).get(towerKey)).toBe(true);
  });

  it('leaves AskUserQuestion alone while tower mode is active (the tower may ask)', async () => {
    const tower = ix.get(IAgentTowerService);
    await tower.enter();

    const decision = await fire(hookContext([toolCall('AskUserQuestion', 'call_ask')]));

    expect(decision).toBeUndefined();
    expect(permissionGateRan).toBe(true);
    expect(formatDenyMessage).not.toHaveBeenCalled();
  });

  it('abstains on AskUserQuestion while tower mode is inactive', async () => {
    ix.get(IAgentTowerService);

    const decision = await fire(hookContext([toolCall('AskUserQuestion', 'call_ask')]));

    expect(decision).toBeUndefined();
    expect(permissionGateRan).toBe(true);
    expect(formatDenyMessage).not.toHaveBeenCalled();
  });

  it('vetoes TodoList while tower mode is active', async () => {
    const tower = ix.get(IAgentTowerService);
    await tower.enter();

    const decision = await fire(hookContext([toolCall('TodoList', 'call_todo')]));

    expect(decision).toEqual({
      veto: {
        output: expect.stringContaining('TodoList is not available while tower mode is active'),
        isError: true,
      },
    });
    expect(permissionGateRan).toBe(false);
    expect(formatDenyMessage).toHaveBeenCalledTimes(1);
  });

  it('abstains on TodoList while tower mode is inactive', async () => {
    ix.get(IAgentTowerService);

    const decision = await fire(hookContext([toolCall('TodoList', 'call_todo')]));

    expect(decision).toBeUndefined();
    expect(permissionGateRan).toBe(true);
    expect(formatDenyMessage).not.toHaveBeenCalled();
  });

  it('abstains on other tools while tower mode is active', async () => {
    const tower = ix.get(IAgentTowerService);
    await tower.enter();

    const decision = await fire(hookContext([toolCall('Bash', 'call_bash')]));

    expect(decision).toBeUndefined();
    expect(permissionGateRan).toBe(true);
    expect(formatDenyMessage).not.toHaveBeenCalled();
  });

  it('enter() is a no-op while the tower flag is off', async () => {
    towerFlagOn = false;
    const tower = ix.get(IAgentTowerService);
    const events: { readonly type: string }[] = [];
    disposables.add(
      ix.get(IEventBus).subscribe((e) => {
        if (e.type === 'agent.status.updated') events.push({ type: e.type });
      }),
    );

    await tower.enter();

    expect(tower.isActive).toBe(false);
    expect(events).toEqual([]);
  });

  it('does not veto TodoList while the tower flag is off, even with tower mode persisted active', async () => {
    const tower = ix.get(IAgentTowerService);
    await tower.enter();
    expect(tower.isActive).toBe(true);
    towerFlagOn = false;

    const decision = await fire(hookContext([toolCall('TodoList', 'call_todo')]));

    expect(decision).toBeUndefined();
    expect(permissionGateRan).toBe(true);
    expect(formatDenyMessage).not.toHaveBeenCalled();
    expect(tower.isActive).toBe(false);
  });

  it('does not take the tower from a busy owner session', async () => {
    const repo = await initOwnedTower('session-original');
    try {
      stubLiveSession('session-original', { busy: true });
      ix.stub(ISessionContext, { cwd: repo, sessionId: 'session-fork' } as ISessionContext);
      const tower = ix.get(IAgentTowerService);

      await tower.enter();

      expect(tower.isActive).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('does not take the tower from an owner waiting on an interaction', async () => {
    const repo = await initOwnedTower('session-original');
    try {
      stubLiveSession('session-original', { pendingInteraction: 'approval' });
      ix.stub(ISessionContext, { cwd: repo, sessionId: 'session-fork' } as ISessionContext);
      const tower = ix.get(IAgentTowerService);

      await tower.enter();

      expect(tower.isActive).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('takes the tower from a live but idle owner session', async () => {
    const repo = await initOwnedTower('session-original');
    try {
      const ownerExit = stubLiveSession('session-original');
      ix.stub(ISessionContext, { cwd: repo, sessionId: 'session-fork' } as ISessionContext);
      const tower = ix.get(IAgentTowerService);

      await tower.enter();

      expect(tower.isActive).toBe(true);
      expect(ownerExit).toHaveBeenCalledOnce();
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  describe('tower-worker write guard', () => {
    const WORKER_AGENT_ID = 'agent-worker-1';
    let repo: string;
    let worktree: string;

    async function git(cwd: string, ...args: string[]): Promise<void> {
      await execFileAsync('git', args, { cwd });
    }

    beforeEach(async () => {
      repo = await mkdtemp(join(tmpdir(), 'tower-guard-test-'));
      await git(repo, 'init', '-b', 'main');
      await git(repo, 'config', 'user.email', 'tower-test@example.com');
      await git(repo, 'config', 'user.name', 'Tower Test');
      await writeFile(join(repo, 'README.md'), '# fixture\n');
      await git(repo, 'add', 'README.md');
      await git(repo, 'commit', '-m', 'initial');
      const store = new TowerStore(repo);
      await store.init();
      await store.registerAgent({
        name: 'agent-build',
        agentId: WORKER_AGENT_ID,
        kind: 'worker',
        missionId: 'M1',
        worktree: 'wt-1',
        branch: 'feat/build',
        spawnedAt: new Date().toISOString(),
      });
      worktree = join(repo, '.tower/worktrees/wt-1');

      ix.stub(IAgentProfileService, {
        data: () => ({ profileName: 'tower-worker' }),
      } as unknown as IAgentProfileService);
      ix.stub(IAgentScopeContext, {
        agentId: WORKER_AGENT_ID,
        scope: (subKey?: string) => subKey ?? '',
      });
      ix.stub(ISessionContext, {
        cwd: repo,
        sessionId: 'session-test',
      } as unknown as ISessionContext);
    });

    afterEach(async () => {
      await rm(repo, { recursive: true, force: true });
    });

    it('allows a worker Write inside its own worktree', async () => {
      ix.get(IAgentTowerService);

      const decision = await fire(writeHookContext('Write', [`${worktree}/src/gemm.cpp`]));

      expect(decision).toBeUndefined();
      expect(permissionGateRan).toBe(true);
      expect(formatDenyMessage).not.toHaveBeenCalled();
    });

    it('denies a worker Write outside its worktree', async () => {
      ix.get(IAgentTowerService);

      const decision = await fire(
        writeHookContext('Edit', [`${repo}/src/gemm.cpp`, `${repo}/.tower/worktrees/wt-2/x.ts`]),
      );

      expect(decision?.veto?.isError).toBe(true);
      const output = decision?.veto?.output;
      expect(output).toContain(`tower workers may only write inside their own worktree (${worktree})`);
      expect(output).toContain(`${repo}/src/gemm.cpp`);
      expect(output).toContain(`${repo}/.tower/worktrees/wt-2/x.ts`);
      expect(output).toContain('TowerFinding');
      expect(output).toContain('TowerSend');
      expect(permissionGateRan).toBe(false);
      expect(formatDenyMessage).toHaveBeenCalledTimes(1);
    });

    it('abstains on non-Write/Edit tools for a worker', async () => {
      ix.get(IAgentTowerService);

      const decision = await fire(hookContext([toolCall('Bash', 'call_bash')]));

      expect(decision).toBeUndefined();
      expect(permissionGateRan).toBe(true);
      expect(formatDenyMessage).not.toHaveBeenCalled();
    });

    it('keeps the worker write guard active while the tower flag is off', async () => {
      towerFlagOn = false;
      ix.get(IAgentTowerService);

      const decision = await fire(writeHookContext('Write', [`${repo}/src/gemm.cpp`]));

      expect(decision?.veto?.isError).toBe(true);
      expect(permissionGateRan).toBe(false);
      expect(formatDenyMessage).toHaveBeenCalledOnce();
    });

    it('abstains when the agent is not a tower worker', async () => {
      ix.stub(IAgentProfileService, {
        data: () => ({ profileName: 'coder' }),
      } as unknown as IAgentProfileService);
      ix.get(IAgentTowerService);

      const decision = await fire(writeHookContext('Write', [`${repo}/src/gemm.cpp`]));

      expect(decision).toBeUndefined();
      expect(permissionGateRan).toBe(true);
      expect(formatDenyMessage).not.toHaveBeenCalled();
    });

    it('abstains when the worker has no roster entry', async () => {
      ix.stub(IAgentScopeContext, {
        agentId: 'agent-unregistered',
        scope: (subKey?: string) => subKey ?? '',
      });
      ix.get(IAgentTowerService);

      const decision = await fire(writeHookContext('Write', [`${repo}/src/gemm.cpp`]));

      expect(decision).toBeUndefined();
      expect(permissionGateRan).toBe(true);
      expect(formatDenyMessage).not.toHaveBeenCalled();
    });
  });
});
