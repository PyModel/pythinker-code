import type { Event } from '../src/transport/ws/v1/events';
import { describe, expect, it } from 'vitest';

import { SubagentRosterTracker } from '../src/transport/ws/v1/subagentRosterTracker';

const SID = 'sess_1';

function ev(partial: Record<string, unknown>): Event {
  return { agentId: 'main', sessionId: SID, ...partial } as unknown as Event;
}

function spawn(subagentId: string, extra: Record<string, unknown> = {}): Event {
  return ev({
    type: 'subagent.spawned',
    subagentId,
    subagentName: 'pythinker-subagent',
    parentToolCallId: 'tc_dynamic_workflow_1',
    description: `task ${subagentId}`,
    dynamicWorkflowIndex: 0,
    runInBackground: false,
    ...extra,
  });
}

describe('SubagentRosterTracker', () => {
  it('carries the routing provenance and current revision from subagent.spawned', () => {
    const t = new SubagentRosterTracker();
    t.apply(
      SID,
      spawn('agent-r', {
        routing: {
          operation: 'resume',
          profileSource: 'resume-existing',
          modelSource: 'resume-existing',
          policyMode: 'inherit',
          policySource: 'default',
          featureSource: 'default',
          resolvedFromRoutingEnvironmentRevision: 'route-env:v1:old',
          routeDecisionFingerprint: 'route-decision:v1:x',
        },
        currentRoutingEnvironmentRevision: 'route-env:v1:new',
      }),
    );
    expect(t.get(SID)).toEqual([
      expect.objectContaining({
        id: 'agent-r',
        routing: {
          operation: 'resume',
          profile_source: 'resume-existing',
          model_source: 'resume-existing',
          policy_mode: 'inherit',
          policy_source: 'default',
          feature_source: 'default',
          routing_env_revision: 'route-env:v1:old',
          route_decision: 'route-decision:v1:x',
        },
        current_routing_env_revision: 'route-env:v1:new',
      }),
    ]);
    t.apply(SID, spawn('agent-plain'));
    expect(t.get(SID).find((entry) => entry.id === 'agent-plain')?.routing).toBeUndefined();
  });

  it('seeds a roster entry from subagent.spawned with the dynamic_workflow identity metadata', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1', { dynamicWorkflowIndex: 2, model: 'provider/secondary', thinkingEffort: 'low' }));

    expect(t.get(SID)).toEqual([
      expect.objectContaining({
        id: 'agent-1',
        session_id: SID,
        kind: 'subagent',
        description: 'task agent-1',
        status: 'running',
        subagent_phase: 'queued',
        subagent_type: 'pythinker-subagent',
        parent_tool_call_id: 'tc_dynamic_workflow_1',
        dynamic_workflow_index: 2,
        run_in_background: false,
        model: 'provider/secondary',
        thinking_effort: 'low',
      }),
    ]);
  });

  it('treats an empty parentToolCallId as absent', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1', { parentToolCallId: '' }));
    expect(t.get(SID)[0]?.parent_tool_call_id).toBeUndefined();
  });

  it('skips background subagents — REST /tasks already serves them after a refresh', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1', { runInBackground: true }));
    expect(t.get(SID)).toEqual([]);
  });

  it('drops the entry when a foreground subagent detaches into a background task', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1'));

    const taskStarted = (detached: boolean): Event =>
      ev({
        type: 'task.started',
        info: {
          taskId: 'task_1',
          kind: 'agent',
          agentId: 'agent-1',
          detached,
          description: 'task agent-1',
          status: 'running',
          startedAt: 1,
          endedAt: null,
        },
      });

    t.apply(SID, taskStarted(false));
    expect(t.get(SID)).toHaveLength(1);

    t.apply(SID, taskStarted(true));
    expect(t.get(SID)).toEqual([]);
  });

  it('follows the subagent phase transitions', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1'));
    t.apply(SID, ev({ type: 'subagent.started', subagentId: 'agent-1' }));
    expect(t.get(SID)[0]).toMatchObject({ subagent_phase: 'working' });
    expect(t.get(SID)[0]?.started_at).toBeDefined();

    t.apply(
      SID,
      ev({ type: 'subagent.suspended', subagentId: 'agent-1', reason: 'rate limit' }),
    );
    expect(t.get(SID)[0]).toMatchObject({
      subagent_phase: 'suspended',
      suspended_reason: 'rate limit',
    });

    const startedAt = t.get(SID)[0]?.started_at;
    t.apply(SID, ev({ type: 'subagent.started', subagentId: 'agent-1' }));
    expect(t.get(SID)[0]).toMatchObject({ subagent_phase: 'working', started_at: startedAt });
    expect(t.get(SID)[0]?.suspended_reason).toBeUndefined();

    t.apply(
      SID,
      ev({ type: 'subagent.completed', subagentId: 'agent-1', resultSummary: 'done' }),
    );
    expect(t.get(SID)[0]).toMatchObject({
      subagent_phase: 'completed',
      status: 'completed',
      output_preview: 'done',
    });
    expect(t.get(SID)[0]?.completed_at).toBeDefined();
  });

  it('marks failures with the error preview', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1'));
    t.apply(SID, ev({ type: 'subagent.failed', subagentId: 'agent-1', error: 'boom' }));
    expect(t.get(SID)[0]).toMatchObject({
      subagent_phase: 'failed',
      status: 'failed',
      output_preview: 'boom',
    });
  });

  it('clears the roster on the next MAIN turn.started, not on any turn.ended', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1'));

    t.apply(SID, ev({ type: 'turn.ended', agentId: 'agent-1', turnId: 1 }));
    expect(t.get(SID)).toHaveLength(1);

    t.apply(SID, ev({ type: 'turn.ended', agentId: 'main', turnId: 1, reason: 'completed' }));
    expect(t.get(SID)).toHaveLength(1);

    t.apply(SID, ev({ type: 'turn.started', agentId: 'main', turnId: 2 }));
    expect(t.get(SID)).toEqual([]);
  });

  it('finalizes still-live entries when the main turn aborts', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1'));
    t.apply(SID, spawn('agent-2'));
    t.apply(SID, ev({ type: 'subagent.completed', subagentId: 'agent-2', resultSummary: 'done' }));

    t.apply(SID, ev({ type: 'turn.ended', agentId: 'main', turnId: 1, reason: 'cancelled' }));

    const entries = t.get(SID);
    expect(entries[0]).toMatchObject({
      id: 'agent-1',
      status: 'failed',
      subagent_phase: 'failed',
      output_preview: 'Main turn cancelled',
    });
    expect(entries[0]?.completed_at).toBeDefined();
    expect(entries[1]).toMatchObject({ id: 'agent-2', status: 'completed', output_preview: 'done' });
  });

  it('ignores lifecycle events for unknown subagents', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, ev({ type: 'subagent.started', subagentId: 'ghost' }));
    t.apply(SID, ev({ type: 'subagent.completed', subagentId: 'ghost', resultSummary: 'x' }));
    expect(t.get(SID)).toEqual([]);
  });

  it('returns fresh copies that callers cannot mutate back into the tracker', () => {
    const t = new SubagentRosterTracker();
    t.apply(SID, spawn('agent-1'));
    const first = t.get(SID);
    first[0]!.description = 'mutated';
    expect(t.get(SID)[0]?.description).toBe('task agent-1');
  });
});
