import { Disposable } from '#/_base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IAgentStateService } from '#/agent/state/agentState';
import { IEventBus } from '#/app/event/eventBus';
import { LifecycleScope } from '#/app/scopes';
import { IAgentDynamicWorkflowService } from '#/features/dynamic_workflow/agent/dynamic_workflow';
import { DynamicWorkflowModeEnter } from '#/features/dynamic_workflow/dynamicWorkflowOps';
import { IAgentPlanService } from '#/features/plan/plan';
import { PlanModeEnter, planKey } from '#/features/plan/planOps';
import { IAgentTowerService } from '#/features/tower/tower';
import { TowerModeEnter } from '#/features/tower/towerOps';

import { IAgentModeMutexService } from './modeMutex';

export class AgentModeMutexService extends Disposable implements IAgentModeMutexService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IAgentPlanService private readonly plan: IAgentPlanService,
    @IAgentDynamicWorkflowService private readonly dynamicWorkflow: IAgentDynamicWorkflowService,
    @IAgentTowerService private readonly tower: IAgentTowerService,
    @IAgentStateService private readonly agentState: IAgentStateService,
    @IEventBus eventBus: IEventBus,
  ) {
    super();
    this._register(
      eventBus.subscribe(PlanModeEnter, () => {
        if (this.tower.isActive) this.tower.exit();
      }),
    );
    this._register(
      eventBus.subscribe(DynamicWorkflowModeEnter, () => {
        if (this.tower.isActive) this.tower.exit();
      }),
    );
    this._register(
      eventBus.subscribe(TowerModeEnter, () => {
        if (this.agentState.get(planKey).active) this.plan.exit();
        if (this.dynamicWorkflow.isActive) this.dynamicWorkflow.exit();
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
