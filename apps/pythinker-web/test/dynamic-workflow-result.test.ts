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
