import { z } from 'zod';

import type { Agent } from '../../agent';
import type { BuiltinTool } from '../../agent/tool';
import { ToolAccesses } from '../../loop/tool-access';
import type { ToolExecution } from '../../loop/types';
import type { SessionWorktree } from '../../session/worktree';
import { validateWorktreeName } from '../../session/subagent-worktree';
import { toInputJsonSchema } from '../support/input-schema';
import { matchesGlobRuleSubject } from '../support/rule-match';

export const EnterWorktreeInputSchema = z
  .object({
    name: z
      .string()
      .superRefine((value, context) => {
        try {
          validateWorktreeName(value);
        } catch (error) {
          context.addIssue({
            code: 'custom',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })
      .optional(),
  })
  .strict();
export type EnterWorktreeInput = z.infer<typeof EnterWorktreeInputSchema>;

export const ExitWorktreeInputSchema = z
  .object({
    action: z.enum(['keep', 'remove']),
    discard_changes: z.boolean().optional(),
  })
  .strict();
export type ExitWorktreeInput = z.infer<typeof ExitWorktreeInputSchema>;

export class EnterWorktreeTool implements BuiltinTool<EnterWorktreeInput> {
  readonly name = 'EnterWorktree' as const;
  readonly description =
    'Create an isolated Git worktree and switch this session into it. Use only when the user explicitly asks for a worktree.';
  readonly parameters = toInputJsonSchema(EnterWorktreeInputSchema);

  constructor(
    private readonly worktree: SessionWorktree,
    private readonly agent: Agent,
  ) {}

  resolveExecution(args: EnterWorktreeInput): ToolExecution {
    return {
      description: args.name === undefined ? 'Creating worktree' : `Creating worktree: ${args.name}`,
      accesses: ToolAccesses.all(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.name ?? 'new'),
      execute: async () => {
        try {
          const state = await this.worktree.enter(this.agent, args.name);
          return {
            output: `Created worktree at ${state.worktreePath}${state.worktreeBranch === undefined ? '' : ` on branch ${state.worktreeBranch}`}. The session is now working in the worktree.`,
          };
        } catch (error) {
          return { output: errorMessage(error), isError: true };
        }
      },
    };
  }
}

export class ExitWorktreeTool implements BuiltinTool<ExitWorktreeInput> {
  readonly name = 'ExitWorktree' as const;
  readonly description =
    'Exit the worktree created by EnterWorktree and either preserve or explicitly remove it.';
  readonly parameters = toInputJsonSchema(ExitWorktreeInputSchema);

  constructor(
    private readonly worktree: SessionWorktree,
    private readonly agent: Agent,
  ) {}

  resolveExecution(args: ExitWorktreeInput): ToolExecution {
    return {
      description: `${args.action === 'keep' ? 'Keeping' : 'Removing'} worktree`,
      accesses: ToolAccesses.all(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.action),
      execute: async () => {
        try {
          const result = await this.worktree.exit(this.agent, {
            action: args.action,
            discardChanges: args.discard_changes,
          });
          if (result.action === 'keep') {
            return {
              output: `Exited worktree. Work is preserved at ${result.worktreePath}${result.worktreeBranch === undefined ? '' : ` on branch ${result.worktreeBranch}`}. Session is now back in ${result.originalCwd}.`,
            };
          }
          const discarded: string[] = [];
          if ((result.discardedCommits ?? 0) > 0) {
            discarded.push(`${String(result.discardedCommits)} commits`);
          }
          if ((result.discardedFiles ?? 0) > 0) {
            discarded.push(`${String(result.discardedFiles)} uncommitted files`);
          }
          return {
            output: `Exited and removed worktree at ${result.worktreePath}.${discarded.length === 0 ? '' : ` Discarded ${discarded.join(' and ')}.`} Session is now back in ${result.originalCwd}.`,
          };
        } catch (error) {
          return { output: errorMessage(error), isError: true };
        }
      },
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
