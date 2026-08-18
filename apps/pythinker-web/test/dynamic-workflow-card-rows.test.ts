import { describe, expect, it } from 'vitest';
import type { AppSubagentPhase } from '../src/api/types';
import type { DynamicWorkflowMember } from '../src/composables/dynamic_workflowGroups';
import type { DynamicWorkflowResult } from '../src/lib/parseDynamicWorkflowResult';
import { buildDynamicWorkflowCardRows, dynamic_workflowMemberActivity } from '../src/lib/dynamic_workflowCardRows';

function member(
  id: string,
  name: string,
  opts: {
    phase?: AppSubagentPhase;
    text?: string;
    outputLines?: string[];
    summary?: string;
    suspendedReason?: string;
  } = {},
): DynamicWorkflowMember {
  return {
    id,
    name,
    phase: opts.phase ?? 'working',
    text: opts.text,
    outputLines: opts.outputLines,
    summary: opts.summary,
    suspendedReason: opts.suspendedReason,
    dynamicWorkflowIndex: 0,
  };
}

function result(subagents: DynamicWorkflowResult['subagents']): DynamicWorkflowResult {
  return {
    summary: `${subagents.length}`,
    completed: subagents.filter((s) => s.outcome === 'completed').length,
    failed: subagents.filter((s) => s.outcome === 'failed').length,
    aborted: subagents.filter((s) => s.outcome === 'aborted').length,
    total: subagents.length,
    subagents,
  };
}

describe('dynamic_workflowMemberActivity', () => {
  it('prefers streamed subagent text over outputLines and summary', () => {
    const m = member('a', '子任务', {
      text: 'line 1\nline 2',
      outputLines: ['tool call output'],
      summary: 'final summary',
    });
    expect(dynamic_workflowMemberActivity(m)).toBe('line 2');
  });

  it('falls back to the last outputLines entry when no text is streaming', () => {
    const m = member('a', '子任务', { outputLines: ['one', 'two'], summary: 'summary' });
    expect(dynamic_workflowMemberActivity(m)).toBe('two');
  });

  it('falls back to summary', () => {
    expect(dynamic_workflowMemberActivity(member('a', '子任务', { summary: 'sum' }))).toBe('sum');
  });
});

describe('buildDynamicWorkflowCardRows', () => {
  it('builds rows from live members when no parsed result exists', () => {
    const rows = buildDynamicWorkflowCardRows(
      [member('a', '子任务 A', { text: 'streaming' })],
      null,
    );
    expect(rows).toEqual([{ id: 'a', name: '子任务 A', activity: 'streaming', phase: 'working', body: 'streaming' }]);
  });

  it('builds rows from result subagents when no members are present', () => {
    const rows = buildDynamicWorkflowCardRows(
      [],
      result([
        { outcome: 'completed', item: 'A', body: 'A body' },
        { outcome: 'failed', item: 'B', body: 'B body' },
      ]),
    );
    expect(rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(rows.map((r) => r.phase)).toEqual(['completed', 'failed']);
  });

  it('appends result-only aborted not_started rows on top of live members', () => {
    const rows = buildDynamicWorkflowCardRows(
      [
        member('a1', '子任务 A', { phase: 'completed' }),
        member('a2', '子任务 B', { phase: 'working' }),
      ],
      result([
        { outcome: 'completed', item: 'A', agentId: 'a1', body: 'A body' },
        { outcome: 'completed', item: 'B', agentId: 'a2', body: 'B body' },
        { outcome: 'aborted', item: 'C', state: 'not_started', body: 'C never started' },
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a2', 'C']);
    expect(rows[2]?.phase).toBe('failed');
    expect(rows[2]?.body).toBe('C never started');
  });

  it('does not duplicate a result row that a live member already covers', () => {
    const rows = buildDynamicWorkflowCardRows(
      [member('a1', '子任务 A', { phase: 'failed' })],
      result([{ outcome: 'aborted', item: 'A', agentId: 'a1', body: 'A body' }]),
    );
    expect(rows.map((r) => r.id)).toEqual(['a1']);
    expect(rows[0]?.phase).toBe('failed');
  });

  it('matches by item substring when agent ids disagree', () => {
    const rows = buildDynamicWorkflowCardRows(
      [member('a1', 'find unused exports in src', { phase: 'completed' })],
      result([{ outcome: 'aborted', item: 'unused exports', state: 'not_started', body: 'x' }]),
    );
    expect(rows.map((r) => r.id)).toEqual(['a1']);
  });
});
