import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { SessionTeam } from '../../../session/team';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { matchesGlobRuleSubject } from '../../support/rule-match';

export const TeamCreateInputSchema = z
  .object({
    team_name: z.string(),
    description: z.string().optional(),
    agent_type: z.string().optional(),
  })
  .strict();
export type TeamCreateInput = z.infer<typeof TeamCreateInputSchema>;

export const TeamDeleteInputSchema = z.object({}).strict();
export type TeamDeleteInput = z.infer<typeof TeamDeleteInputSchema>;

const StructuredMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('shutdown_request'),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('shutdown_response'),
    request_id: z.string(),
    approve: z.boolean(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('plan_approval_response'),
    request_id: z.string(),
    approve: z.boolean(),
    feedback: z.string().optional(),
  }),
]);

export const SendMessageInputSchema = z
  .object({
    to: z.string().trim().min(1),
    summary: z.string().optional(),
    message: z.union([z.string(), StructuredMessageSchema]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.to.includes('@')) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must be a bare teammate name or "*"',
      });
    }
    if (
      typeof input.message === 'string' &&
      input.summary !== undefined &&
      input.summary.trim().length > 0
    ) {
      return;
    }
    if (typeof input.message === 'string') {
      context.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'summary is required when message is a string',
      });
    }
    if (typeof input.message !== 'string' && input.to === '*') {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'structured messages cannot be broadcast',
      });
    }
    if (
      typeof input.message !== 'string' &&
      input.message.type === 'shutdown_response' &&
      input.to !== 'team-lead'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'shutdown_response must be sent to "team-lead"',
      });
    }
    if (
      typeof input.message !== 'string' &&
      input.message.type === 'shutdown_response' &&
      !input.message.approve &&
      input.message.reason !== undefined &&
      input.message.reason.trim().length > 0
    ) {
      return;
    }
    if (
      typeof input.message !== 'string' &&
      input.message.type === 'shutdown_response' &&
      !input.message.approve
    ) {
      context.addIssue({
        code: 'custom',
        path: ['message', 'reason'],
        message: 'reason is required when rejecting a shutdown request',
      });
    }
  });
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export class TeamCreateTool implements BuiltinTool<TeamCreateInput> {
  readonly name = 'TeamCreate' as const;
  readonly description = 'Create one persistent named team for coordinated agent work.';
  readonly parameters = toInputJsonSchema(TeamCreateInputSchema);

  constructor(
    private readonly team: SessionTeam,
    private readonly leadModel: string,
  ) {}

  resolveExecution(args: TeamCreateInput): ToolExecution {
    return {
      description: `Creating team: ${args.team_name}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.team_name),
      execute: async () => {
        try {
          const state = await this.team.create({
            name: args.team_name,
            description: args.description,
            agentType: args.agent_type,
            leadModel: this.leadModel,
          });
          return {
            output: JSON.stringify(
              {
                team_name: state.name,
                team_file_path: 'session://team',
                lead_agent_id: state.leadAgentId,
              },
              null,
              2,
            ),
          };
        } catch (error) {
          return { output: errorMessage(error), isError: true };
        }
      },
    };
  }
}

export class TeamDeleteTool implements BuiltinTool<TeamDeleteInput> {
  readonly name = 'TeamDelete' as const;
  readonly description = 'Delete the current team after all teammates are idle or shut down.';
  readonly parameters = toInputJsonSchema(TeamDeleteInputSchema);

  constructor(private readonly team: SessionTeam) {}

  resolveExecution(): ToolExecution {
    return {
      description: 'Deleting current team',
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, 'current'),
      execute: async () => {
        const result = await this.team.delete();
        return {
          output: JSON.stringify(
            {
              success: result.success,
              message: result.message,
              team_name: result.teamName,
            },
            null,
            2,
          ),
        };
      },
    };
  }
}

export class SendMessageTool implements BuiltinTool<SendMessageInput> {
  readonly name = 'SendMessage' as const;
  readonly description = 'Send a direct, broadcast, shutdown, or plan response to a teammate.';
  readonly parameters = toInputJsonSchema(SendMessageInputSchema);

  constructor(
    private readonly team: SessionTeam,
    private readonly senderAgentId: string,
  ) {}

  resolveExecution(args: SendMessageInput): ToolExecution {
    return {
      description: args.to === '*' ? 'Broadcasting to team' : `Messaging ${args.to}`,
      accesses: ToolAccesses.none(),
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.to),
      execute: async () => {
        try {
          const result = await this.team.send(this.senderAgentId, args);
          return {
            output: JSON.stringify(
              {
                success: result.success,
                message: result.message,
                recipients: result.recipients,
                request_id: result.requestId,
              },
              null,
              2,
            ),
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
