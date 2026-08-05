import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'pathe';
import { z } from 'zod';

import type { Agent } from '../agent';
import type { SessionTaskGraph } from '../agent/task-graph';

const TeamMemberSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  agentType: z.string(),
  model: z.string(),
  joinedAt: z.string(),
  status: z.enum(['active', 'idle', 'shutdown']),
});

const ShutdownRequestSchema = z.object({
  id: z.string(),
  requesterId: z.string(),
  targetId: z.string(),
});

const TeamStateSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  leadAgentId: z.literal('main'),
  members: z.array(TeamMemberSchema),
  shutdownRequests: z.array(ShutdownRequestSchema),
});

export type TeamState = z.infer<typeof TeamStateSchema>;
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export type StructuredTeamMessage =
  | { readonly type: 'shutdown_request'; readonly reason?: string }
  | {
      readonly type: 'shutdown_response';
      readonly request_id: string;
      readonly approve: boolean;
      readonly reason?: string;
    }
  | {
      readonly type: 'plan_approval_response';
      readonly request_id: string;
      readonly approve: boolean;
      readonly feedback?: string;
    };

export interface SendTeamMessageInput {
  readonly to: string;
  readonly summary?: string;
  readonly message: string | StructuredTeamMessage;
}

export interface SendTeamMessageResult {
  readonly success: boolean;
  readonly message: string;
  readonly recipients?: readonly string[];
  readonly requestId?: string;
}

type SessionAgentResolver = Pick<
  { ensureAgentResumed(id: string): Promise<Agent> },
  'ensureAgentResumed'
>;

export class SessionTeam {
  private state: TeamState | null = null;
  private readonly ready: Promise<void>;
  private mutation = Promise.resolve();

  constructor(
    private readonly session: SessionAgentResolver,
    private readonly persistencePath?: string,
    private readonly taskGraph?: SessionTaskGraph,
  ) {
    this.ready = this.load();
  }

  async get(): Promise<TeamState | null> {
    await this.ready;
    return this.state === null ? null : structuredClone(this.state);
  }

  async memberName(agentId: string): Promise<string | undefined> {
    await this.ready;
    return this.state?.members.find((member) => member.agentId === agentId)?.name;
  }

  create(input: {
    readonly name: string;
    readonly description?: string;
    readonly agentType?: string;
    readonly leadModel: string;
  }): Promise<TeamState> {
    return this.mutate(async () => {
      if (this.state !== null) {
        throw new Error(
          `Already leading team "${this.state.name}". Delete it before creating another team.`,
        );
      }
      const name = input.name.trim();
      if (name.length === 0) throw new Error('team_name is required for TeamCreate');
      const now = new Date().toISOString();
      this.state = {
        version: 1,
        name,
        description: input.description,
        createdAt: now,
        leadAgentId: 'main',
        members: [
          {
            agentId: 'main',
            name: 'team-lead',
            agentType: input.agentType ?? 'team-lead',
            model: input.leadModel,
            joinedAt: now,
            status: 'active',
          },
        ],
        shutdownRequests: [],
      };
      await this.taskGraph?.useScope(name, { reset: true });
      await this.persist();
      return structuredClone(this.state);
    });
  }

  join(input: {
    readonly teamName: string;
    readonly agentId: string;
    readonly name: string;
    readonly agentType: string;
    readonly model: string;
  }): Promise<TeamMember> {
    return this.mutate(async () => {
      const state = this.requireState();
      if (input.teamName !== state.name) {
        throw new Error(`Team "${input.teamName}" does not match active team "${state.name}"`);
      }
      const name = input.name.trim();
      if (name.length === 0) throw new Error('Teammate name must not be empty');
      if (state.members.some((member) => member.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`Team member "${name}" already exists`);
      }
      const member: TeamMember = {
        agentId: input.agentId,
        name,
        agentType: input.agentType,
        model: input.model,
        joinedAt: new Date().toISOString(),
        status: 'active',
      };
      state.members.push(member);
      await this.persist();
      return structuredClone(member);
    });
  }

  markActive(agentId: string): Promise<void> {
    return this.updateStatus(agentId, 'active');
  }

  async markIdle(agentId: string): Promise<void> {
    const state = await this.get();
    const member = state?.members.find((entry) => entry.agentId === agentId);
    if (state === null || member === undefined || member.status !== 'active') return;

    const agent = await this.session.ensureAgentResumed(agentId);
    const blocked = await agent.hooks?.triggerBlock('TeammateIdle', {
      matcherValue: member.name,
      inputData: {
        agentId,
        teammateName: member.name,
        teamName: state.name,
      },
    });
    if (blocked === undefined) {
      await this.updateStatus(agentId, 'idle');
      return;
    }

    const turnId = agent.turn.steer(
      [{ type: 'text', text: blocked.reason }],
      { kind: 'hook_result', event: 'TeammateIdle' },
    );
    if (turnId === null) {
      await this.updateStatus(agentId, 'idle');
      return;
    }
    void agent.turn
      .waitForCurrentTurn()
      .catch(() => undefined)
      .then(() => this.markIdle(agentId))
      .catch(() => undefined);
  }

  delete(): Promise<{ readonly success: boolean; readonly message: string; readonly teamName?: string }> {
    return this.mutate(async () => {
      if (this.state === null) {
        return { success: true, message: 'No team found, nothing to clean up' };
      }
      const active = this.state.members.filter(
        (member) => member.agentId !== 'main' && member.status === 'active',
      );
      if (active.length > 0) {
        return {
          success: false,
          message: `Cannot cleanup team with ${active.length} active member(s): ${active.map((member) => member.name).join(', ')}`,
          teamName: this.state.name,
        };
      }
      const teamName = this.state.name;
      await this.taskGraph?.deleteScope(teamName);
      this.state = null;
      await this.removePersisted();
      return {
        success: true,
        message: `Cleaned up team "${teamName}"`,
        teamName,
      };
    });
  }

  async send(
    senderAgentId: string,
    input: SendTeamMessageInput,
  ): Promise<SendTeamMessageResult> {
    await this.ready;
    const state = this.requireState();
    const sender = this.requireMemberByAgentId(state, senderAgentId);
    if (typeof input.message === 'string') {
      if (input.to === '*') {
        const recipients = state.members.filter(
          (member) => member.agentId !== sender.agentId && member.status !== 'shutdown',
        );
        await Promise.all(
          recipients.map((member) =>
            this.deliver(member, sender.name, input.message as string, input.summary),
          ),
        );
        return {
          success: true,
          message:
            recipients.length === 0
              ? 'No teammates to broadcast to'
              : `Message broadcast to ${recipients.length} teammate(s): ${recipients.map((member) => member.name).join(', ')}`,
          recipients: recipients.map((member) => member.name),
        };
      }
      const recipient = this.requireMemberByName(state, input.to);
      await this.deliver(recipient, sender.name, input.message, input.summary);
      return { success: true, message: `Message sent to ${recipient.name}` };
    }

    if (input.to === '*') throw new Error('Structured messages cannot be broadcast');
    switch (input.message.type) {
      case 'shutdown_request':
        return this.requestShutdown(sender, input.to, input.message.reason);
      case 'shutdown_response':
        return this.respondToShutdown(sender, input.message);
      case 'plan_approval_response':
        return this.respondToPlan(sender, input.to, input.message);
    }
  }

  private async requestShutdown(
    sender: TeamMember,
    targetName: string,
    reason: string | undefined,
  ): Promise<SendTeamMessageResult> {
    const target = this.requireMemberByName(this.requireState(), targetName);
    const requestId = `shutdown_${randomUUID()}`;
    await this.mutate(async () => {
      this.requireState().shutdownRequests.push({
        id: requestId,
        requesterId: sender.agentId,
        targetId: target.agentId,
      });
      await this.persist();
    });
    await this.deliver(
      target,
      sender.name,
      JSON.stringify({ type: 'shutdown_request', request_id: requestId, from: sender.name, reason }),
    );
    return {
      success: true,
      message: `Shutdown request sent to ${target.name}. Request ID: ${requestId}`,
      requestId,
    };
  }

  private async respondToShutdown(
    sender: TeamMember,
    response: Extract<StructuredTeamMessage, { type: 'shutdown_response' }>,
  ): Promise<SendTeamMessageResult> {
    const state = this.requireState();
    const request = state.shutdownRequests.find((item) => item.id === response.request_id);
    if (request === undefined || request.targetId !== sender.agentId) {
      throw new Error(`Shutdown request "${response.request_id}" was not found for ${sender.name}`);
    }
    if (!response.approve && response.reason?.trim().length === 0) {
      throw new Error('reason is required when rejecting a shutdown request');
    }
    const requester = this.requireMemberByAgentId(state, request.requesterId);
    await this.deliver(
      requester,
      sender.name,
      JSON.stringify({
        type: 'shutdown_response',
        request_id: response.request_id,
        from: sender.name,
        approve: response.approve,
        reason: response.reason,
      }),
    );
    await this.mutate(async () => {
      const current = this.requireState();
      current.shutdownRequests = current.shutdownRequests.filter(
        (item) => item.id !== response.request_id,
      );
      if (response.approve) {
        this.requireMemberByAgentId(current, sender.agentId).status = 'shutdown';
      }
      await this.persist();
    });
    if (response.approve) {
      const timer = setTimeout(() => {
        void this.session.ensureAgentResumed(sender.agentId).then((agent) => {
          agent.turn.cancel(undefined, new Error('Teammate approved shutdown'));
        });
      }, 0);
      timer.unref?.();
    }
    return {
      success: true,
      message: response.approve
        ? `Shutdown approved. ${sender.name} is now exiting.`
        : `Shutdown rejected. ${sender.name} will continue working.`,
      requestId: response.request_id,
    };
  }

  private async respondToPlan(
    sender: TeamMember,
    targetName: string,
    response: Extract<StructuredTeamMessage, { type: 'plan_approval_response' }>,
  ): Promise<SendTeamMessageResult> {
    if (sender.agentId !== 'main') throw new Error('Only the team lead can approve plans');
    const target = this.requireMemberByName(this.requireState(), targetName);
    await this.deliver(
      target,
      sender.name,
      JSON.stringify({
        type: response.type,
        request_id: response.request_id,
        approve: response.approve,
        feedback: response.feedback,
      }),
    );
    return {
      success: true,
      message: `Plan ${response.approve ? 'approved' : 'rejected'} for ${target.name}`,
      requestId: response.request_id,
    };
  }

  private async deliver(
    recipient: TeamMember,
    senderName: string,
    content: string,
    summary?: string,
  ): Promise<void> {
    if (recipient.status === 'shutdown') {
      throw new Error(`Team member "${recipient.name}" has shut down`);
    }
    const agent = await this.session.ensureAgentResumed(recipient.agentId);
    const summaryAttribute =
      summary === undefined ? '' : ` summary="${escapeAttribute(summary)}"`;
    const text = `<teammate-message from="${escapeAttribute(senderName)}"${summaryAttribute}>\n${content}\n</teammate-message>`;
    const turnId = agent.turn.steer(
      [{ type: 'text', text }],
      { kind: 'system_trigger', name: 'teammate' },
    );
    if (recipient.agentId === 'main' || turnId === null) return;
    await this.markActive(recipient.agentId);
    void agent.turn
      .waitForCurrentTurn()
      .catch(() => undefined)
      .then(() => this.markIdle(recipient.agentId))
      .catch(() => undefined);
  }

  private updateStatus(
    agentId: string,
    status: TeamMember['status'],
  ): Promise<void> {
    return this.mutate(async () => {
      const member = this.requireMemberByAgentId(this.requireState(), agentId);
      if (member.status === 'shutdown') return;
      if (member.status === status) return;
      member.status = status;
      await this.persist();
    });
  }

  private requireState(): TeamState {
    if (this.state === null) throw new Error('Not in a team context. Create a team first.');
    return this.state;
  }

  private requireMemberByAgentId(state: TeamState, agentId: string): TeamMember {
    const member = state.members.find((item) => item.agentId === agentId);
    if (member === undefined) throw new Error(`Agent "${agentId}" is not a member of the team`);
    return member;
  }

  private requireMemberByName(state: TeamState, name: string): TeamMember {
    const normalized = name.trim().toLowerCase();
    const member = state.members.find((item) => item.name.toLowerCase() === normalized);
    if (member === undefined) throw new Error(`Team member "${name}" was not found`);
    return member;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(async () => {
      await this.ready;
      return operation();
    });
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<void> {
    if (this.persistencePath === undefined) return;
    try {
      this.state = TeamStateSchema.parse(
        JSON.parse(await readFile(this.persistencePath, 'utf-8')) as unknown,
      );
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }

  private async persist(): Promise<void> {
    if (this.persistencePath === undefined || this.state === null) return;
    await mkdir(dirname(this.persistencePath), { recursive: true });
    const temporaryPath = `${this.persistencePath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(this.state, null, 2)}\n`,
      'utf-8',
    );
    await rename(temporaryPath, this.persistencePath);
  }

  private async removePersisted(): Promise<void> {
    if (this.persistencePath === undefined) return;
    try {
      await unlink(this.persistencePath);
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
