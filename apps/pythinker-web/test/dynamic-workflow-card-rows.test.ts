import { describe, expect, it } from 'vitest';
import type { AppSubagentPhase } from '../src/api/types';
import type { DynamicWorkflowMember } from '../src/composables/dynamicWorkflowGroups';
import type { DynamicWorkflowResult } from '../src/lib/parseDynamicWorkflowResult';
import {
  buildDynamicWorkflowCardRows,
  dynamicWorkflowMemberActivity,
  dynamicWorkflowRowElapsedMs,
  type DynamicWorkflowCardRow,
  formatElapsed,
  groupDynamicWorkflowRows,
} from '../src/lib/dynamicWorkflowCardRows';

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

describe('dynamicWorkflowMemberActivity', () => {
  it('prefers streamed subagent text over outputLines and summary', () => {
    const m = member('a', 'subtask', {
      text: 'line 1\nline 2',
      outputLines: ['tool call output'],
      summary: 'final summary',
    });
    expect(dynamicWorkflowMemberActivity(m)).toBe('line 2');
  });

  it('falls back to the last outputLines entry when no text is streaming', () => {
    const m = member('a', 'subtask', { outputLines: ['one', 'two'], summary: 'summary' });
    expect(dynamicWorkflowMemberActivity(m)).toBe('two');
  });

  it('falls back to summary', () => {
    expect(dynamicWorkflowMemberActivity(member('a', 'subtask', { summary: 'sum' }))).toBe('sum');
  });
});

describe('buildDynamicWorkflowCardRows', () => {
  it('builds rows from live members when no parsed result exists', () => {
    const rows = buildDynamicWorkflowCardRows(
      [member('a', 'subtask A', { text: 'streaming' })],
      null,
    );
    expect(rows).toEqual([{ id: 'a', name: 'subtask A', activity: 'streaming', phase: 'working', body: 'streaming', live: true }]);
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
        member('a1', 'subtask A', { phase: 'completed' }),
        member('a2', 'subtask B', { phase: 'working' }),
      ],
      result([
        { outcome: 'completed', item: 'A', agentId: 'a1', body: 'A body' },
        { outcome: 'completed', item: 'B', agentId: 'a2', body: 'B body' },
        { outcome: 'aborted', item: 'C', state: 'not_started', body: 'C never started' },
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a2', 'C']);
    // Aborted / not_started rows are cancelled work — a neutral phase, not a
    // failure (reference SwarmTool maps them to the `cancelled` phase).
    expect(rows[2]?.phase).toBe('cancelled');
    expect(rows[2]?.body).toBe('C never started');
  });

  it('does not duplicate a result row that a live member already covers', () => {
    const rows = buildDynamicWorkflowCardRows(
      [member('a1', 'subtask A', { phase: 'failed' })],
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

describe('buildDynamicWorkflowCardRows binding pass-through', () => {
  const routing = {
    operation: 'spawn' as const,
    profileSource: 'default' as const,
    modelSource: 'policy-force' as const,
    policyMode: 'force' as const,
    policySource: 'config' as const,
    featureSource: 'env' as const,
    routingEnvRevision: 'route-env:v1:aaa',
    routeDecision: 'route-decision:v1:bbb',
  };

  it('keeps profile, model, effort, routing and timestamps from live members', () => {
    const rows = buildDynamicWorkflowCardRows(
      [
        {
          ...member('t1', 'Review #1'),
          subagentType: 'explore',
          model: 'acme/luna',
          thinkingEffort: 'low',
          routing,
          currentRoutingEnvRevision: 'route-env:v1:now',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:05.000Z',
        },
      ],
      null,
    );
    expect(rows[0]).toMatchObject({
      live: true,
      profile: 'explore',
      model: 'acme/luna',
      thinkingEffort: 'low',
      routing,
      currentRoutingEnvRevision: 'route-env:v1:now',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
    });
  });

  it('keeps the durable binding attributes on result-only rows after a reload', () => {
    const rows = buildDynamicWorkflowCardRows(
      [],
      result([
        {
          outcome: 'completed',
          item: 'alpha',
          agentId: 'a1',
          body: 'done',
          profile: 'explore',
          model: 'acme/luna',
          thinking: 'low',
          routing,
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:05.000Z',
        },
        { outcome: 'completed', item: 'beta', body: 'old row' },
      ]),
    );
    expect(rows[0]).toMatchObject({
      live: false,
      profile: 'explore',
      model: 'acme/luna',
      thinkingEffort: 'low',
      routing,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:00:05.000Z',
    });
    expect(rows[1]?.routing).toBeUndefined();
    expect(rows[1]?.model).toBeUndefined();
  });
});

describe('groupDynamicWorkflowRows', () => {
  const row = (id: string, phase: AppSubagentPhase, extra: Partial<DynamicWorkflowCardRow> = {}): DynamicWorkflowCardRow => ({
    id,
    name: id,
    activity: '',
    phase,
    body: '',
    live: true,
    ...extra,
  });

  it('puts Failed first while running with failures and keeps every phase', () => {
    const groups = groupDynamicWorkflowRows(
      [row('a', 'completed'), row('b', 'working'), row('c', 'failed'), row('d', 'queued'), row('e', 'suspended'), row('f', 'cancelled')],
      true,
    );
    expect(groups.map((g) => g.phase)).toEqual(['failed', 'suspended', 'working', 'queued', 'completed', 'cancelled']);
    expect(groups.flatMap((g) => g.rows).map((r) => r.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(groups.find((g) => g.phase === 'failed')?.expanded).toBe(true);
    expect(groups.find((g) => g.phase === 'suspended')?.expanded).toBe(true);
    expect(groups.find((g) => g.phase === 'completed')?.expanded).toBe(false);
  });

  it('leads with Working while running healthy', () => {
    const groups = groupDynamicWorkflowRows([row('a', 'completed'), row('b', 'working'), row('d', 'queued')], true);
    expect(groups.map((g) => g.phase)).toEqual(['working', 'queued', 'completed']);
  });

  it('leads with Failed once settled and keeps residual Working/Queued rows visible and expanded', () => {
    const groups = groupDynamicWorkflowRows(
      [row('a', 'completed'), row('b', 'working'), row('c', 'failed'), row('f', 'cancelled'), row('q', 'queued')],
      false,
    );
    expect(groups.map((g) => g.phase)).toEqual(['failed', 'cancelled', 'completed', 'working', 'queued']);
    expect(groups.every((g) => g.expanded)).toBe(true);
  });

  it('omits empty phases', () => {
    expect(groupDynamicWorkflowRows([row('a', 'completed')], false).map((g) => g.phase)).toEqual(['completed']);
    expect(groupDynamicWorkflowRows([], true)).toEqual([]);
  });
});

describe('elapsed time', () => {
  const NOW = Date.parse('2026-01-01T00:10:00.000Z');

  it('uses now - startedAt for active rows and completedAt - startedAt for settled rows', () => {
    expect(dynamicWorkflowRowElapsedMs({ phase: 'working', startedAt: '2026-01-01T00:08:30.000Z' }, NOW)).toBe(90_000);
    expect(
      dynamicWorkflowRowElapsedMs(
        { phase: 'completed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:01:05.000Z' },
        NOW,
      ),
    ).toBe(65_000);
    expect(dynamicWorkflowRowElapsedMs({ phase: 'failed', startedAt: '2026-01-01T00:00:00.000Z' }, NOW)).toBeUndefined();
    expect(dynamicWorkflowRowElapsedMs({ phase: 'queued' }, NOW)).toBeUndefined();
    expect(dynamicWorkflowRowElapsedMs({ phase: 'working', startedAt: 'not a date' }, NOW)).toBeUndefined();
  });

  it('formats m:ss and h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65_000)).toBe('1:05');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });
});
