import { describe, expect, it } from 'vitest';
import type { AppTask } from '../src/api/types';
import {
  buildDynamicWorkflowGroups,
  countDynamicWorkflowMembers,
  dynamic_workflowMembersByToolCall,
} from '../src/composables/dynamic_workflowGroups';

function subagentTask(
  id: string,
  parentToolCallId: string | undefined,
  opts: {
    dynamicWorkflowIndex?: number;
    status?: AppTask['status'];
    subagentPhase?: AppTask['subagentPhase'];
    text?: string;
    outputLines?: string[];
  } = {},
): AppTask {
  return {
    id,
    sessionId: 'session-1',
    kind: 'subagent',
    description: `subagent ${id}`,
    status: opts.status ?? 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    parentToolCallId,
    dynamicWorkflowIndex: opts.dynamicWorkflowIndex,
    text: opts.text,
    outputLines: opts.outputLines,
    subagentPhase: opts.subagentPhase ?? 'working',
  };
}

function bashTask(id: string): AppTask {
  return {
    id,
    sessionId: 'session-1',
    kind: 'bash',
    description: `bash ${id}`,
    busy: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('buildDynamicWorkflowGroups', () => {
  it('emits a group only when two or more members share a dynamicWorkflowIndex', () => {
    const groups = buildDynamicWorkflowGroups([
      subagentTask('a', 'dynamic-workflow-1', { dynamicWorkflowIndex: 1 }),
      subagentTask('b', 'dynamic-workflow-1', { dynamicWorkflowIndex: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.id).toBe('dynamic-workflow-1');
    expect(groups[0]?.members.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('filters single-member groups (used for the badge counter)', () => {
    const groups = buildDynamicWorkflowGroups([subagentTask('a', 'dynamic-workflow-1', { dynamicWorkflowIndex: 1 })]);
    expect(groups).toHaveLength(0);
  });

  it('ignores subagents without a dynamicWorkflowIndex', () => {
    const groups = buildDynamicWorkflowGroups([
      subagentTask('a', 'dynamic-workflow-1'),
      subagentTask('b', 'dynamic-workflow-1'),
    ]);
    expect(groups).toHaveLength(0);
  });
});

describe('countDynamicWorkflowMembers', () => {
  it('counts completed + failed as done across groups', () => {
    const groups = buildDynamicWorkflowGroups([
      subagentTask('a', 'dynamic-workflow-1', { dynamicWorkflowIndex: 1, subagentPhase: 'completed', status: 'completed' }),
      subagentTask('b', 'dynamic-workflow-1', { dynamicWorkflowIndex: 2, subagentPhase: 'failed', status: 'failed' }),
      subagentTask('c', 'dynamic-workflow-2', { dynamicWorkflowIndex: 1, subagentPhase: 'working' }),
      subagentTask('d', 'dynamic-workflow-2', { dynamicWorkflowIndex: 2, subagentPhase: 'queued' }),
    ]);
    expect(countDynamicWorkflowMembers(groups)).toEqual({ done: 2, total: 4 });
  });
});

describe('dynamic_workflowMembersByToolCall', () => {
  it('keeps single-member dynamic workflows so a resume-only AgentDynamicWorkflow gets live progress', () => {
    const map = dynamic_workflowMembersByToolCall([subagentTask('a', 'dynamic-workflow-1', { dynamicWorkflowIndex: 1 })]);
    expect(map.get('dynamic-workflow-1')?.map((m) => m.id)).toEqual(['a']);
  });

  it('groups every subagent with the same parentToolCallId, ignoring dynamicWorkflowIndex', () => {
    const map = dynamic_workflowMembersByToolCall([
      subagentTask('b', 'dynamic-workflow-1'),
      subagentTask('a', 'dynamic-workflow-1'),
      subagentTask('c', 'dynamic-workflow-2'),
    ]);
    expect(map.get('dynamic-workflow-1')?.map((m) => m.id)).toEqual(['a', 'b']);
    expect(map.get('dynamic-workflow-2')?.map((m) => m.id)).toEqual(['c']);
  });

  it('ignores non-subagent tasks and subagents without a parentToolCallId', () => {
    const map = dynamic_workflowMembersByToolCall([
      bashTask('b-1'),
      subagentTask('orphan', undefined),
      subagentTask('a', 'dynamic-workflow-1'),
    ]);
    expect([...map.keys()]).toEqual(['dynamic-workflow-1']);
  });

  it('carries task.text so live rows can show still-composing subagent output', () => {
    const map = dynamic_workflowMembersByToolCall([
      subagentTask('a', 'dynamic-workflow-1', { text: 'Hello, world!' }),
      subagentTask('b', 'dynamic-workflow-1', { outputLines: ['tool line'] }),
    ]);
    const rows = map.get('dynamic-workflow-1') ?? [];
    expect(rows[0]).toMatchObject({ id: 'a', text: 'Hello, world!' });
    expect(rows[1]).toMatchObject({ id: 'b', outputLines: ['tool line'] });
  });
});

describe('buildDynamicWorkflowGroups preserves streamed text', () => {
  it('carries task.text into each group member', () => {
    const groups = buildDynamicWorkflowGroups([
      subagentTask('a', 'dynamic-workflow-1', { dynamicWorkflowIndex: 1, text: 'first line' }),
      subagentTask('b', 'dynamic-workflow-1', { dynamicWorkflowIndex: 2, text: 'second line' }),
    ]);
    expect(groups[0]?.members.map((m) => m.text)).toEqual(['first line', 'second line']);
  });
});
