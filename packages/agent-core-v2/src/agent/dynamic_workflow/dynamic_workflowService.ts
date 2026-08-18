/**
 * `dynamic_workflow` domain — `IAgentDynamicWorkflowService` implementation.
 *
 * Tracks dynamic-workflow-mode enter/exit in the `wire` `DynamicWorkflowModel` (mutated only through
 * the `dynamic_workflow_mode.enter` / `dynamic_workflow_mode.exit` Ops, read through `wire.getModel`),
 * mirrors it into `systemReminder` as live-only side effects, derives
 * `agent.status.updated` from the Ops' `toEvent`, and auto-exits on turn end via
 * `turn`. The enter-reminder removal on exit is a cross-model fold on
 * `ContextModel`: dispatching `dynamic_workflow_mode.exit` pops the
 * reminder when it is the last message, both live and on replay — exactly like
 * v1's restore-time `popMatchedMessage`. The service only publishes the
 * live-only `context.spliced` event for that pop (so injector bookkeeping
 * stays in step) and appends the exit reminder when nothing was
 * popped. Bound at Agent scope. The service also guards AgentDynamicWorkflow batch
 * exclusivity through an `onBeforeExecuteTool` veto
 * listener: an AgentDynamicWorkflow call must be the only tool call in its batch,
 * anything else is vetoed with a `toolApproval.formatDenyMessage`-formatted
 * reason.
 */

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope, ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentSystemReminderService } from '#/agent/systemReminder/systemReminder';
import { IAgentToolApprovalService } from '#/agent/toolApproval/toolApproval';
import { denyToolExecution } from '#/agent/toolExecutor/beforeToolExecuteEvent';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import { IEventBus } from '#/app/event/eventBus';
import { IWireService } from '#/wire/wire';
import DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER from './enter-reminder.md?raw';
import DYNAMIC_WORKFLOW_MODE_EXIT_REMINDER from './exit-reminder.md?raw';
import { IAgentDynamicWorkflowService, type DynamicWorkflowModeTrigger } from './dynamic_workflow';
import { dynamic_workflowEnter, dynamic_workflowExit, DynamicWorkflowModel } from './dynamic_workflowOps';

export class AgentDynamicWorkflowService extends Disposable implements IAgentDynamicWorkflowService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IWireService private readonly wire: IWireService,
    @IAgentSystemReminderService private readonly reminders: IAgentSystemReminderService,
    @IAgentContextMemoryService private readonly context: IAgentContextMemoryService,
    @IEventBus private readonly eventBus: IEventBus,
    @IAgentToolApprovalService private readonly toolApproval: IAgentToolApprovalService,
    @IAgentToolExecutorService toolExecutor: IAgentToolExecutorService,
  ) {
    super();
    this._register(
      this.eventBus.subscribe('turn.ended', () => {
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
    if (this.wire.getModel(DynamicWorkflowModel) !== null) return;
    this.wire.dispatch(dynamic_workflowEnter({ trigger }));
    if (trigger !== 'tool') {
      this.reminders.appendSystemReminder(DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER, {
        kind: 'injection',
        variant: 'dynamic_workflow_mode',
      });
    }
  }

  exit(): void {
    const trigger = this.wire.getModel(DynamicWorkflowModel);
    if (trigger === null) return;
    const history = this.context.get();
    const last = history[history.length - 1];
    const willPop =
      last?.origin?.kind === 'injection' && last.origin.variant === 'dynamic_workflow_mode';
    this.wire.dispatch(dynamic_workflowExit({}));
    if (trigger === 'tool') return;
    if (willPop) {
      this.eventBus.publish({
        type: 'context.spliced',
        start: history.length - 1,
        deleteCount: 1,
        messages: [],
      });
      return;
    }
    this.reminders.appendSystemReminder(DYNAMIC_WORKFLOW_MODE_EXIT_REMINDER, {
      kind: 'injection',
      variant: 'dynamic_workflow_mode_exit',
    });
  }

  get isActive(): boolean {
    return this.wire.getModel(DynamicWorkflowModel) !== null;
  }

  private get shouldAutoExit(): boolean {
    const trigger = this.wire.getModel(DynamicWorkflowModel);
    return trigger === 'task' || trigger === 'tool';
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentDynamicWorkflowService,
  AgentDynamicWorkflowService,
  ScopeActivation.OnScopeCreated,
  'dynamic_workflow',
);

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
