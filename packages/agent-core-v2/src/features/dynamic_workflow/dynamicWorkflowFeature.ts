import { ScopeActivation } from '#/_base/di/instantiation';
import { LifecycleScope } from '#/app/scopes';
import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { IAgentDynamicWorkflowService } from './agent/dynamic_workflow';
import { AgentDynamicWorkflowService } from './agent/dynamicWorkflowService';
import { ISessionDynamicWorkflowService } from './session/sessionDynamicWorkflow';
import { SessionDynamicWorkflowService } from './session/sessionDynamicWorkflowService';
import { IAgentDynamicWorkflowTool } from './tools/agent-dynamic_workflow/agent-dynamic_workflow';
import { AgentDynamicWorkflowTool } from './tools/agent-dynamic_workflow/agentDynamicWorkflowTool';

export class DynamicWorkflowFeature extends Feature {
  static override readonly name = 'dynamic_workflow';

  constructor() {
    super();
    this.contributeAgentService(IAgentDynamicWorkflowService, AgentDynamicWorkflowService, {
      activation: ScopeActivation.OnScopeCreated,
    });
    this.contributeService(LifecycleScope.Session, ISessionDynamicWorkflowService, SessionDynamicWorkflowService, {
      activation: ScopeActivation.OnScopeCreated,
    });
    this.contributeTool(IAgentDynamicWorkflowTool, AgentDynamicWorkflowTool, { name: 'AgentDynamicWorkflow', domain: 'dynamic_workflow' });
  }
}

registerFeature(DynamicWorkflowFeature);
