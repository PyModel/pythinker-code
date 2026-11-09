import { Disposable } from '#/_base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IAgentStateService } from '#/agent/state/agentState';
import { AgentStatusUpdated } from '#/agent/usage/usageEvents';
import { IEventBus } from '#/app/event/eventBus';
import { LifecycleScope } from '#/app/scopes';
import { GoalUpdated } from '#/features/goal/goalOps';
import { IAgentGoalService } from '#/features/goal/goalService';
import { IAgentPlanService } from '#/features/plan/plan';
import { PlanModeEnter, planKey } from '#/features/plan/planOps';
import { IAgentDynamicWorkflowService } from '#/features/dynamic_workflow/agent/dynamic_workflow';
import { DynamicWorkflowModeEnter } from '#/features/dynamic_workflow/dynamicWorkflowOps';
import { IAgentTowerService } from '#/features/tower/tower';
import { TowerModeEnter } from '#/features/tower/towerOps';
import { IEventDispatcher } from '#/state/eventDispatcher';

import { IAgentModeMutexService } from './modeMutex';

export class AgentModeMutexService extends Disposable implements IAgentModeMutexService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IAgentPlanService private readonly plan: IAgentPlanService,
    @IAgentDynamicWorkflowService private readonly dynamic_workflow: IAgentDynamicWorkflowService,
    @IAgentTowerService private readonly tower: IAgentTowerService,
    @IAgentGoalService private readonly goal: IAgentGoalService | undefined,
    @IAgentStateService private readonly agentState: IAgentStateService,
    @IEventDispatcher private readonly dispatcher: IEventDispatcher,
    @IEventBus eventBus: IEventBus,
  ) {
    super();
    this._register(
      eventBus.subscribe(PlanModeEnter, () => {
        if (this.tower.isActive) void this.tower.exit('mode-mutex');
      }),
    );
    this._register(
      eventBus.subscribe(DynamicWorkflowModeEnter, () => {
        if (this.tower.isActive) void this.tower.exit('mode-mutex');
      }),
    );
    this._register(
      eventBus.subscribe(TowerModeEnter, () => {
        if (this.agentState.get(planKey).active) this.plan.exit();
        if (this.dynamic_workflow.isActive) this.dynamic_workflow.exit();
        if (this.goal?.getGoal().goal?.status === 'active') {
          void this.goal.pauseGoal({ reason: 'Paused after tower mode entered' }, 'system');
        }
      }),
    );
    this._register(
      eventBus.subscribe(GoalUpdated, (event) => {
        if (event.snapshot?.status !== 'active') return;
        if (!this.tower.isActive) return;
        void this.dispatcher.dispatch(
          new AgentStatusUpdated({
            agentId: event.agentId,
            towerMode: false,
            towerExitReason: 'mode-mutex',
          }),
        );
        void this.tower.exit('mode-mutex');
      }),
    );
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentModeMutexService,
  AgentModeMutexService,
  ScopeActivation.OnScopeCreated,
  'modeMutex',
);
