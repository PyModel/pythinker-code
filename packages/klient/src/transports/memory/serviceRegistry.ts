/**
 * Service name → DI token registry for the in-process dispatcher. Only leaf
 * modules are imported (tokens + types) — never the engine root barrel, so
 * hosting klient in-process does not force the full registration side effects
 * beyond what the host already bootstrapped.
 */

import type { ServiceIdentifier } from '@pymodel/agent-core-v2/_base/di/instantiation';
import { ISessionIndex } from '@pymodel/agent-core-v2/app/sessionIndex/sessionIndex';
import { IWorkspaceService } from '@pymodel/agent-core-v2/app/workspace/workspace';
import { IConfigService } from '@pymodel/agent-core-v2/app/config/config';
import { IModelService } from '@pymodel/agent-core-v2/kosong/model/model';
import { IModelCatalog } from '@pymodel/agent-core-v2/kosong/model/catalog';
import { IProviderDiscoveryService } from '@pymodel/agent-core-v2/app/kosongConfig/discovery';
import { IProviderService } from '@pymodel/agent-core-v2/kosong/provider/provider';
import {
  IAuthSummaryService,
  IOAuthService,
} from '@pymodel/agent-core-v2/app/auth/auth';
import { IFlagService } from '@pymodel/agent-core-v2/app/flag/flag';
import { IPluginService } from '@pymodel/agent-core-v2/app/plugin/plugin';
import { ICapabilityService } from '@pymodel/agent-core-v2/app/capability/capability';
import { IBootstrapService } from '@pymodel/agent-core-v2/app/bootstrap/bootstrap';
import { IEventService } from '@pymodel/agent-core-v2/app/event/event';
import { IHostFolderBrowser } from '@pymodel/agent-core-v2/app/hostFolderBrowser/hostFolderBrowser';
import { IWorkspaceLifecycleService } from '@pymodel/agent-core-v2/app/workspaceLifecycle/workspaceLifecycle';
import { ISessionLifecycleService } from '@pymodel/agent-core-v2/workspace/sessionLifecycle/sessionLifecycle';
import { ISessionMetadata } from '@pymodel/agent-core-v2/session/sessionMetadata/sessionMetadata';
import { ISessionInteractionService } from '@pymodel/agent-core-v2/session/interaction/interaction';
import { ISessionApprovalService } from '@pymodel/agent-core-v2/session/approval/approval';
import { ISessionQuestionService } from '@pymodel/agent-core-v2/session/question/question';
import { ISessionSkillCatalog } from '@pymodel/agent-core-v2/session/sessionSkillCatalog/skillCatalog';
import { IAgentRPCService } from '@pymodel/agent-core-v2/agent/rpc/rpc';
import { IAgentActivityView } from '@pymodel/agent-core-v2/agent/activityView/activityView';
import { IAgentPlanService } from '@pymodel/agent-core-v2/agent/plan/plan';
import { IAgentProfileService } from '@pymodel/agent-core-v2/agent/profile/profile';
import { IAgentShellCommandService } from '@pymodel/agent-core-v2/agent/shellCommand/shellCommand';
import { IAgentTaskService } from '@pymodel/agent-core-v2/agent/task/task';
import { IAgentUsageService } from '@pymodel/agent-core-v2/agent/usage/usage';
import { IAgentMcpService } from '@pymodel/agent-core-v2/agent/mcp/mcp';
import { IAgentFullCompactionService } from '@pymodel/agent-core-v2/agent/fullCompaction/fullCompaction';

/** Wire service name (decorator id string) → token. */
export const serviceTokens: Readonly<Record<string, ServiceIdentifier<unknown>>> = {
  sessionIndex: ISessionIndex,
  workspaceService: IWorkspaceService,
  configService: IConfigService,
  modelService: IModelService,
  modelResolver: IModelCatalog,
  providerDiscovery: IProviderDiscoveryService,
  providerService: IProviderService,
  oauthService: IOAuthService,
  authSummaryService: IAuthSummaryService,
  flagService: IFlagService,
  pluginService: IPluginService,
  capabilityService: ICapabilityService,
  hostFolderBrowser: IHostFolderBrowser,
  bootstrapService: IBootstrapService,
  workspaceLifecycleService: IWorkspaceLifecycleService,
  sessionLifecycleService: ISessionLifecycleService,
  sessionMetadata: ISessionMetadata,
  sessionInteractionService: ISessionInteractionService,
  sessionApprovalService: ISessionApprovalService,
  sessionQuestionService: ISessionQuestionService,
  sessionSkillCatalog: ISessionSkillCatalog,
  agentRPCService: IAgentRPCService,
  agentActivityView: IAgentActivityView,
  agentShellCommandService: IAgentShellCommandService,
  agentProfileService: IAgentProfileService,
  agentUsageService: IAgentUsageService,
  agentPlanService: IAgentPlanService,
  agentTaskService: IAgentTaskService,
  agentMcpService: IAgentMcpService,
  agentFullCompactionService: IAgentFullCompactionService,
};

export { IEventService };
