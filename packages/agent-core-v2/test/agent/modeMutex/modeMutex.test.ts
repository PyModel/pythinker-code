import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentModeMutexService } from '#/agent/modeMutex/modeMutex';
import { AgentModeMutexService } from '#/agent/modeMutex/modeMutexService';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentStateService } from '#/agent/state/agentState';
import { AgentStateService } from '#/agent/state/agentStateService';
import { AgentStatusUpdated } from '#/agent/usage/usageEvents';
import { IEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { GoalUpdated } from '#/features/goal/goalOps';
import { IAgentGoalService } from '#/features/goal/goalService';
import type { GoalSnapshot } from '#/features/goal/types';
import { IAgentPlanService } from '#/features/plan/plan';
import { PlanModeEnter, planKey } from '#/features/plan/planOps';
import { IAgentDynamicWorkflowService } from '#/features/dynamic_workflow/agent/dynamic_workflow';
import { DynamicWorkflowModeEnter } from '#/features/dynamic_workflow/dynamicWorkflowOps';
import { IAgentTowerService } from '#/features/tower/tower';
import { TowerModeEnter } from '#/features/tower/towerOps';
import { IEventDispatcher } from '#/state/eventDispatcher';

import { registerTestAgentWire, testWireScope } from '../../wire/stubs';

describe('AgentModeMutexService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let planExit: ReturnType<typeof vi.fn>;
  let dynamicWorkflowExit: ReturnType<typeof vi.fn>;
  let towerExit: ReturnType<typeof vi.fn>;
  let goalPause: ReturnType<typeof vi.fn>;
  let dispatch: ReturnType<typeof vi.fn>;
  let dynamicWorkflowActive: boolean;
  let towerActive: boolean;
  let goalStatus: string | undefined;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.set(IEventBus, new SyncDescriptor(EventBusService));
    ix.set(IAgentStateService, new AgentStateService());
    registerTestAgentWire(ix, testWireScope('wire', 'mode-mutex-test'), {
      eventBus: ix.get(IEventBus),
    });
    planExit = vi.fn();
    dynamicWorkflowExit = vi.fn();
    towerExit = vi.fn();
    goalPause = vi.fn();
    dispatch = vi.fn();
    dynamicWorkflowActive = false;
    towerActive = false;
    goalStatus = undefined;
    ix.stub(IAgentPlanService, { exit: planExit } as unknown as IAgentPlanService);
    ix.stub(IAgentDynamicWorkflowService, {
      exit: dynamicWorkflowExit,
      get isActive() {
        return dynamicWorkflowActive;
      },
    } as unknown as IAgentDynamicWorkflowService);
    ix.stub(IAgentTowerService, {
      exit: towerExit,
      get isActive() {
        return towerActive;
      },
    } as unknown as IAgentTowerService);
    ix.stub(IAgentGoalService, {
      pauseGoal: goalPause,
      getGoal: () => ({ goal: goalStatus === undefined ? null : { status: goalStatus } }),
    } as unknown as IAgentGoalService);
    ix.stub(IEventDispatcher, { dispatch } as unknown as IEventDispatcher);
    ix.get(IAgentStateService).contributeState(planKey);
    ix.set(IAgentModeMutexService, new SyncDescriptor(AgentModeMutexService));
    ix.get(IAgentModeMutexService);
  });
  afterEach(() => disposables.dispose());

  function publish(event: PlanModeEnter | DynamicWorkflowModeEnter | TowerModeEnter | GoalUpdated): void {
    const agentContext = ix.get(IAgentScopeContext).agentContext;
    ix.get(IEventBus).publish(event, agentContext);
  }

  it('plan mode entry exits an active tower mode', () => {
    towerActive = true;
    publish(new PlanModeEnter({ agentId: 'test-agent', id: 'plan_1' }));
    expect(towerExit).toHaveBeenCalledTimes(1);
    expect(towerExit).toHaveBeenCalledWith('mode-mutex');
  });

  it('plan mode entry leaves an inactive tower mode alone', () => {
    publish(new PlanModeEnter({ agentId: 'test-agent', id: 'plan_1' }));
    expect(towerExit).not.toHaveBeenCalled();
  });

  it('dynamic_workflow mode entry exits an active tower mode', () => {
    towerActive = true;
    publish(new DynamicWorkflowModeEnter({ agentId: 'test-agent', trigger: 'manual' }));
    expect(towerExit).toHaveBeenCalledTimes(1);
    expect(towerExit).toHaveBeenCalledWith('mode-mutex');
  });

  it('dynamic_workflow mode entry leaves an inactive tower mode alone', () => {
    publish(new DynamicWorkflowModeEnter({ agentId: 'test-agent', trigger: 'manual' }));
    expect(towerExit).not.toHaveBeenCalled();
  });

  it('tower mode entry exits an active plan mode and an active dynamic_workflow mode', () => {
    ix.get(IAgentStateService).set(planKey, { active: true, id: 'plan_1' });
    dynamicWorkflowActive = true;
    publish(new TowerModeEnter({ agentId: 'test-agent' }));
    expect(planExit).toHaveBeenCalledTimes(1);
    expect(dynamicWorkflowExit).toHaveBeenCalledTimes(1);
  });

  it('tower mode entry leaves inactive plan and dynamic_workflow modes alone', () => {
    publish(new TowerModeEnter({ agentId: 'test-agent' }));
    expect(planExit).not.toHaveBeenCalled();
    expect(dynamicWorkflowExit).not.toHaveBeenCalled();
  });

  it('tower mode entry pauses an active goal', () => {
    goalStatus = 'active';
    publish(new TowerModeEnter({ agentId: 'test-agent' }));
    expect(goalPause).toHaveBeenCalledTimes(1);
  });

  it('tower mode entry leaves a non-active goal alone', () => {
    goalStatus = 'paused';
    publish(new TowerModeEnter({ agentId: 'test-agent' }));
    expect(goalPause).not.toHaveBeenCalled();
  });

  it('goal activation exits an active tower mode with the mode-mutex reason', () => {
    towerActive = true;
    publish(
      new GoalUpdated({
        agentId: 'test-agent',
        snapshot: { status: 'active' } as GoalSnapshot,
      }),
    );
    expect(towerExit).toHaveBeenCalledTimes(1);
    expect(towerExit).toHaveBeenCalledWith('mode-mutex');
    expect(dispatch).toHaveBeenCalledTimes(1);
    const status = dispatch.mock.calls[0]![0] as AgentStatusUpdated;
    expect(status).toBeInstanceOf(AgentStatusUpdated);
    expect(status.agentId).toBe('test-agent');
    expect(status.towerMode).toBe(false);
    expect(status.towerExitReason).toBe('mode-mutex');
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(
      towerExit.mock.invocationCallOrder[0]!,
    );
  });

  it('goal activation leaves an inactive tower mode alone', () => {
    publish(
      new GoalUpdated({
        agentId: 'test-agent',
        snapshot: { status: 'active' } as GoalSnapshot,
      }),
    );
    expect(towerExit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a non-active goal update does not exit tower mode', () => {
    towerActive = true;
    publish(
      new GoalUpdated({
        agentId: 'test-agent',
        snapshot: { status: 'paused' } as GoalSnapshot,
      }),
    );
    expect(towerExit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
