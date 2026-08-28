import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Error2, ErrorCodes } from '#/errors';
import {
  rootDelegationExtras,
  subagentAllowlistFor,
  subagentTypeNotAllowedMessage,
  withoutDelegatingTargets,
} from '#/app/agentProfileCatalog/profile-shared';
import { ISessionAgentProfileCatalog } from '#/session/sessionAgentProfileCatalog/sessionAgentProfileCatalog';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IConfigService } from '#/app/config/config';
import { IModelCatalog, type Model } from '#/kosong/model/catalog';
import { IAgentLifecycleService, MAIN_AGENT_ID } from '#/session/agentLifecycle/agentLifecycle';

import { IAgentBindingProvenanceService } from './bindingProvenance';
import { resolveSubagentThinking, wrapSubagentModelError } from './configSection';
import { routeDecisionFingerprint } from './policy';
import {
  resolveSubagentModelRoute,
  resumedBindingProvenance,
  type SubagentBindingProvenance,
  type SubagentProfileSource,
} from './routing';
import { DEFAULT_PROFILE_NAME, type SubagentSpawnPlan, type SubagentSpawnPlanInput } from './spawn';
import { ISubagentModelPolicyService } from './subagentModelPolicy';
import './subagentModelPolicyService';

export interface ResolvedSpawnPlan extends SubagentSpawnPlan {
  readonly routing: SubagentBindingProvenance;
}

export interface ResumedSubagentRouting {
  readonly routing?: SubagentBindingProvenance;
  readonly currentRoutingEnvironmentRevision: string;
}

export interface ISubagentRoutingService {
  readonly _serviceBrand: undefined;

  resolve(input: SubagentSpawnPlanInput): Promise<ResolvedSpawnPlan>;
  resumed(callerAgentId: string, child: IAgentScopeHandle): ResumedSubagentRouting;
  currentRevision(callerAgentId: string): string | undefined;
}

export const ISubagentRoutingService: ServiceIdentifier<ISubagentRoutingService> =
  createDecorator<ISubagentRoutingService>('subagentRoutingService');

export class SessionSubagentRoutingService implements ISubagentRoutingService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @ISessionAgentProfileCatalog private readonly catalog: ISessionAgentProfileCatalog,
    @IAgentLifecycleService private readonly agentLifecycle: IAgentLifecycleService,
    @IConfigService private readonly configService: IConfigService,
    @IModelCatalog private readonly modelCatalog: IModelCatalog,
    @ISubagentModelPolicyService private readonly policy: ISubagentModelPolicyService,
  ) {}

  async resolve(input: SubagentSpawnPlanInput): Promise<ResolvedSpawnPlan> {
    const caller = this.requireAgent(input.callerAgentId, 'Caller agent');
    const fork = input.fork === true;
    await this.catalog.ready;
    const own = caller.accessor.get(IAgentProfileService).data();
    const requested =
      input.profileName !== undefined && input.profileName.length > 0 ? input.profileName : undefined;
    const requestedProfileName =
      requested ?? (fork ? (own.profileName ?? DEFAULT_PROFILE_NAME) : DEFAULT_PROFILE_NAME);
    const profileSource: SubagentProfileSource =
      requested !== undefined ? 'requested' : fork ? 'fork-inherit' : 'default';
    const extras =
      input.callerAgentId === MAIN_AGENT_ID
        ? rootDelegationExtras(this.catalog, own, this.catalog.list())
        : undefined;
    let allowlist = subagentAllowlistFor(this.catalog, own, extras);
    if (allowlist !== undefined && own.subagents === undefined) {
      allowlist = withoutDelegatingTargets(this.catalog, allowlist);
    }
    if (!fork && allowlist !== undefined && !allowlist.includes(requestedProfileName)) {
      throw new Error2(
        ErrorCodes.AGENT_TYPE_NOT_ALLOWED,
        subagentTypeNotAllowedMessage(requestedProfileName, allowlist),
        { details: { profileName: requestedProfileName, allowlist } },
      );
    }
    const profile = this.catalog.get(requestedProfileName);
    if (!fork && profile === undefined) {
      throw new Error2(ErrorCodes.PROFILE_UNKNOWN, `Unknown agent type: "${requestedProfileName}"`, {
        details: { profileName: requestedProfileName },
      });
    }
    if (own.modelAlias === undefined) {
      throw new Error2(ErrorCodes.MODEL_NOT_CONFIGURED, 'Caller agent has no model bound', {
        details: { agentId: input.callerAgentId },
      });
    }
    const effective = this.policy.getEffective();
    const environmentRevision = this.policy.resolveRevision({
      modelAlias: own.modelAlias,
      thinkingLevel: own.thinkingLevel,
    });
    const route = fork
      ? { model: own.modelAlias, thinking: own.thinkingLevel, source: 'fork-inherit' as const }
      : resolveSubagentModelRoute({
          policy: effective.effectivePolicy,
          own: { modelAlias: own.modelAlias, thinkingLevel: own.thinkingLevel },
          requested: input.model,
        });
    let model: Model;
    try {
      model = this.modelCatalog.get(route.model);
    } catch (error) {
      throw wrapSubagentModelError(error, route.model, own.modelAlias);
    }
    const operation = fork ? 'fork' : 'spawn';
    return {
      profileName: profile?.name ?? requestedProfileName,
      model: route.model,
      thinking: resolveSubagentThinking(this.configService, model, route.thinking),
      fork,
      routing: {
        operation,
        profileSource,
        modelSource: route.source,
        policyMode: effective.effectivePolicy.mode,
        policySource: effective.policySource,
        featureSource: effective.feature.source,
        resolvedFromRoutingEnvironmentRevision: environmentRevision,
        routeDecisionFingerprint: routeDecisionFingerprint({
          routingEnvironmentRevision: environmentRevision,
          operation,
          profile: requested,
          model: input.model,
        }),
      },
    };
  }

  resumed(callerAgentId: string, child: IAgentScopeHandle): ResumedSubagentRouting {
    const stored = child.accessor.get(IAgentBindingProvenanceService).current();
    const revision = this.currentRevision(callerAgentId);
    const childData = child.accessor.get(IAgentProfileService).data();
    const currentRoutingEnvironmentRevision =
      revision ??
      this.policy.resolveRevision({
        modelAlias: childData.modelAlias ?? '',
        thinkingLevel: childData.thinkingLevel,
      });
    return {
      routing: stored === undefined ? undefined : resumedBindingProvenance(stored),
      currentRoutingEnvironmentRevision,
    };
  }

  currentRevision(callerAgentId: string): string | undefined {
    const caller = this.agentLifecycle.handleOf(callerAgentId);
    if (caller === undefined) return undefined;
    const own = caller.accessor.get(IAgentProfileService).data();
    if (own.modelAlias === undefined) return undefined;
    return this.policy.resolveRevision({ modelAlias: own.modelAlias, thinkingLevel: own.thinkingLevel });
  }

  private requireAgent(agentId: string, label: string): IAgentScopeHandle {
    const handle = this.agentLifecycle.handleOf(agentId);
    if (handle === undefined) {
      throw new Error2(ErrorCodes.AGENT_NOT_FOUND, `${label} "${agentId}" does not exist`, {
        details: { agentId },
      });
    }
    return handle;
  }
}

registerScopedService(
  LifecycleScope.Session,
  ISubagentRoutingService,
  SessionSubagentRoutingService,
  ScopeActivation.OnScopeCreated,
  'subagent',
);
