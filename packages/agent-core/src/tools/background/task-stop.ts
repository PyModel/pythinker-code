/**
 * TaskStopTool — stop a running background task.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../agent/tool';
import {
  isBackgroundTaskTerminal,
  type BackgroundManager,
} from '../../agent/background';
import type { ToolExecution } from '../../loop/types';
import { toInputJsonSchema } from '../support/input-schema';
import { matchesGlobRuleSubject } from '../support/rule-match';
import TASK_STOP_DESCRIPTION from './task-stop.md?raw';

// ── Input schema ─────────────────────────────────────────────────────

export const TaskStopInputSchema = z.object({
  task_id: z.string().describe('The background task ID to stop.').optional(),
  shell_id: z
    .string()
    .describe('Deprecated alias for task_id, retained for KillShell compatibility.')
    .optional(),
  reason: z
    .string()
    .default('Stopped by TaskStop')
    .describe('Short reason recorded when the task is stopped.')
    .optional(),
}).refine((input) => input.task_id !== undefined || input.shell_id !== undefined, {
  message: 'Missing required parameter: task_id',
});

export type TaskStopInput = z.Infer<typeof TaskStopInputSchema>;

// ── Implementation ───────────────────────────────────────────────────

export class TaskStopTool implements BuiltinTool<TaskStopInput> {
  readonly name = 'TaskStop' as const;
  readonly aliases = ['KillShell'] as const;
  readonly description = TASK_STOP_DESCRIPTION;
  readonly parameters: Record<string, unknown> = {
    ...toInputJsonSchema(TaskStopInputSchema),
    anyOf: [{ required: ['task_id'] }, { required: ['shell_id'] }],
  };

  constructor(private readonly manager: BackgroundManager) {}

  resolveExecution(args: TaskStopInput): ToolExecution {
    const taskId = args.task_id ?? args.shell_id;
    if (taskId === undefined) {
      return { isError: true, output: 'Missing required parameter: task_id' };
    }
    return {
      description: `Stopping task ${taskId}`,
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, taskId),
      execute: async () => {
        const info = this.manager.getTask(taskId);
        if (!info) {
          return { isError: true, output: `Task not found: ${taskId}` };
        }

        // A blank or whitespace-only reason falls back to the default. `?? default`
        // would not cover the empty-string case, so trim and coalesce explicitly.
        const trimmedReason = args.reason?.trim();
        const reason =
          trimmedReason === undefined || trimmedReason.length === 0
            ? 'Stopped by TaskStop'
            : trimmedReason;

        if (isBackgroundTaskTerminal(info.status)) {
          // Already-terminal tasks report their current state using the same
          // structured multi-line format as the normal stop path below.
          return {
            output:
              `task_id: ${info.taskId}\n` +
              `status: ${info.status}\n` +
              // A task persisted by an older build may carry a blank stopReason;
              // `??` would not coalesce `''`, so trim-and-`||` to the placeholder.
              `reason: ${terminalStopReason(info.stopReason)}`,
            isError: false,
          };
        }

        await this.manager.suppressTerminalNotification(taskId);
        const result = await this.manager.stop(taskId, reason);
        if (!result) {
          return { isError: true, output: `Failed to stop task: ${taskId}` };
        }

        return {
          output:
            `task_id: ${result.taskId}\n` +
            `status: ${result.status}\n` +
            `reason: ${result.stopReason ?? reason}`,
          isError: false,
        };
      },
    };
  }
}

function terminalStopReason(reason: string | undefined): string {
  const trimmed = reason?.trim();
  return trimmed === undefined || trimmed.length === 0 ? 'Task already in terminal state' : trimmed;
}
