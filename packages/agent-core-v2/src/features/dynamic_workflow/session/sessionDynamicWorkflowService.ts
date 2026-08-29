/* oxlint-disable typescript-eslint/no-unsafe-declaration-merging, eslint-plugin-import/namespace -- Event2 class+payload-interface declaration merging is the sanctioned event-declaration idiom. */
import type { TokenUsage } from '#/kosong/contract/usage';
import { Error2, ErrorCodes } from '#/errors';
import { linkAbortSignal, userCancellationReason } from '#/_base/utils/abort';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentLoopService } from '#/agent/loop/loop';
import { Event2 } from '#/app/event/event2';
import { IConfigService } from '#/app/config/config';
import { agentContextOf } from '#/agent/scopeContext/scopeContext';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import {
  isSubagentMeta,
  subagentLabels,
  subagentParentAgentId,
  subagentDynamicWorkflowItem,
} from '#/session/agentLifecycle/subagentMetadata';
import { emitAgentRunSpawned, mirrorAgentRun } from '#/session/subagent/mirrorAgentRun';
import { ISessionSubagentService, SubagentRunStartError } from '#/session/subagent/subagent';
import type { SubagentBindingProvenance } from '#/session/subagent/routing';
import { ISubagentRoutingService } from '#/session/subagent/subagentRoutingService';
import { ISessionMetadata, type AgentMeta } from '#/session/sessionMetadata/sessionMetadata';
import { IEventDispatcher } from '#/state/eventDispatcher';

import {
  type SubagentRunBinding,
  ISessionDynamicWorkflowService,
  type SessionDynamicWorkflowRunArgs,
  type SessionDynamicWorkflowRunResult,
  type SessionDynamicWorkflowTask,
} from './sessionDynamicWorkflow';
import {
  AgentRunBatch,
  type AgentRunAttemptOptions,
  type AgentSpawnAttemptOptions,
  type AgentRunBatchLauncher,
  type AgentRunAttemptHandle,
} from './agentRunBatch';
import { resolveDynamicWorkflowMaxConcurrency } from '../configSection';

export interface SubagentSuspendedPayload {
  readonly subagentId: string;
  readonly reason: string;
}

export class SubagentSuspended extends Event2<SubagentSuspendedPayload> {
  static override readonly type = 'subagent.suspended';
  static override readonly observable = true;
}
export interface SubagentSuspended extends SubagentSuspendedPayload {}

const RESUMED_PROFILE_FALLBACK = 'subagent';

export class SessionDynamicWorkflowService implements ISessionDynamicWorkflowService {
  declare readonly _serviceBrand: undefined;

  private readonly inFlight = new Map<string, AbortController>();

  constructor(
    @IAgentLifecycleService private readonly lifecycle: IAgentLifecycleService,
    @ISessionSubagentService private readonly subagents: ISessionSubagentService,
    @ISessionMetadata private readonly metadata: ISessionMetadata,
    @ISubagentRoutingService private readonly routing: ISubagentRoutingService,
    @IConfigService private readonly config: IConfigService,
  ) {}

  async getDynamicWorkflowItem(args: {
    readonly callerAgentId: string;
    readonly agentId: string;
  }): Promise<string | undefined> {
    const meta = await this.agentMeta(args.agentId);
    if (!isSubagentMeta(meta)) return undefined;
    if (subagentParentAgentId(meta) !== args.callerAgentId) return undefined;
    return subagentDynamicWorkflowItem(meta);
  }

  run<T>(args: SessionDynamicWorkflowRunArgs<T>): Promise<readonly SessionDynamicWorkflowRunResult<T>[]> {
    const { callerAgentId, tasks } = args;
    if (this.inFlight.has(callerAgentId)) {
      return Promise.reject(
        new Error2(
          ErrorCodes.AGENT_ALREADY_RUNNING,
          `Agent "${callerAgentId}" already has a dynamic workflow running`,
          { details: { agentId: callerAgentId } },
        ),
      );
    }
    const controller = new AbortController();
    this.inFlight.set(callerAgentId, controller);
    const unlinks: Array<() => void> = [];
    const linkedTasks: SessionDynamicWorkflowTask<T>[] = tasks.map((task) => {
      if (task.signal !== undefined) unlinks.push(linkAbortSignal(task.signal, controller));
      return { ...task, signal: controller.signal };
    });
    const launcher: AgentRunBatchLauncher = {
      spawn: (options) => this.spawnAttempt(callerAgentId, options),
      resume: (agentId, options) => this.resumeAttempt(callerAgentId, agentId, options, false),
      retry: (agentId, options) => this.resumeAttempt(callerAgentId, agentId, options, true),
      suspended: (event) => {
        const caller = this.lifecycle.handleOf(callerAgentId);
        void caller?.accessor.get(IEventDispatcher)?.dispatch(
          new SubagentSuspended({
            subagentId: event.agentId,
            reason: event.reason,
          }),
        );
      },
    };
    const cleanup = () => {
      for (const unlink of unlinks) unlink();
      if (this.inFlight.get(callerAgentId) === controller) this.inFlight.delete(callerAgentId);
    };
    try {
      const maxConcurrency = resolveDynamicWorkflowMaxConcurrency(this.config);
      return new AgentRunBatch(launcher, linkedTasks, { maxConcurrency }).run().finally(cleanup);
    } catch (error) {
      cleanup();
      return Promise.reject(error);
    }
  }

  cancel({ callerAgentId }: { readonly callerAgentId: string }): void {
    this.inFlight.get(callerAgentId)?.abort(userCancellationReason());
  }

  private async spawnAttempt(
    callerAgentId: string,
    options: AgentSpawnAttemptOptions,
  ): Promise<AgentRunAttemptHandle> {
    options.signal.throwIfAborted();
    const caller = this.requireHandle(callerAgentId, 'Caller agent');
    const { plan } = options;
    const spawned = await this.subagents.spawn({
      callerAgentId,
      plan,
      labels: subagentLabels(callerAgentId, { dynamicWorkflowItem: options.dynamicWorkflowItem }),
      prompt: options.prompt,
    });
    try {
      const currentRoutingEnvironmentRevision =
        this.routing.currentRevision(callerAgentId) ??
        plan.routing?.resolvedFromRoutingEnvironmentRevision;
      emitAgentRunSpawned(caller, spawned.agentId, {
        profileName: plan.profileName,
        parentToolCallId: options.parentToolCallId,
        parentToolCallUuid: options.parentToolCallUuid,
        description: options.description,
        dynamicWorkflowIndex: options.dynamicWorkflowIndex,
        runInBackground: options.runInBackground,
        fork: plan.fork,
        model: plan.model,
        routing: plan.routing,
        currentRoutingEnvironmentRevision,
      });
      const child = this.requireHandle(spawned.agentId, 'Agent instance');
      return await this.observe(
        caller,
        child,
        plan.profileName,
        {
          kind: 'prompt',
          prompt: spawned.promptText,
        },
        options,
        {
          routing: plan.routing,
          currentRoutingEnvironmentRevision,
        },
      );
    } catch (error) {
      throw new SubagentRunStartError(spawned.agentId, error);
    }
  }

  private async resumeAttempt(
    callerAgentId: string,
    agentId: string,
    options: AgentRunAttemptOptions,
    retryTurn: boolean,
  ): Promise<AgentRunAttemptHandle> {
    options.signal.throwIfAborted();
    await this.requireOwnedSubagent(callerAgentId, agentId);
    const caller = this.requireHandle(callerAgentId, 'Caller agent');
    const child = this.requireHandle(agentId, 'Agent instance');
    this.requireIdleSubagent(agentId, child);
    const profileName =
      child.accessor.get(IAgentProfileService).data().profileName ?? RESUMED_PROFILE_FALLBACK;
    try {
      const resumedRouting = this.routing.resumed(callerAgentId, child);
      if (!retryTurn) {
        const resumedModel = child.accessor.get(IAgentProfileService).data().modelAlias;
        emitAgentRunSpawned(caller, agentId, {
          profileName,
          parentToolCallId: options.parentToolCallId,
          parentToolCallUuid: options.parentToolCallUuid,
          description: options.description,
          dynamicWorkflowIndex: options.dynamicWorkflowIndex,
          runInBackground: options.runInBackground,
          model: resumedModel,
          routing: resumedRouting.routing,
          currentRoutingEnvironmentRevision: resumedRouting.currentRoutingEnvironmentRevision,
        });
      }
      const request = retryTurn
        ? ({ kind: 'retry' } as const)
        : ({ kind: 'prompt', prompt: options.prompt } as const);
      return await this.observe(caller, child, profileName, request, options, resumedRouting);
    } catch (error) {
      throw new SubagentRunStartError(agentId, error);
    }
  }

  private async observe(
    caller: IAgentScopeHandle,
    child: IAgentScopeHandle,
    profileName: string,
    request: { kind: 'prompt'; prompt: string } | { kind: 'retry' },
    options: AgentRunAttemptOptions,
    routing: {
      readonly routing?: SubagentBindingProvenance;
      readonly currentRoutingEnvironmentRevision?: string;
    },
  ): Promise<AgentRunAttemptHandle> {
    const agentId = child.id;
    const childProfile = child.accessor.get(IAgentProfileService);
    const binding: SubagentRunBinding = {
      profileName,
      model: childProfile.data().modelAlias,
      thinking: childProfile.getEffectiveThinkingLevel(),
      routing: routing.routing,
      currentRoutingEnvironmentRevision: routing.currentRoutingEnvironmentRevision,
      startedAt: Date.now(),
    };
    const run = await this.subagents.run(agentContextOf(child), request, {
      signal: options.signal,
      onReady: options.onReady,
    });
    const mirrored = mirrorAgentRun(caller, run, {
      profileName,
      prompt: request.kind === 'prompt' ? request.prompt : undefined,
      suppressRateLimitFailureEvent: options.suppressRateLimitFailureEvent,
      signal: options.signal,
    });
    return {
      agentId,
      profileName,
      binding,
      completion: mirrored.then((r) => ({ result: r.summary, usage: r.usage })),
    };
  }

  private requireHandle(agentId: string, label: string): IAgentScopeHandle {
    const handle = this.lifecycle.handleOf(agentId);
    if (handle === undefined) {
      throw new Error2(ErrorCodes.AGENT_NOT_FOUND, `${label} "${agentId}" does not exist`, {
        details: { agentId },
      });
    }
    return handle;
  }

  private requireIdleSubagent(agentId: string, child: IAgentScopeHandle): void {
    if (child.accessor.get(IAgentLoopService).status().state === 'running') {
      throw new Error2(
        ErrorCodes.AGENT_ALREADY_RUNNING,
        `Agent instance "${agentId}" is already running and cannot run concurrently`,
        { details: { agentId } },
      );
    }
  }

  private async requireOwnedSubagent(callerAgentId: string, agentId: string): Promise<void> {
    const meta = await this.agentMeta(agentId);
    if (!isSubagentMeta(meta)) {
      throw new Error2(ErrorCodes.AGENT_NOT_A_SUBAGENT, `Agent instance "${agentId}" is not a subagent`, {
        details: { agentId },
      });
    }
    if (subagentParentAgentId(meta) !== callerAgentId) {
      throw new Error2(
        ErrorCodes.AGENT_NOT_OWNED,
        `Agent instance "${agentId}" does not belong to this parent agent`,
        { details: { agentId, callerAgentId } },
      );
    }
  }

  private async agentMeta(agentId: string): Promise<AgentMeta | undefined> {
    const meta = await this.metadata.read();
    return meta.agents?.[agentId];
  }
}

export type _AgentRunUsage = TokenUsage;
