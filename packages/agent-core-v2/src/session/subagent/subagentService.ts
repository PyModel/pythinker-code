import { Service } from '#/_base/di/service';
import type { AgentContext } from '#/agent/agentContext/agentContext';
import { Error2, ErrorCodes } from '#/errors';
import { LifecycleScope } from '#/app/scopes';
import {
  type IAgentScopeHandle,
  ScopeActivation,
  registerScopedService,
} from '#/_base/di/scope';
import { Emitter } from '#/_base/event';
import type { AgentProfileSummaryPolicy } from '#/app/agentProfileCatalog/agentProfileCatalog';
import { applyProfilePromptPrefix } from '#/app/agentProfileCatalog/promptPrefix';
import { ISessionAgentProfileCatalog } from '#/session/sessionAgentProfileCatalog/sessionAgentProfileCatalog';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { IAgentUserToolService } from '#/agent/userTool/userTool';
import { IAgentRuntimeService } from '#/agent/runtimeBinding/agentRuntime';
import type { Runtime } from '#/runtime/runtime';
import { ILogService } from '#/_base/log/log';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { RuntimeWorkspaceView } from '#/runtime/runtimeWorkspaceView';
import { createHooks } from '#/hooks';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { agentContextOf } from '#/agent/scopeContext/scopeContext';

import {
  type AgentRunHandle,
  type AgentRunRequest,
  type AgentTaskHooks,
  type AgentTaskStopHookContext,
  ISessionSubagentService,
  type RunAgentOptions,
} from './subagent';
import { runAgentTurn } from './runAgentTurn';
import { wrapSubagentModelError } from './configSection';
import { IAgentBindingProvenanceService } from './bindingProvenance';
import {
  FORK_CONTEXT_NOTICE,
  type SpawnSubagentOptions,
  type SpawnedSubagent,
  type SubagentSpawnPlan,
  type SubagentSpawnPlanInput,
} from './spawn';
import { ISubagentRoutingService } from './subagentRoutingService';

export class SessionSubagentService extends Service implements ISessionSubagentService {
  declare readonly _serviceBrand: undefined;

  readonly hooks = createHooks<AgentTaskHooks, keyof AgentTaskHooks>(['onWillStartAgentTask']);
  private readonly onDidStopAgentTaskEmitter = this._register(
    new Emitter<AgentTaskStopHookContext>(),
  );

  get onDidStopAgentTask() {
    return this.onDidStopAgentTaskEmitter.event;
  }

  constructor(
    @IAgentLifecycleService private readonly agentLifecycle: IAgentLifecycleService,
    @ISessionAgentProfileCatalog private readonly catalog: ISessionAgentProfileCatalog,
    @ISessionContext private readonly sessionContext: ISessionContext,
    @ILogService private readonly log: ILogService,
    @ISubagentRoutingService private readonly routing: ISubagentRoutingService,
  ) {
    super();
  }

  run(agent: AgentContext, request: AgentRunRequest, opts: RunAgentOptions): Promise<AgentRunHandle> {
    const handle = this.agentLifecycle.handleOf(agent.agentId);
    if (handle === undefined) {
      throw new Error2(ErrorCodes.AGENT_NOT_FOUND, `Agent "${agent.agentId}" does not exist`, {
        details: { agentId: agent.agentId },
      });
    }
    return runAgentTurn(handle, request, {
      summaryPolicy: opts.summaryPolicy ?? this.summaryPolicyFor(handle),
      signal: opts.signal,
      onReady: opts.onReady,
    });
  }

  async planSpawn(input: SubagentSpawnPlanInput): Promise<SubagentSpawnPlan> {
    return this.routing.resolve(input);
  }

  async spawn(opts: SpawnSubagentOptions): Promise<SpawnedSubagent> {
    const caller = this.requireCaller(opts.callerAgentId);
    const { plan } = opts;
    const lease = plan.fork
      ? undefined
      : caller.accessor.get(IAgentRuntimeService).acquire(['process']);
    try {
      let created: IAgentScopeHandle;
      try {
        if (plan.fork) {
          const forked = await this.agentLifecycle.fork(agentContextOf(caller), {
            labels: opts.labels,
          });
          created = this.agentLifecycle.handleOf(forked.agentId)!;
        } else {
          const createdContext = await this.agentLifecycle.create({
            binding: {
              profile: plan.profileName,
              model: plan.model,
              thinking: plan.thinking,
            },
            labels: opts.labels,
            runtimeId: lease!.runtime.identity.runtimeId,
          });
          created = this.agentLifecycle.handleOf(createdContext.agentId)!;
        }
      } catch (error) {
        throw wrapSubagentModelError(
          error,
          plan.model,
          caller.accessor.get(IAgentProfileService).data().modelAlias,
        );
      }
      if (plan.routing !== undefined) {
        created.accessor.get(IAgentBindingProvenanceService).record(plan.routing);
      }
      created.accessor
        .get(IAgentPermissionModeService)
        .setMode(caller.accessor.get(IAgentPermissionModeService).mode);
      const createdUserTools = created.accessor.get(IAgentUserToolService);
      const callerUserTools = caller.accessor.get(IAgentUserToolService);
      if (plan.fork) {
        const activeToolNames = created.accessor.get(IAgentProfileService).getActiveToolNames();
        createdUserTools.inheritUserTools(callerUserTools, activeToolNames);
      } else {
        createdUserTools.inheritUserTools(callerUserTools);
      }
      const promptText = plan.fork
        ? `${FORK_CONTEXT_NOTICE}\n\n${opts.prompt}`
        : await this.applyPromptPrefix(plan.profileName, opts.prompt, lease!.runtime);
      return {
        agentId: created.id,
        profileName: plan.profileName,
        model: plan.model,
        promptText,
      };
    } finally {
      lease?.dispose();
    }
  }

  notifyAgentTaskStopped(context: AgentTaskStopHookContext): void {
    this.onDidStopAgentTaskEmitter.fire(context);
  }

  private async applyPromptPrefix(
    profileName: string,
    prompt: string,
    runtime: Runtime,
  ): Promise<string> {
    const profile = this.catalog.get(profileName);
    if (profile?.promptPrefix === undefined) return prompt;
    const view = new RuntimeWorkspaceView(runtime, {
      workDir: this.sessionContext.cwd,
    });
    return applyProfilePromptPrefix(profile, prompt, {
      cwd: view.workDir,
      process: runtime.process!,
      log: this.log,
    });
  }

  private requireCaller(agentId: string): IAgentScopeHandle {
    const handle = this.agentLifecycle.handleOf(agentId);
    if (handle === undefined) {
      throw new Error2(ErrorCodes.AGENT_NOT_FOUND, `Caller agent "${agentId}" does not exist`, {
        details: { agentId },
      });
    }
    return handle;
  }

  private summaryPolicyFor(handle: IAgentScopeHandle): AgentProfileSummaryPolicy | undefined {
    const profileName = handle.accessor.get(IAgentProfileService).data().profileName;
    if (profileName === undefined) return undefined;
    return this.catalog.get(profileName)?.summaryPolicy;
  }
}

registerScopedService(
  LifecycleScope.Session,
  ISessionSubagentService,
  SessionSubagentService,
  ScopeActivation.OnScopeCreated,
  'subagent',
);
