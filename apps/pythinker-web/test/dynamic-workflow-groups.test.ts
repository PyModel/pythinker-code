import { describe, expect, it } from 'vitest';
import type { AppTask } from '../src/api/types';
import { buildDynamicWorkflowGroups, countDynamicWorkflowMembers } from '../src/composables/dynamic_workflowGroups';

const now = '2026-06-13T00:00:00.000Z';

function task(input: Partial<AppTask> & Pick<AppTask, 'id'>): AppTask {
  return {
    sessionId: 'ses_1',
    kind: 'subagent',
    description: input.id,
    status: 'running',
    createdAt: now,
    ...input,
  };
}

describe('buildDynamicWorkflowGroups', () => {
  it('groups subagents by parent tool call and sorts by dynamicWorkflowIndex', () => {
    const groups = buildDynamicWorkflowGroups([
      task({ id: 'agent_2', parentToolCallId: 'tc_1', dynamicWorkflowIndex: 2, subagentPhase: 'working' }),
      task({ id: 'agent_1', parentToolCallId: 'tc_1', dynamicWorkflowIndex: 1, subagentPhase: 'completed', status: 'completed' }),
      task({ id: 'agent_3', parentToolCallId: 'tc_2', dynamicWorkflowIndex: 1, subagentPhase: 'queued' }),
      task({ id: 'bash_1', kind: 'bash', dynamicWorkflowIndex: 3 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe('tc_1');
    expect(groups[0]?.members.map((member) => member.id)).toEqual(['agent_1', 'agent_2']);
    expect(groups[0]?.counts).toEqual({
      queued: 0,
      working: 1,
      suspended: 0,
      completed: 1,
      failed: 0,
    });
  });

  it('counts terminal dynamic_workflow members for badges', () => {
    const groups = buildDynamicWorkflowGroups([
      task({ id: 'agent_1', parentToolCallId: 'tc_1', dynamicWorkflowIndex: 1, subagentPhase: 'completed', status: 'completed' }),
      task({ id: 'agent_2', parentToolCallId: 'tc_1', dynamicWorkflowIndex: 2, subagentPhase: 'failed', status: 'failed' }),
      task({ id: 'agent_3', parentToolCallId: 'tc_1', dynamicWorkflowIndex: 3, subagentPhase: 'working' }),
    ]);

    expect(countDynamicWorkflowMembers(groups)).toEqual({ done: 2, total: 3 });
  });
});
