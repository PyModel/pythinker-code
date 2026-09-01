import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentModeMutexService } from '#/agent/modeMutex/modeMutex';
import { AgentModeMutexService } from '#/agent/modeMutex/modeMutexService';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentStateService } from '#/agent/state/agentState';
import { AgentStateService } from '#/agent/state/agentStateService';
import { IEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { IAgentDynamicWorkflowService } from '#/features/dynamic_workflow/agent/dynamic_workflow';
import { DynamicWorkflowModeEnter } from '#/features/dynamic_workflow/dynamicWorkflowOps';
import { IAgentPlanService } from '#/features/plan/plan';
import { PlanModeEnter, planKey } from '#/features/plan/planOps';
import { IAgentTowerService } from '#/features/tower/tower';
import { TowerModeEnter } from '#/features/tower/towerOps';

import { registerTestAgentWire, testWireScope } from '../../wire/stubs';

describe('AgentModeMutexService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let planExit: ReturnType<typeof vi.fn>;
  let dynamicWorkflowExit: ReturnType<typeof vi.fn>;
  let towerExit: ReturnType<typeof vi.fn>;
  let dynamicWorkflowActive: boolean;
  let towerActive: boolean;

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
    dynamicWorkflowActive = false;
    towerActive = false;
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
    ix.get(IAgentStateService).contributeState(planKey);
    ix.set(IAgentModeMutexService, new SyncDescriptor(AgentModeMutexService));
    ix.get(IAgentModeMutexService);
  });

  afterEach(() => disposables.dispose());

  function publish(event: PlanModeEnter | DynamicWorkflowModeEnter | TowerModeEnter): void {
    const agentContext = ix.get(IAgentScopeContext).agentContext;
    ix.get(IEventBus).publish(event, agentContext);
  }

  it('plan mode entry exits an active tower mode', () => {
    towerActive = true;
    publish(new PlanModeEnter({ agentId: 'test-agent', id: 'plan_1' }));
    expect(towerExit).toHaveBeenCalledTimes(1);
  });

  it('plan mode entry leaves an inactive tower mode alone', () => {
    publish(new PlanModeEnter({ agentId: 'test-agent', id: 'plan_1' }));
    expect(towerExit).not.toHaveBeenCalled();
  });

  it('Dynamic Workflow entry exits an active tower mode', () => {
    towerActive = true;
    publish(new DynamicWorkflowModeEnter({ agentId: 'test-agent', trigger: 'manual' }));
    expect(towerExit).toHaveBeenCalledTimes(1);
  });

  it('Dynamic Workflow entry leaves an inactive tower mode alone', () => {
    publish(new DynamicWorkflowModeEnter({ agentId: 'test-agent', trigger: 'manual' }));
    expect(towerExit).not.toHaveBeenCalled();
  });

  it('tower mode entry exits active plan and Dynamic Workflow modes', () => {
    ix.get(IAgentStateService).set(planKey, { active: true, id: 'plan_1' });
    dynamicWorkflowActive = true;
    publish(new TowerModeEnter({ agentId: 'test-agent' }));
    expect(planExit).toHaveBeenCalledTimes(1);
    expect(dynamicWorkflowExit).toHaveBeenCalledTimes(1);
  });

  it('tower mode entry leaves inactive plan and Dynamic Workflow modes alone', () => {
    publish(new TowerModeEnter({ agentId: 'test-agent' }));
    expect(planExit).not.toHaveBeenCalled();
    expect(dynamicWorkflowExit).not.toHaveBeenCalled();
  });
});
