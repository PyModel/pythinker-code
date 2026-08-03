/*
 * Verifies renderer-neutral tool status, verb, and grouping decisions.
 */

import { describe, expect, it } from 'vitest';
import {
  deriveToolStatus,
  deriveToolVerb,
  ToolGroupPlanner,
} from '../../../src/tui/presentation/tool-presentation-model';

describe('deriveToolStatus', () => {
  it('derives every unfinished status', () => {
    expect(deriveToolStatus({ hasResult: false, truncated: true })).toBe('truncated');
    expect(deriveToolStatus({ hasResult: false, streamingArguments: '{}' })).toBe('streaming');
    expect(deriveToolStatus({ hasResult: false, streamingArguments: '' })).toBe('streaming');
    expect(deriveToolStatus({ hasResult: false })).toBe('running');
  });

  it('gives completed results precedence over unfinished state', () => {
    expect(deriveToolStatus({ hasResult: true, truncated: true })).toBe('done');
    expect(
      deriveToolStatus({
        hasResult: true,
        truncated: true,
        streamingArguments: '',
      }),
    ).toBe('done');
  });

  it('only treats errors with results as failed', () => {
    expect(deriveToolStatus({ hasResult: true, isError: true })).toBe('failed');
    expect(deriveToolStatus({ hasResult: false, isError: true })).toBe('running');
  });
});

describe('deriveToolVerb', () => {
  it('maps every status to its presentation verb', () => {
    expect(deriveToolVerb('done')).toBe('Used');
    expect(deriveToolVerb('failed')).toBe('Used');
    expect(deriveToolVerb('truncated')).toBe('Truncated');
    expect(deriveToolVerb('streaming')).toBe('Using');
    expect(deriveToolVerb('running')).toBe('Using');
  });
});

describe('ToolGroupPlanner', () => {
  it('places a lone Agent call standalone', () => {
    const planner = new ToolGroupPlanner();

    expect(planner.place({ toolCallId: 'a1', name: 'Agent', step: 1, turnId: 't1' })).toEqual({
      kind: 'standalone',
      toolCallId: 'a1',
    });
  });

  it('opens a group for two matching Agent calls and appends a third', () => {
    const planner = new ToolGroupPlanner();
    planner.place({ toolCallId: 'a1', name: 'Agent', step: 1, turnId: 't1' });

    expect(
      planner.place({ toolCallId: 'a2', name: 'Agent', step: 1, turnId: 't1' }),
    ).toEqual({
      kind: 'open-group',
      groupKey: 'group:Agent:0',
      toolCallIds: ['a1', 'a2'],
    });
    expect(
      planner.place({ toolCallId: 'a3', name: 'Agent', step: 1, turnId: 't1' }),
    ).toEqual({
      kind: 'append-group',
      groupKey: 'group:Agent:0',
      toolCallId: 'a3',
    });
  });

  it('starts new groups after differing steps and turn ids', () => {
    const planner = new ToolGroupPlanner();
    planner.place({ toolCallId: 'a1', name: 'Agent', step: 1, turnId: 't1' });
    const first = planner.place({ toolCallId: 'a2', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({ toolCallId: 'a3', name: 'Agent', step: 2, turnId: 't1' });
    const second = planner.place({ toolCallId: 'a4', name: 'Agent', step: 2, turnId: 't1' });
    planner.place({ toolCallId: 'a5', name: 'Agent', step: 2, turnId: 't2' });
    const third = planner.place({ toolCallId: 'a6', name: 'Agent', step: 2, turnId: 't2' });

    expect(first).toEqual({
      kind: 'open-group',
      groupKey: 'group:Agent:0',
      toolCallIds: ['a1', 'a2'],
    });
    expect(second).toEqual({
      kind: 'open-group',
      groupKey: 'group:Agent:1',
      toolCallIds: ['a3', 'a4'],
    });
    expect(third).toEqual({
      kind: 'open-group',
      groupKey: 'group:Agent:2',
      toolCallIds: ['a5', 'a6'],
    });
  });

  it('clears the pending Agent slot when a Read call arrives', () => {
    const planner = new ToolGroupPlanner();
    planner.place({ toolCallId: 'a1', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({ toolCallId: 'a2', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({ toolCallId: 'r1', name: 'Read', step: 1, turnId: 't1' });

    expect(planner.place({ toolCallId: 'a3', name: 'Agent', step: 1, turnId: 't1' })).toEqual({
      kind: 'standalone',
      toolCallId: 'a3',
    });
  });

  it('leaves an open group intact across a deferred question', () => {
    const planner = new ToolGroupPlanner();
    planner.place({ toolCallId: 'a1', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({ toolCallId: 'a2', name: 'Agent', step: 1, turnId: 't1' });

    expect(
      planner.place({
        toolCallId: 'q1',
        name: 'AskUserQuestion',
        step: 2,
        turnId: 't2',
      }),
    ).toEqual({ kind: 'deferred' });
    expect(
      planner.place({ toolCallId: 'a3', name: 'Agent', step: 1, turnId: 't1' }),
    ).toEqual({
      kind: 'append-group',
      groupKey: 'group:Agent:0',
      toolCallId: 'a3',
    });
  });

  it('tracks Agent and Read independently without merging them', () => {
    const planner = new ToolGroupPlanner();
    planner.place({ toolCallId: 'a1', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({
      toolCallId: 'q1',
      name: 'AskUserQuestion',
      step: 1,
      turnId: 't1',
    });
    planner.place({ toolCallId: 'a2', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({
      toolCallId: 'q2',
      name: 'AskUserQuestion',
      step: 1,
      turnId: 't1',
    });
    planner.place({ toolCallId: 'a3', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({
      toolCallId: 'q3',
      name: 'AskUserQuestion',
      step: 1,
      turnId: 't1',
    });
    planner.place({ toolCallId: 'r1', name: 'Read', step: 1, turnId: 't1' });
    planner.place({
      toolCallId: 'q4',
      name: 'AskUserQuestion',
      step: 1,
      turnId: 't1',
    });

    expect(planner.place({ toolCallId: 'r2', name: 'Read', step: 1, turnId: 't1' })).toEqual({
      kind: 'open-group',
      groupKey: 'group:Read:1',
      toolCallIds: ['r1', 'r2'],
    });
  });

  it('uses different keys when an unrelated call separates identical groups', () => {
    const planner = new ToolGroupPlanner();
    planner.place({ toolCallId: 'a1', name: 'Agent', step: 1, turnId: 't1' });
    const first = planner.place({ toolCallId: 'a2', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({ toolCallId: 'b1', name: 'Bash', step: 1, turnId: 't1' });
    planner.place({ toolCallId: 'a3', name: 'Agent', step: 1, turnId: 't1' });
    const second = planner.place({ toolCallId: 'a4', name: 'Agent', step: 1, turnId: 't1' });

    expect(first).toEqual({
      kind: 'open-group',
      groupKey: 'group:Agent:0',
      toolCallIds: ['a1', 'a2'],
    });
    expect(second).toEqual({
      kind: 'open-group',
      groupKey: 'group:Agent:1',
      toolCallIds: ['a3', 'a4'],
    });
  });

  it('clears slots and restarts key numbering on reset', () => {
    const planner = new ToolGroupPlanner();
    planner.place({ toolCallId: 'a1', name: 'Agent', step: 1, turnId: 't1' });
    planner.place({ toolCallId: 'a2', name: 'Agent', step: 1, turnId: 't1' });
    planner.reset();

    expect(planner.place({ toolCallId: 'a3', name: 'Agent', step: 1, turnId: 't1' })).toEqual({
      kind: 'standalone',
      toolCallId: 'a3',
    });
    expect(planner.place({ toolCallId: 'a4', name: 'Agent', step: 1, turnId: 't1' })).toEqual({
      kind: 'open-group',
      groupKey: 'group:Agent:0',
      toolCallIds: ['a3', 'a4'],
    });
  });
});
