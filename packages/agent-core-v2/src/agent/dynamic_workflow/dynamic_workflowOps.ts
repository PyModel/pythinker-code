/**
 * `dynamic_workflow` domain — wire Model (`DynamicWorkflowModel`) and the `dynamic_workflow_mode.enter` /
 * `dynamic_workflow_mode.exit` Ops (`dynamic_workflowEnter` / `dynamic_workflowExit`) for the agent's dynamic_workflow mode.
 *
 * Declares dynamic_workflow mode as a `DynamicWorkflowModeTrigger | null` wire Model (the trigger is
 * retained, not collapsed to a boolean, so `shouldAutoExit` can still
 * distinguish `task` / `tool`) plus the two Ops that set and clear it; the
 * `apply` functions are the pure extraction of the former live `applyEnter` /
 * `applyExit` and `resume` facets.
 */

import { z } from 'zod';

import { defineModel } from '#/wire/model';

import type { DynamicWorkflowModeTrigger } from './dynamic_workflow';

export const DynamicWorkflowModel = defineModel<DynamicWorkflowModeTrigger | null>('dynamic_workflow', () => null);

declare module '#/wire/types' {
  interface PersistedOpMap {
    'dynamic_workflow_mode.enter': typeof dynamic_workflowEnter;
    'dynamic_workflow_mode.exit': typeof dynamic_workflowExit;
  }
}

export const dynamic_workflowEnter = DynamicWorkflowModel.defineOp('dynamic_workflow_mode.enter', {
  schema: z.object({ trigger: z.custom<DynamicWorkflowModeTrigger>() }),
  apply: (_s, p) => p.trigger,
  toEvent: () => ({ type: 'agent.status.updated' as const, dynamicWorkflowMode: true }),
});

export const dynamic_workflowExit = DynamicWorkflowModel.defineOp('dynamic_workflow_mode.exit', {
  schema: z.object({}),
  apply: () => null,
  toEvent: () => ({ type: 'agent.status.updated' as const, dynamicWorkflowMode: false }),
});
