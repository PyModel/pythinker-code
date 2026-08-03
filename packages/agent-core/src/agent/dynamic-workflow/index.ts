import type { Agent } from '..';

import DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER from './enter-reminder.md?raw';
import DYNAMIC_WORKFLOW_MODE_EXIT_REMINDER from './exit-reminder.md?raw';

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
    this.agent.records.logRecord({ type: 'dynamic_workflow_mode.enter', trigger });
    this.active = trigger;
    if (trigger !== 'tool') {
      this.agent.context.appendSystemReminder(DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER, {
        kind: 'injection',
        variant: 'dynamic_workflow_mode',
      });
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
