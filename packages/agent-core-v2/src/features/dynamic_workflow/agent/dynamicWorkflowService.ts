import { Service } from '#/_base/di/service';
import { IInstantiationService } from '#/_base/di/instantiation';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { TurnEnded } from '#/agent/loop/turnOps';
import { IAgentToolApprovalService } from '#/agent/toolApproval/toolApproval';
import { denyToolExecution } from '#/agent/toolExecutor/beforeToolExecuteEvent';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import { IEventBus } from '#/app/event/eventBus';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentStateService } from '#/agent/state/agentState';
import { IEventDispatcher } from '#/state/eventDispatcher';

import { DynamicWorkflowInjection } from './injection/dynamicWorkflowInjection';
import { IAgentDynamicWorkflowService, type DynamicWorkflowModeTrigger } from './dynamic_workflow';
import { DynamicWorkflowModeEnter, DynamicWorkflowModeExit, dynamicWorkflowKey } from '../dynamicWorkflowOps';

export class AgentDynamicWorkflowService extends Service implements IAgentDynamicWorkflowService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IEventDispatcher private readonly dispatcher: IEventDispatcher,
    @IInstantiationService instantiation: IInstantiationService,
    @IEventBus eventBus: IEventBus,
    @IAgentContextMemoryService private readonly context: IAgentContextMemoryService,
    @IAgentToolApprovalService private readonly toolApproval: IAgentToolApprovalService,
    @IAgentToolExecutorService toolExecutor: IAgentToolExecutorService,
    @IAgentScopeContext private readonly agentCtx: IAgentScopeContext,
    @IAgentStateService private readonly agentState: IAgentStateService,
  ) {
    super();
    this.agentState.contributeState(dynamicWorkflowKey);
    this._register(
      instantiation.createInstance(DynamicWorkflowInjection, {
        getTrigger: () => this.agentState.get(dynamicWorkflowKey),
      }),
    );
    this._register(
      eventBus.subscribe(TurnEnded, () => {
        if (this.shouldAutoExit) {
          this.exit();
        }
      }),
    );
    this._register(
      toolExecutor.onBeforeExecuteTool((event) => {
        const agentDynamicWorkflowCount = event.toolCalls.filter(
          (toolCall) => toolCall.name === 'AgentDynamicWorkflow',
        ).length;
        if (agentDynamicWorkflowCount === 0 || (agentDynamicWorkflowCount === 1 && event.toolCalls.length === 1)) {
          return;
        }
        event.veto(
          denyToolExecution(
            this.toolApproval.formatDenyMessage(
              agentDynamicWorkflowCount > 1
                ? multipleAgentDynamicWorkflowDeniedMessage(event.toolCalls.length > agentDynamicWorkflowCount)
                : mixedAgentDynamicWorkflowDeniedMessage(),
            ),
          ),
        );
      }),
    );
  }

  enter(trigger: DynamicWorkflowModeTrigger): void {
    if (this.agentState.get(dynamicWorkflowKey) !== null) return;
    void this.dispatcher.dispatch(new DynamicWorkflowModeEnter({ agentId: this.agentCtx.agentId, trigger }));
  }

  exit(): void {
    if (this.agentState.get(dynamicWorkflowKey) === null) return;
    const history = this.context.get();
    void this.dispatcher.dispatch(new DynamicWorkflowModeExit({ agentId: this.agentCtx.agentId }));
    this.context.publishTrailingRemoval(history);
  }

  get isActive(): boolean {
    return this.agentState.get(dynamicWorkflowKey) !== null;
  }

  private get shouldAutoExit(): boolean {
    const trigger = this.agentState.get(dynamicWorkflowKey);
    return trigger === 'task' || trigger === 'tool';
  }
}

function multipleAgentDynamicWorkflowDeniedMessage(hasOtherToolCalls: boolean): string {
  const suffix = hasOtherToolCalls
    ? ' AgentDynamicWorkflow also must not be combined with other tools in the same response.'
    : '';
  return (
    'AgentDynamicWorkflow must be called one dynamic_workflow at a time. Multiple AgentDynamicWorkflow calls are not forbidden, ' +
    'but issue them sequentially: call one AgentDynamicWorkflow, wait for its result, then call the next; ' +
    `or merge the work into a single AgentDynamicWorkflow when one dynamic_workflow can cover it.${suffix}`
  );
}

function mixedAgentDynamicWorkflowDeniedMessage(): string {
  return (
    'AgentDynamicWorkflow must be the only tool call in a model response. Retry with a single AgentDynamicWorkflow ' +
    'call by itself, then call any other tools after it returns.'
  );
}
