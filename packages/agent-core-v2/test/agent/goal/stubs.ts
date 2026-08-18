/**
 * Shared stubs for goal tests.
 */

import type { IAgentDynamicWorkflowService } from '#/agent/dynamic_workflow/dynamic_workflow';

/**
 * Inert stand-in for `IAgentDynamicWorkflowService`.
 *
 * Goal tests never exercise dynamic_workflow behavior, but the test-agent harness
 * instantiates every contributed tool, and `AgentDynamicWorkflowTool` injects the real
 * `AgentDynamicWorkflowService` — which self-wires executor veto listeners and pulls
 * in the dynamic_workflow runtime. Stubbing the service keeps goal tests focused on
 * goal wiring.
 */
export function stubAgentDynamicWorkflow(): IAgentDynamicWorkflowService {
  return {
    _serviceBrand: undefined,
    isActive: false,
    enter: () => undefined,
    exit: () => undefined,
  };
}
