/**
 * AgentTool — collaboration tool for spawning task subagents.
 *
 * Unlike the built-in tools (Read/Write/Edit/Bash/Grep/Glob), this is a
 * "collaboration tool". It uses `SessionSubagentHost` (injected via the
 * constructor rather than through the Runtime) to create in-process subagent
 * loop instances.
 *
 * Two modes:
 *   - **Foreground** (default): blocks the parent turn, `await handle.completion`
 *   - **Background**: returns the agent id immediately; the result is delivered
 *     via a notification.
 *
 * `ToolResult.content` is textual; the structured output exposed by
 * `AgentToolOutputSchema` is only used for drift-guard and is not consumed at
 * runtime.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { Logger } from '../../../logging';
import { ToolAccesses } from '../../../loop/tool-access';
import { isAbortError } from '../../../loop/errors';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type { ResolvedAgentProfile } from '../../../profile';
import {
  DEFAULT_SUBAGENT_TIMEOUT_DESCRIPTION,
  DEFAULT_SUBAGENT_TIMEOUT_MS,
  type SessionSubagentHost,
  type SubagentHandle,
} from '../../../session/subagent-host';
import type { SessionTeam } from '../../../session/team';
import {
  createDeadlineAbortSignal,
  isUserCancellation,
  type DeadlineAbortSignal,
} from '../../../utils/abort';
import { AgentBackgroundTask, type BackgroundManager } from '../../../agent/background';
import { toInputJsonSchema } from '../../support/input-schema';
import { matchesGlobRuleSubject } from '../../support/rule-match';
import AGENT_BACKGROUND_DISABLED_DESCRIPTION from './agent-background-disabled.md?raw';
import AGENT_BACKGROUND_DESCRIPTION from './agent-background-enabled.md?raw';
import AGENT_DESCRIPTION_BASE from './agent.md?raw';

// ── AgentTool input ──────────────────────────────────────────────────

function createAgentToolInputSchema(forkContextEnabled: boolean, teamsEnabled = false) {
  const schema = z.object({
    prompt: z.string().describe('Full task prompt for the subagent'),
    description: z.string().describe('Short task description (3-5 words) for UI display'),
    subagent_type: z
      .string()
      .optional()
      .describe(
        forkContextEnabled
          ? 'One of the available agent types (see "Available agent types" in this tool description). Omit to fork the parent context into a background worker.'
          : 'One of the available agent types (see "Available agent types" in this tool description). Defaults to "coder" when omitted.',
      ),
    model: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional configured model alias for this new subagent'),
    cwd: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Optional absolute working directory for this new subagent'),
    isolation: z
      .literal('worktree')
      .optional()
      .describe('Create a dedicated Git worktree for this new subagent'),
    resume: z
      .string()
      .optional()
      .describe('Optional agent ID to resume instead of creating a new instance'),
    run_in_background: z
      .boolean()
      .optional()
      .describe(
        'If true, return immediately without waiting for completion. Prefer false unless the task can run independently and there is a clear benefit to not waiting.',
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Name for a persistent teammate addressable through SendMessage'),
    team_name: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Active team name; omitted to use the current team'),
  });
  return z.preprocess(
    (input) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return input;
    }
    const record = input as Record<string, unknown>;
    const normalized = { ...record };
    const hasResumeId =
      typeof normalized['resume'] === 'string' && normalized['resume'].trim().length > 0;
    const hasSubagentType =
      typeof normalized['subagent_type'] === 'string' && normalized['subagent_type'].length > 0;
    if (!forkContextEnabled && !hasSubagentType && !hasResumeId) {
      normalized['subagent_type'] = 'coder';
    } else if (!hasSubagentType) {
      delete normalized['subagent_type'];
    }
    return normalized;
  },
    teamsEnabled ? schema : schema.omit({ name: true, team_name: true }),
  );
}

export const AgentToolInputSchema = createAgentToolInputSchema(false);

export type AgentToolInput = z.infer<typeof AgentToolInputSchema> & {
  readonly name?: string;
  readonly team_name?: string;
};

// ── AgentTool output ─────────────────────────────────────────────────

export const AgentToolOutputSchema = z.object({
  result: z.string().describe('Aggregated text output from the subagent'),
  usage: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cache_read: z.number().int().nonnegative().optional(),
      cache_write: z.number().int().nonnegative().optional(),
    })
    .describe('Cumulative token usage'),
});

export type AgentToolOutput = z.infer<typeof AgentToolOutputSchema>;

const BACKGROUND_AGENT_UNAVAILABLE =
  'Background agent execution is not available for this agent because TaskList, TaskOutput, and TaskStop are not enabled.';

// ── AgentTool class ──────────────────────────────────────────────────

export class AgentTool implements BuiltinTool<AgentToolInput> {
  readonly name: string = 'Agent';
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  constructor(
    private readonly subagentHost: SessionSubagentHost,
    private readonly backgroundManager?: BackgroundManager | undefined,
    subagents?: ResolvedAgentProfile['subagents'] | undefined,
    options?: {
      log?: Logger;
      forkContextEnabled?: boolean;
      teamsEnabled?: boolean;
      team?: SessionTeam;
      agentId?: string;
      modelAlias?: string;
    },
  ) {
    const log = options?.log;
    this.subagents = subagents;
    this.forkContextEnabled = options?.forkContextEnabled === true;
    this.teamsEnabled = options?.teamsEnabled === true;
    this.team = options?.team;
    this.agentId = options?.agentId ?? 'main';
    this.modelAlias = options?.modelAlias ?? 'unknown';
    this.parameters = toInputJsonSchema(
      createAgentToolInputSchema(this.forkContextEnabled, this.teamsEnabled),
    );
    const typeLines = buildSubagentDescriptions(subagents);
    const baseDescription = `${AGENT_DESCRIPTION_BASE}\n\n${
      this.backgroundManager !== undefined ? AGENT_BACKGROUND_DESCRIPTION : AGENT_BACKGROUND_DISABLED_DESCRIPTION
    }`;
    this.description = typeLines
      ? `${baseDescription}\n\nAvailable agent types (pass via subagent_type):\n${typeLines}`
      : baseDescription;
    this.log = log;
  }

  private readonly log?: Logger;
  private readonly forkContextEnabled: boolean;
  private readonly teamsEnabled: boolean;
  private readonly team?: SessionTeam;
  private readonly agentId: string;
  private readonly modelAlias: string;
  private readonly subagents?: ResolvedAgentProfile['subagents'];

  async resolveExecution(args: AgentToolInput): Promise<ToolExecution> {
    let profileName =
      args.subagent_type?.trim() ||
      (args.name !== undefined ? 'coder' : this.forkContextEnabled ? 'fork' : 'coder');
    const resumeAgentId = args.resume?.trim();
    const isResume = resumeAgentId !== undefined && resumeAgentId.length > 0;
    if (isResume) {
      profileName = (await this.subagentHost.getProfileName?.(resumeAgentId)) ?? 'subagent';
    }
    const isolation =
      args.isolation ?? (!isResume ? this.subagents?.[profileName]?.isolation : undefined);
    const prefix =
      args.run_in_background === true ||
      args.name !== undefined ||
      profileName === 'fork' ||
      this.subagents?.[profileName]?.background === true
        ? 'Launching background'
        : 'Launching';
    return {
      description: `${prefix} ${profileName} agent: ${args.description}`,
      accesses: ToolAccesses.none(),
      display: {
        kind: 'agent_call',
        agent_name: args.name ?? profileName,
        prompt: args.prompt,
        background: args.run_in_background,
        isolation,
        cwd: args.cwd,
      },
      approvalRule: this.name,
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, profileName),
      execute: (ctx) => this.execution({ ...args, isolation }, ctx),
    };
  }

  private async execution(
    args: AgentToolInput,
    {
    toolCallId,
    signal,
    }: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    let foregroundDeadline: DeadlineAbortSignal | undefined;
    try {
      signal.throwIfAborted();
      let requestedProfileName = args.subagent_type?.trim() || undefined;
      const resumeAgentId = args.resume?.trim();
      const teammateName = args.name?.trim();
      if (args.team_name !== undefined && teammateName === undefined) {
        return { output: 'team_name requires a teammate name.', isError: true };
      }
      let teamName: string | undefined;
      if (teammateName !== undefined) {
        if (!this.teamsEnabled || this.team === undefined) {
          return { output: 'Agent teams are not enabled.', isError: true };
        }
        if (this.agentId !== 'main') {
          return {
            output:
              'Teammates cannot spawn other teammates. Omit name to create a regular subagent.',
            isError: true,
          };
        }
        const state = await this.team.get();
        teamName = args.team_name ?? state?.name;
        if (state === null || teamName === undefined) {
          return { output: 'Create a team before spawning a named teammate.', isError: true };
        }
        if (teamName !== state.name) {
          return {
            output: `Team "${teamName}" does not match active team "${state.name}".`,
            isError: true,
          };
        }
        requestedProfileName ??= 'coder';
      }
      const forkContext =
        this.forkContextEnabled &&
        requestedProfileName === undefined &&
        !resumeAgentId &&
        teammateName === undefined;
      const profileRunsInBackground =
        requestedProfileName !== undefined &&
        this.subagents?.[requestedProfileName]?.background === true;
      const runInBackground =
        args.run_in_background === true ||
        teammateName !== undefined ||
        forkContext ||
        profileRunsInBackground;
      if (args.cwd !== undefined && args.isolation === 'worktree') {
        return {
          output: 'Cannot combine cwd with isolation: "worktree".',
          isError: true,
        };
      }
      if (
        resumeAgentId !== undefined &&
        resumeAgentId.length > 0 &&
        (
          requestedProfileName !== undefined ||
          args.model !== undefined ||
          args.cwd !== undefined ||
          args.isolation !== undefined ||
          teammateName !== undefined ||
          args.team_name !== undefined
        )
      ) {
        return {
          output:
            'Cannot set subagent_type, model, cwd, or isolation when resuming an existing agent. Resume by agent id only.',
          isError: true,
        };
      }

      if (runInBackground) {
        if (this.backgroundManager === undefined) {
          return {
            output: BACKGROUND_AGENT_UNAVAILABLE,
            isError: true,
          };
        }
      }
      const backgroundController = runInBackground ? new AbortController() : undefined;
      foregroundDeadline =
        !runInBackground ? createDeadlineAbortSignal(signal, DEFAULT_SUBAGENT_TIMEOUT_MS) : undefined;

      const options = {
        parentToolCallId: toolCallId,
        prompt: args.prompt,
        description: args.description,
        displayName: teammateName,
        runInBackground,
        modelAlias: args.model,
        cwd: args.cwd,
        isolation: args.isolation,
        forkContext,
        signal: backgroundController?.signal ?? foregroundDeadline?.signal ?? signal,
      };

      let handle: SubagentHandle;
      const operation = resumeAgentId !== undefined && resumeAgentId.length > 0 ? 'resume' : 'spawn';
      try {
        if (resumeAgentId !== undefined && resumeAgentId.length > 0) {
          handle = await this.subagentHost.resume(resumeAgentId, options);
        } else {
          const profileName = requestedProfileName ?? (forkContext ? 'fork' : 'coder');
          handle = await this.subagentHost.spawn({
            profileName,
            ...options,
          });
        }
        if (teammateName !== undefined) {
          try {
            await this.team!.join({
              teamName: teamName!,
              agentId: handle.agentId,
              name: teammateName,
              agentType: handle.profileName,
              model: args.model ?? this.modelAlias,
            });
          } catch (error) {
            backgroundController?.abort(error);
            throw error;
          }
          void handle.completion.then(
            () => this.team!.markIdle(handle.agentId),
            () => this.team!.markIdle(handle.agentId),
          );
        }
      } catch (error) {
        this.log?.warn('subagent launch failed', {
          toolCallId,
          runInBackground,
          operation,
          agentId: resumeAgentId,
          subagentType:
            operation === 'spawn'
              ? requestedProfileName ?? (forkContext ? 'fork' : 'coder')
              : undefined,
          error,
        });
        throw error;
      }

      if (runInBackground) {
        let taskId: string;
        try {
          taskId = this.backgroundManager!.registerTask(
            new AgentBackgroundTask(handle.completion, args.description, {
              timeoutMs: DEFAULT_SUBAGENT_TIMEOUT_MS,
              agentId: handle.agentId,
              subagentType: handle.profileName,
              abort: () => {
                backgroundController?.abort();
              },
            }),
          );
        } catch (error) {
          backgroundController?.abort();
          void handle.completion.catch(() => {});
          this.log?.warn('background agent task registration failed', {
            toolCallId,
            agentId: handle.agentId,
            subagentType: handle.profileName,
            error,
          });
          return {
            output: error instanceof Error ? error.message : String(error),
            isError: true,
          };
        }
        const lines = [
          `task_id: ${taskId}`,
          'status: running',
          `agent_id: ${handle.agentId}`,
          `actual_subagent_type: ${handle.profileName}`,
          ...(teammateName === undefined
            ? []
            : [`teammate_name: ${teammateName}`, `team_name: ${teamName!}`]),
          'automatic_notification: true',
          '',
          `description: ${args.description}`,
          '',
          `next_step: The completion arrives automatically in a later turn — no polling needed. To peek at progress without blocking, call TaskOutput(task_id="${taskId}", block=false).`,
          `resume_hint: To continue or recover this same subagent later, call Agent(resume="${handle.agentId}", prompt="..."). The parameter is agent_id ("${handle.agentId}"), NOT task_id ("${taskId}") or source_id from a later <notification>. Recovery cases: a later <notification type="task.lost" | "task.failed" | "task.killed"> for this subagent — its conversation history is preserved across session restarts and resume will pick it up.`,
        ];
        return { output: lines.join('\n') };
      }

      try {
        const result = await handle.completion;
        const lines = [
          `agent_id: ${handle.agentId}`,
          `actual_subagent_type: ${handle.profileName}`,
          'status: completed',
          '',
          '[summary]',
          result.result,
        ];
        return { output: lines.join('\n') };
      } catch (error) {
        let message: string;
        const timedOut = foregroundDeadline?.timedOut() === true;
        if (timedOut) {
          message = `Agent timed out after ${DEFAULT_SUBAGENT_TIMEOUT_DESCRIPTION}.`;
        } else if (isUserCancellation(signal.reason)) {
          message =
            'The user manually interrupted this subagent (and any sibling agents launched alongside it). This was a deliberate user action, not a system error, a timeout, or a capacity/concurrency limit. Do not retry automatically or speculate about why it failed — wait for the user\'s next instruction.';
        } else if (isAbortError(error)) {
          message = 'The subagent was stopped before it finished.';
        } else {
          message = error instanceof Error ? error.message : String(error);
        }
        const lines = [
          `agent_id: ${handle.agentId}`,
          `actual_subagent_type: ${handle.profileName}`,
          'status: failed',
          '',
          `subagent error: ${message}`,
        ];
        if (timedOut) {
          lines.push(
            `resume_hint: Continue with Agent(resume="${handle.agentId}", prompt="continue"). Use agent_id only; do not set subagent_type. The subagent retains its prior context; redo any unfinished tool call if its result was lost.`,
          );
        }
        return { output: lines.join('\n'), isError: true };
      }
    } catch (error) {
      let message: string;
      if (foregroundDeadline?.timedOut() === true) {
        message = `Agent timed out after ${DEFAULT_SUBAGENT_TIMEOUT_DESCRIPTION}.`;
      } else if (isUserCancellation(signal.reason)) {
        message =
          'The user manually interrupted this subagent (and any sibling agents launched alongside it). This was a deliberate user action, not a system error, a timeout, or a capacity/concurrency limit. Do not retry automatically or speculate about why it failed — wait for the user\'s next instruction.';
      } else if (isAbortError(error)) {
        message = 'The subagent was stopped before it finished.';
      } else {
        message = error instanceof Error ? error.message : String(error);
      }
      return { output: `subagent error: ${message}`, isError: true };
    } finally {
      foregroundDeadline?.clear();
    }
  }
}

function buildSubagentDescriptions(subagents: ResolvedAgentProfile['subagents']): string {
  if (subagents === undefined) return '';
  return Object.entries(subagents)
    .map(([name, subagent]) => {
      const details = [subagent.description, subagent.whenToUse].filter(
        (part): part is string => part !== undefined && part.length > 0,
      );
      const header = details.length === 0 ? `- ${name}` : `- ${name}: ${details.join(' ')}`;
      if (subagent.tools.length === 0) return header;
      return `${header}\n  Tools: ${subagent.tools.join(', ')}`;
    })
    .join('\n');
}
