import { Disposable } from '#/_base/di/lifecycle';
import type { ReminderRuntime } from '#/features/reminder/reminderAgentRuntime';
import type {
  ContextInjectionContext,
  ContextInjectionResult,
} from '#/features/reminder/types';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';

import DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER from '../enter-reminder.md?raw';
import DYNAMIC_WORKFLOW_MODE_EXIT_REMINDER from '../exit-reminder.md?raw';
import type { DynamicWorkflowModeTrigger } from '../dynamic_workflow';

const DYNAMIC_WORKFLOW_MODE_INJECTION_VARIANT = 'dynamic_workflow_mode';
const LEGACY_DYNAMIC_WORKFLOW_MODE_EXIT_VARIANT = 'dynamic_workflow_mode_exit';

interface DynamicWorkflowModeInjectionDisclosure {
  readonly kind: 'dynamic_workflow_mode';
  readonly state: 'active' | 'inactive';
}

export interface DynamicWorkflowInjectionOptions {
  readonly getTrigger: () => DynamicWorkflowModeTrigger | null;
}

export class DynamicWorkflowInjection extends Disposable {
  constructor(
    private readonly options: DynamicWorkflowInjectionOptions,
    injector: ReminderRuntime,
    @IAgentContextMemoryService private readonly context: IAgentContextMemoryService,
  ) {
    super();
    this._register(
      injector.register<DynamicWorkflowModeInjectionDisclosure>(
        DYNAMIC_WORKFLOW_MODE_INJECTION_VARIANT,
        (ctx) => this.reminder(ctx),
      ),
    );
  }

  private reminder(
    ctx: ContextInjectionContext<DynamicWorkflowModeInjectionDisclosure>,
  ): ContextInjectionResult<DynamicWorkflowModeInjectionDisclosure> | undefined {
    const trigger = this.options.getTrigger();
    const active = trigger !== null && trigger !== 'tool';
    const rendered = this.renderedState(ctx);
    if (active) {
      return rendered === 'active'
        ? undefined
        : {
            content: DYNAMIC_WORKFLOW_MODE_ENTER_REMINDER,
            disclosure: { kind: 'dynamic_workflow_mode', state: 'active' },
          };
    }
    return rendered === 'active'
      ? {
          content: DYNAMIC_WORKFLOW_MODE_EXIT_REMINDER,
          disclosure: { kind: 'dynamic_workflow_mode', state: 'inactive' },
        }
      : undefined;
  }

  private renderedState(
    ctx: ContextInjectionContext<DynamicWorkflowModeInjectionDisclosure>,
  ): 'active' | 'inactive' | undefined {
    if (ctx.lastDisclosure !== undefined) return ctx.lastDisclosure.state;
    const history = this.context.get();
    for (let i = history.length - 1; i >= 0; i--) {
      const origin = history[i]!.origin;
      if (origin?.kind !== 'injection') continue;
      if (origin.variant === LEGACY_DYNAMIC_WORKFLOW_MODE_EXIT_VARIANT) return 'inactive';
      if (origin.variant === DYNAMIC_WORKFLOW_MODE_INJECTION_VARIANT) return 'active';
    }
    return undefined;
  }
}
