import { describe, expect, it } from 'vitest';
import { parseDynamicWorkflowResult } from '../src/lib/parseDynamicWorkflowResult';

describe('parseDynamicWorkflowResult', () => {
  it('returns null when the payload is not an agent_dynamic_workflow_result', () => {
    expect(parseDynamicWorkflowResult('all done')).toBeNull();
    expect(parseDynamicWorkflowResult(undefined)).toBeNull();
    expect(parseDynamicWorkflowResult([])).toBeNull();
  });

  it('parses the summary counts and each subagent outcome', () => {
    const output = [
      '<agent_dynamic_workflow_result>',
      '<summary>completed: 2, failed: 1</summary>',
      '<subagent item="alpha" agent_id="a1" outcome="completed">first body</subagent>',
      '<subagent item="beta" agent_id="a2" outcome="completed">second body</subagent>',
      '<subagent item="gamma" outcome="failed">boom</subagent>',
      '</agent_dynamic_workflow_result>',
    ];
    const result = parseDynamicWorkflowResult(output);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe('completed: 2, failed: 1');
    expect(result?.completed).toBe(2);
    expect(result?.failed).toBe(1);
    expect(result?.aborted).toBe(0);
    expect(result?.total).toBe(3);
    expect(result?.subagents).toEqual([
      { outcome: 'completed', item: 'alpha', agentId: 'a1', body: 'first body' },
      { outcome: 'completed', item: 'beta', agentId: 'a2', body: 'second body' },
      { outcome: 'failed', item: 'gamma', body: 'boom' },
    ]);
  });

  it('unescapes the item attribute and captures the resume hint', () => {
    const text = [
      '<agent_dynamic_workflow_result>',
      '<summary>completed: 0, failed: 1, aborted: 0</summary>',
      '<resume_hint>Call AgentDynamicWorkflow with resume_agent_ids using the agent_id values in this result to continue unfinished work.</resume_hint>',
      '<subagent item="a &amp; b" mode="resume" agent_id="a9" state="started" outcome="failed">err</subagent>',
      '</agent_dynamic_workflow_result>',
    ].join('\n');
    const result = parseDynamicWorkflowResult(text);
    expect(result?.resumeHint).toContain('resume_agent_ids');
    expect(result?.subagents[0]?.item).toBe('a & b');
    expect(result?.subagents[0]?.mode).toBe('resume');
    expect(result?.subagents[0]?.state).toBe('started');
  });

  it('does not count a literal "<subagent>" tag inside a body as a top-level row', () => {
    const snippet = '<subagent item="nested" outcome="completed">inner body</subagent>';
    const body = 'example result below: ' + snippet;
    const text = `<agent_dynamic_workflow_result><summary>completed: 1</summary><subagent item="outer" outcome="completed">${body}</subagent></agent_dynamic_workflow_result>`;
    const result = parseDynamicWorkflowResult(text);
    expect(result?.subagents).toHaveLength(1);
    expect(result?.subagents[0]?.item).toBe('outer');
    expect(result?.subagents[0]?.body).toContain(snippet);
  });

  it('keeps sibling top-level rows when one body contains a nested subagent snippet', () => {
    const text = [
      '<agent_dynamic_workflow_result><summary>completed: 2</summary>',
      '<subagent item="a" outcome="completed">A snippet: <subagent item="x" outcome="completed">inner</subagent> done</subagent>',
      '<subagent item="b" outcome="completed">just B</subagent>',
      '</agent_dynamic_workflow_result>',
    ].join('');
    const result = parseDynamicWorkflowResult(text);
    expect(result?.subagents.map((s) => s.item)).toEqual(['a', 'b']);
    expect(result?.subagents[0]?.body).toContain('<subagent item="x"');
    expect(result?.subagents[0]?.body).toContain('inner');
    expect(result?.subagents[1]?.body).toBe('just B');
  });
});

describe('parseDynamicWorkflowResult binding attributes', () => {
  it('reads the durable binding attributes and unescapes them; old rows stay compatible', () => {
    const output = [
      '<agent_dynamic_workflow_result>',
      '<summary>completed: 2</summary>',
      '<subagent agent_id="a1" item="alpha" profile="explore" model="acme/&quot;q&quot; &amp; &lt;m&gt;" thinking="low" profile_source="requested" model_source="policy-pool" policy_mode="pool" policy_source="config" feature_source="env" routing_env_revision="route-env:v1:aaa" route_decision="route-decision:v1:bbb" started_at="2026-01-01T00:00:00.000Z" completed_at="2026-01-01T00:00:05.000Z" outcome="completed">first</subagent>',
      '<subagent mode="resume" agent_id="a2" item="beta" profile="coder" model="acme/luna" profile_source="resume-existing" model_source="resume-existing" policy_mode="inherit" policy_source="default" feature_source="default" routing_env_revision="route-env:v1:old" route_decision="route-decision:v1:x" outcome="completed">second</subagent>',
      '<subagent item="gamma" outcome="failed">boom</subagent>',
      '</agent_dynamic_workflow_result>',
    ];
    const result = parseDynamicWorkflowResult(output);
    expect(result?.subagents[0]).toEqual({
      outcome: 'completed',
      item: 'alpha',
      agentId: 'a1',
      body: 'first',
      profile: 'explore',
      model: 'acme/"q" & <m>',
      thinking: 'low',
      routing: {
        operation: 'spawn',
        profileSource: 'requested',
        modelSource: 'policy-pool',
        policyMode: 'pool',
        policySource: 'config',
        featureSource: 'env',
        routingEnvRevision: 'route-env:v1:aaa',
        routeDecision: 'route-decision:v1:bbb',
      },
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
    });
    expect(result?.subagents[1]).toMatchObject({
      mode: 'resume',
      profile: 'coder',
      model: 'acme/luna',
      routing: { operation: 'resume', modelSource: 'resume-existing', routingEnvRevision: 'route-env:v1:old' },
    });
    expect(result?.subagents[1]?.thinking).toBeUndefined();
    expect(result?.subagents[2]).toEqual({ outcome: 'failed', item: 'gamma', body: 'boom' });
  });
});
