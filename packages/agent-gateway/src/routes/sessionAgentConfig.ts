import {
  ErrorCodes,
  Error2,
  AgentGoal,
  IAgentLifecycleService,
  IAgentPlanService,
  IAgentProfileService,
  IAgentDynamicWorkflowService,
  IAgentTowerService,
  agentContextOf,
  resumeSessionById,
  type PermissionMode,
  type Scope,
} from '@pymodel/agent-core-v2';
import type { SessionAgentConfigPartial } from '@pymodel/agent-core-v2/app/sessionManager/sessionProtocol';

import { ensureMainAgent } from '../transport/mainAgent';

export async function applySessionAgentConfig(
  core: Scope,
  sessionId: string,
  agentConfig: SessionAgentConfigPartial,
): Promise<void> {
  const session = await resumeSessionById(core.accessor, sessionId);
  if (session === undefined) {
    throw new Error2(ErrorCodes.SESSION_NOT_FOUND, `session ${sessionId} does not exist`);
  }
  const agent = await ensureMainAgent(session);

  const profile = agent.accessor.get(IAgentProfileService);
  if (agentConfig.model !== undefined && agentConfig.model !== '') {
    await profile.setModel(agentConfig.model);
  }
  if (agentConfig.thinking !== undefined) {
    profile.setThinking(agentConfig.thinking);
  }
  if (agentConfig.permission_mode !== undefined) {
    agent.accessor
      .get(IAgentLifecycleService)
      .broadcastPermissionMode(agentConfig.permission_mode as PermissionMode);
  }
  if (agentConfig.plan_mode !== undefined) {
    const plan = agent.accessor.get(IAgentPlanService);
    const active = (await plan.status()) !== null;
    if (active !== agentConfig.plan_mode) {
      if (agentConfig.plan_mode) await plan.enter();
      else plan.exit();
    }
  }
  if (agentConfig.dynamic_workflow_mode !== undefined) {
    const dynamic_workflow = agent.accessor.get(IAgentDynamicWorkflowService);
    if (dynamic_workflow.isActive !== agentConfig.dynamic_workflow_mode) {
      if (agentConfig.dynamic_workflow_mode) dynamic_workflow.enter('manual');
      else dynamic_workflow.exit();
    }
  }
  if (agentConfig.tower_mode !== undefined) {
    const tower = agent.accessor.get(IAgentTowerService);
    if (agentConfig.tower_mode) {
      await tower.enter(agentConfig.tower_base);
      if (!tower.isActive) {
        throw new Error2(
          ErrorCodes.SESSION_TOWER_MODE_INVALID,
          'tower mode could not be enabled — another live session owns the workspace tower',
        );
      }
    } else {
      tower.exit();
    }
  }
  if (agentConfig.goal_objective !== undefined) {
    await agent.accessor
      .get(IAgentLifecycleService)
      .resolve(agentContextOf(agent), AgentGoal)
      .createGoal({ objective: agentConfig.goal_objective });
  }
  if (agentConfig.goal_control !== undefined) {
    const goal = agent.accessor.get(IAgentLifecycleService).resolve(agentContextOf(agent), AgentGoal);
    switch (agentConfig.goal_control) {
      case 'pause':
        await goal.pauseGoal({});
        break;
      case 'resume':
        await goal.resumeGoal({ continueIfPaused: true, continueIfBlocked: true });
        break;
      case 'cancel':
        await goal.cancelGoal({});
        break;
    }
  }
}
