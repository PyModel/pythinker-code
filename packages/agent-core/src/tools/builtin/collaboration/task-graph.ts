import { z } from 'zod';

import type { BackgroundManager } from '../../../agent/background';
import type { HookEngine } from '../../../session/hooks';
import {
  ProjectTaskStatusSchema,
  type SessionTaskGraph,
  type UpdateProjectTask,
} from '../../../agent/task-graph';
import type { BuiltinTool } from '../../../agent/tool';
import type { SessionTeam } from '../../../session/team';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { formatTaskList } from '../../background/task-list';
import { toInputJsonSchema } from '../../support/input-schema';
import { matchesGlobRuleSubject } from '../../support/rule-match';
import {
  needsVerificationNudge,
  VERIFICATION_NUDGE,
} from '../../support/verification-nudge';

export const TaskCreateInputSchema = z
  .object({
    subject: z.string().min(1).describe('A brief title for the task'),
    description: z.string().min(1).describe('What needs to be done'),
    activeForm: z.string().min(1).optional().describe('Present-continuous activity label'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type TaskCreateInput = z.infer<typeof TaskCreateInputSchema>;

export const TaskGetInputSchema = z
  .object({
    taskId: z.string().min(1),
  })
  .strict();
export type TaskGetInput = z.infer<typeof TaskGetInputSchema>;

export const TaskUpdateInputSchema = z
  .object({
    taskId: z.string().min(1),
    subject: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    activeForm: z.string().min(1).optional(),
    status: z.union([ProjectTaskStatusSchema, z.literal('deleted')]).optional(),
    addBlocks: z.array(z.string().min(1)).optional(),
    addBlockedBy: z.array(z.string().min(1)).optional(),
    owner: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type TaskUpdateInput = z.infer<typeof TaskUpdateInputSchema>;

export const TaskGraphListInputSchema = z
  .object({
    background: z.boolean().optional().describe('List background executions instead'),
    active_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type TaskGraphListInput = z.infer<typeof TaskGraphListInputSchema>;

export class TaskCreateTool implements BuiltinTool<TaskCreateInput> {
  readonly name = 'TaskCreate' as const;
  readonly description =
    'Create a persistent project task with a subject, description, optional activity label, and metadata.';
  readonly parameters = toInputJsonSchema(TaskCreateInputSchema);

  constructor(
    private readonly graph: SessionTaskGraph,
    private readonly hooks?: HookEngine,
    private readonly agentId?: string,
  ) {}

  resolveExecution(args: TaskCreateInput): ToolExecution {
    return {
      description: `Creating task: ${args.subject}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.subject),
      execute: async (context) => {
        const task = await this.graph.create(args);
        const blocked = await this.hooks?.triggerBlock('TaskCreated', {
          signal: context.signal,
          inputData: {
            agentId: this.agentId,
            taskId: task.id,
            taskSubject: task.subject,
            taskDescription: task.description,
          },
        });
        if (blocked !== undefined) {
          await this.graph.update(task.id, { status: 'deleted' });
          return {
            isError: true,
            output: `TaskCreated hook feedback:\n${blocked.reason}`,
          };
        }
        return { output: `Task #${task.id} created successfully: ${task.subject}` };
      },
    };
  }
}

export class TaskGetTool implements BuiltinTool<TaskGetInput> {
  readonly name = 'TaskGet' as const;
  readonly description = 'Get the full details and dependencies of one persistent project task.';
  readonly parameters = toInputJsonSchema(TaskGetInputSchema);

  constructor(private readonly graph: SessionTaskGraph) {}

  resolveExecution(args: TaskGetInput): ToolExecution {
    return {
      description: `Getting task #${args.taskId}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.taskId),
      execute: async () => {
        const task = await this.graph.get(args.taskId);
        if (task === null) return { output: 'Task not found' };
        const lines = [
          `Task #${task.id}: ${task.subject}`,
          `Status: ${task.status}`,
          `Description: ${task.description}`,
        ];
        if (task.activeForm !== undefined) lines.push(`Active form: ${task.activeForm}`);
        if (task.owner !== undefined) lines.push(`Owner: ${task.owner}`);
        if (task.blockedBy.length > 0) lines.push(`Blocked by: ${formatIds(task.blockedBy)}`);
        if (task.blocks.length > 0) lines.push(`Blocks: ${formatIds(task.blocks)}`);
        if (task.metadata !== undefined) {
          lines.push(`Metadata: ${JSON.stringify(task.metadata, null, 2)}`);
        }
        return { output: lines.join('\n') };
      },
    };
  }
}

export class TaskUpdateTool implements BuiltinTool<TaskUpdateInput> {
  readonly name = 'TaskUpdate' as const;
  readonly description =
    'Update or delete a persistent project task, including ownership, status, metadata, and dependencies.';
  readonly parameters = toInputJsonSchema(TaskUpdateInputSchema);

  constructor(
    private readonly graph: SessionTaskGraph,
    private readonly team?: SessionTeam,
    private readonly agentId?: string,
    private readonly mainAgent = true,
    private readonly hooks?: HookEngine,
  ) {}

  resolveExecution(args: TaskUpdateInput): ToolExecution {
    return {
      description: `Updating task #${args.taskId}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.taskId),
      execute: async (context) => {
        if (args.status === 'completed') {
          const task = await this.graph.get(args.taskId);
          if (task !== null && task.status !== 'completed') {
            const blocked = await this.hooks?.triggerBlock('TaskCompleted', {
              signal: context.signal,
              inputData: {
                agentId: this.agentId,
                taskId: task.id,
                taskSubject: task.subject,
                taskDescription: task.description,
              },
            });
            if (blocked !== undefined) {
              return {
                isError: true,
                output: `TaskCompleted hook feedback:\n${blocked.reason}`,
              };
            }
          }
        }
        let owner = args.owner;
        if (
          owner === undefined &&
          args.status === 'in_progress' &&
          this.team !== undefined &&
          this.agentId !== undefined
        ) {
          const existing = await this.graph.get(args.taskId);
          if (existing?.owner === undefined) {
            owner = await this.team.memberName(this.agentId);
          }
        }
        const patch: UpdateProjectTask = {
          subject: args.subject,
          description: args.description,
          activeForm: args.activeForm,
          status: args.status,
          owner,
          metadata: args.metadata,
          addBlocks: args.addBlocks,
          addBlockedBy: args.addBlockedBy,
        };
        try {
          const result = await this.graph.update(args.taskId, patch);
          if (
            owner !== undefined &&
            owner.length > 0 &&
            result.updatedFields.includes('owner') &&
            this.team !== undefined &&
            this.agentId !== undefined
          ) {
            await this.team
              .send(this.agentId, {
                to: owner,
                summary: `Assigned task #${args.taskId}`,
                message: JSON.stringify({
                  type: 'task_assignment',
                  taskId: args.taskId,
                  subject: result.task?.subject,
                  description: result.task?.description,
                }),
              })
              .catch(() => undefined);
          }
          const fields = result.updatedFields.join(', ');
          const teamMemberName =
            args.status === 'completed' &&
            this.team !== undefined &&
            this.agentId !== undefined
              ? await this.team.memberName(this.agentId)
              : undefined;
          const completedReminder =
            teamMemberName !== undefined && teamMemberName !== 'team-lead'
              ? '\n\nTask completed. Call TaskList now to find your next available task.'
              : '';
          const projectTasks =
            this.mainAgent && args.status === 'completed'
              ? (await this.graph.list()).filter((task) => task.metadata?.['_internal'] !== true)
              : [];
          const verificationNudge =
            projectTasks.length > 0 &&
            projectTasks.every((task) => task.status === 'completed') &&
            needsVerificationNudge(projectTasks.map((task) => task.subject))
              ? VERIFICATION_NUDGE
              : '';
          return {
            output:
              result.updatedFields.length === 0
                ? `Task #${args.taskId} unchanged`
                : `Task #${args.taskId} updated: ${fields}${completedReminder}${verificationNudge}`,
          };
        } catch (error) {
          const output = error instanceof Error ? error.message : String(error);
          return {
            output,
            isError: !/^Task #.+ not found$/u.test(output),
          };
        }
      },
    };
  }
}

export class TaskGraphListTool implements BuiltinTool<TaskGraphListInput> {
  readonly name = 'TaskList' as const;
  readonly description =
    'List persistent project tasks. Pass background=true to list background shell, agent, and question executions.';
  readonly parameters = toInputJsonSchema(TaskGraphListInputSchema);

  constructor(
    private readonly graph: SessionTaskGraph,
    private readonly background: BackgroundManager,
  ) {}

  resolveExecution(args: TaskGraphListInput): ToolExecution {
    const subject = args.background === true ? 'background' : 'project';
    return {
      description:
        args.background === true ? 'Listing background tasks' : 'Listing project tasks',
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, subject),
      execute: async () => {
        if (args.background === true) {
          const activeOnly = args.active_only ?? true;
          return {
            output: formatTaskList(
              this.background.list(activeOnly, args.limit ?? 20),
              activeOnly,
            ),
          };
        }
        const tasks = (await this.graph.list()).filter(
          (task) => task.metadata?.['_internal'] !== true,
        );
        const completed = new Set(
          tasks.filter((task) => task.status === 'completed').map((task) => task.id),
        );
        if (tasks.length === 0) return { output: 'No tasks found' };
        return {
          output: tasks
            .map((task) => {
              const owner = task.owner === undefined ? '' : ` (${task.owner})`;
              const blockers = task.blockedBy.filter((id) => !completed.has(id));
              const blocked =
                blockers.length === 0 ? '' : ` [blocked by ${formatIds(blockers)}]`;
              return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
            })
            .join('\n'),
        };
      },
    };
  }
}

function formatIds(ids: readonly string[]): string {
  return ids.map((id) => `#${id}`).join(', ');
}
