import type { Agent } from '..';

import DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER from './enter-reminder.md?raw';
import DYNAMIC_WORKFLOW_MODE_EXIT_REMINDER from './exit-reminder.md?raw';
import { resolveWorkflowSizeGuideline, workflowSizeGuidelineNote } from './size-guideline';

/**
 * manual = persistent toggle;
 * task = one-shot prompt;
 * tool = DynamicWorkflow entry.
 */
export type DynamicWorkflowModeTrigger = 'manual' | 'task' | 'tool';

export class DynamicWorkflowMode {
  protected active: DynamicWorkflowModeTrigger | null = null;

  constructor(protected readonly agent: Agent) {}

  enter(trigger: DynamicWorkflowModeTrigger): void {
    if (this.active !== null) return;
    this.agent.records.logRecord({
      type: 'dynamic_workflow_mode.enter',
      trigger,
      // The 'tool' trigger always fires inside a turn, so the origin names
      // what drove the model to fan out (user, cron, hook, ...). The RPC
      // triggers run between turns and record no origin.
      origin: this.agent.turn.activeTurnOrigin,
    });
    this.active = trigger;
    if (trigger !== 'tool') {
      const sizeNote = workflowSizeGuidelineNote(
        resolveWorkflowSizeGuideline(this.agent.pythinkerConfig),
      );
      this.agent.context.appendSystemReminder(
        sizeNote === undefined
          ? DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER
          : `${DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER}\n\n${sizeNote}`,
        {
          kind: 'injection',
          variant: 'dynamic_workflow_mode',
        },
      );
    }
    this.agent.emitStatusUpdated();
  }

  restoreEnter(trigger: DynamicWorkflowModeTrigger): void {
    this.active = trigger;
  }

  exit(): void {
    if (this.active === null) return;
    this.agent.records.logRecord({ type: 'dynamic_workflow_mode.exit' });
    const trigger = this.active;
    this.active = null;
    this.agent.emitStatusUpdated();
    if (trigger === 'tool') return;
    if (this.agent.context.popMatchedMessage((origin) => origin?.kind === 'injection' && origin.variant === 'dynamic_workflow_mode')) {
      return;
    }
    if (!this.agent.records.restoring) {
      this.agent.context.appendSystemReminder(DYNAMIC_WORKFLOW_MODE_EXIT_REMINDER, {
        kind: 'injection',
        variant: 'dynamic_workflow_mode_exit',
      });
    }
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  get shouldAutoExit(): boolean {
    return this.active === 'task' || this.active === 'tool';
  }
}
