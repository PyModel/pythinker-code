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
import { IAuthSummaryService } from '@pymodel/agent-core-v2/app/auth/auth';
import { IFlagService } from '@pymodel/agent-core-v2/app/flag/flag';
import { IPluginService } from '@pymodel/agent-core-v2/app/plugin/plugin';
import { ICapabilityService } from '@pymodel/agent-core-v2/app/capability/capability';
import { IBootstrapService } from '@pymodel/agent-core-v2/app/bootstrap/bootstrap';
import { IEventService } from '@pymodel/agent-core-v2/app/event/event';
import { IFileService } from '@pymodel/agent-core-v2/app/file/fileService';
import { IHostFolderBrowser } from '@pymodel/agent-core-v2/app/hostFolderBrowser/hostFolderBrowser';
import { IWorkspaceInstanceManager } from '@pymodel/agent-core-v2/workspace/workspaceInstance/workspaceInstanceManager';
import { ISessionManager } from '@pymodel/agent-core-v2/app/sessionManager/sessionManager';
import { ISessionMetadata } from '@pymodel/agent-core-v2/session/sessionMetadata/sessionMetadata';
import { ISessionApprovalService } from '@pymodel/agent-core-v2/session/approval/approval';
import { ISessionExpertTalkService } from '@pymodel/agent-core-v2/session/expertTalk/expertTalk';
import { ISessionQuestionService } from '@pymodel/agent-core-v2/session/question/question';
import { ISessionSkillCatalog } from '@pymodel/agent-core-v2/features/skill/session/skillCatalog';
import { ISessionTitleService } from '@pymodel/agent-core-v2/session/sessionTitle/sessionTitle';
import { IAgentPromptService } from '@pymodel/agent-core-v2/agent/prompt/prompt';
import { IAgentLoopService } from '@pymodel/agent-core-v2/agent/loop/loop';
import { IAgentPermissionModeService } from '@pymodel/agent-core-v2/agent/permissionMode/permissionMode';
import { IAgentCommandService } from '@pymodel/agent-core-v2/agent/command/agentCommand';
import { IAgentRuntimeBindingService } from '@pymodel/agent-core-v2/agent/runtimeBinding/runtimeBinding';
import { IAgentContextMemoryService } from '@pymodel/agent-core-v2/agent/contextMemory/contextMemory';
import { ISessionTokenCountingService } from '@pymodel/agent-core-v2/session/tokenCounting/sessionTokenCounting';
import { IAgentActivityView } from '@pymodel/agent-core-v2/agent/activityView/activityView';
import { IAgentPlanService } from '@pymodel/agent-core-v2/features/plan/plan';
import { IAgentProfileService } from '@pymodel/agent-core-v2/agent/profile/profile';
import { IAgentShellCommandService } from '@pymodel/agent-core-v2/agent/shellCommand/shellCommand';
import { IAgentTaskService } from '@pymodel/agent-core-v2/agent/task/task';
import { ISessionUsageService } from '@pymodel/agent-core-v2/session/usage/sessionUsage';
import { IAgentMcpService } from '@pymodel/agent-core-v2/agent/mcp/mcp';
import { IAgentFullCompactionService } from '@pymodel/agent-core-v2/agent/fullCompaction/fullCompaction';
import { IMcpManagementService } from '@pymodel/agent-core-v2/app/mcpManagement/mcpManagement';

/** Wire service name (decorator id string) → token. */
export const serviceTokens: Readonly<Record<string, ServiceIdentifier<unknown>>> = {
  sessionIndex: ISessionIndex,
  workspaceService: IWorkspaceService,
  configService: IConfigService,
  modelService: IModelService,
  modelResolver: IModelCatalog,
  providerDiscovery: IProviderDiscoveryService,
  providerService: IProviderService,
  authSummaryService: IAuthSummaryService,
  flagService: IFlagService,
  pluginService: IPluginService,
  capabilityService: ICapabilityService,
  hostFolderBrowser: IHostFolderBrowser,
  bootstrapService: IBootstrapService,
  fileService: IFileService,
  workspaceInstanceManager: IWorkspaceInstanceManager,
  sessionManager: ISessionManager,
  sessionMetadata: ISessionMetadata,
  sessionApprovalService: ISessionApprovalService,
  sessionExpertTalkService: ISessionExpertTalkService,
  sessionQuestionService: ISessionQuestionService,
  sessionSkillCatalog: ISessionSkillCatalog,
  sessionTitleService: ISessionTitleService,
  agentPromptService: IAgentPromptService,
  agentLoopService: IAgentLoopService,
  agentPermissionModeService: IAgentPermissionModeService,
  agentCommandService: IAgentCommandService,
  agentRuntimeBindingService: IAgentRuntimeBindingService,
  agentContextMemoryService: IAgentContextMemoryService,
  agentTokenCountingService: ISessionTokenCountingService,
  agentActivityView: IAgentActivityView,
  agentShellCommandService: IAgentShellCommandService,
  agentProfileService: IAgentProfileService,
  agentUsageService: ISessionUsageService,
  agentPlanService: IAgentPlanService,
  agentTaskService: IAgentTaskService,
  agentMcpService: IAgentMcpService,
  agentFullCompactionService: IAgentFullCompactionService,
  mcpManagementService: IMcpManagementService,
};

export { IEventService };
