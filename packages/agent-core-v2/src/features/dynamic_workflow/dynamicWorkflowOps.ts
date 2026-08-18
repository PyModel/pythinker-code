/* oxlint-disable typescript-eslint/no-unsafe-declaration-merging, eslint-plugin-import/namespace -- Event2 class+payload-interface declaration merging is the sanctioned event-declaration idiom. */
import { z } from 'zod';

import { contextMemoryKey, popDynamicWorkflowModeReminder } from '#/agent/contextMemory/contextOps';
import { AgentStatusUpdated } from '#/agent/usage/usageEvents';
import { Event2 } from '#/app/event/event2';
import { defineState } from '#/state/state';

import type { DynamicWorkflowModeTrigger } from './agent/dynamic_workflow';

const dynamicWorkflowModeEnterSchema = z.object({ trigger: z.custom<DynamicWorkflowModeTrigger>() });

export class DynamicWorkflowModeEnter extends Event2<z.infer<typeof dynamicWorkflowModeEnterSchema>> {
  static override readonly type = 'dynamic_workflow_mode.enter';
  static override readonly durable = true;
  static override readonly schema = dynamicWorkflowModeEnterSchema;
}
export interface DynamicWorkflowModeEnter extends z.infer<typeof dynamicWorkflowModeEnterSchema> {}

const dynamicWorkflowModeExitSchema = z.object({});

export class DynamicWorkflowModeExit extends Event2<z.infer<typeof dynamicWorkflowModeExitSchema>> {
  static override readonly type = 'dynamic_workflow_mode.exit';
  static override readonly durable = true;
  static override readonly schema = dynamicWorkflowModeExitSchema;
}
export interface DynamicWorkflowModeExit extends z.infer<typeof dynamicWorkflowModeExitSchema> {}

export const dynamicWorkflowKey = defineState('dynamic_workflow', (): DynamicWorkflowModeTrigger | null => null).replayable({
  schema: z.custom<DynamicWorkflowModeTrigger | null>(),
})
  .on(DynamicWorkflowModeEnter, (_s, e, ctx) => {
    ctx.emit(new AgentStatusUpdated({ dynamicWorkflowMode: true }));
    return e.trigger;
  })
  .on(DynamicWorkflowModeExit, (_s, _e, ctx) => {
    ctx.emit(new AgentStatusUpdated({ dynamicWorkflowMode: false }));
    return null;
  });

contextMemoryKey.on(DynamicWorkflowModeExit, (s) => popDynamicWorkflowModeReminder(s));
