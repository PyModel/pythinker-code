import { describe, expect, it } from 'vitest';
import { messagesToTurns } from '../src/composables/messagesToTurns';
import { buildDynamicWorkflowGroups } from '../src/composables/dynamicWorkflowGroups';
import type { AppMessage, AppTask } from '../src/api/types';

const now = '2026-06-13T00:00:00.000Z';

describe('messagesToTurns agent blocks', () => {
  it('renders one subagent task as an agent block', () => {
    const messages: AppMessage[] = [
      {
        id: 'msg_1',
        sessionId: 'ses_1',
        role: 'assistant',
        promptId: 'pr_1',
        createdAt: now,
        content: [
          { type: 'text', text: 'starting review' },
          { type: 'toolUse', toolCallId: 'tc_agent', toolName: 'agent', input: { description: 'review' } },
        ],
      },
    ];
    const tasks: AppTask[] = [
      {
        id: 'agent_1',
        sessionId: 'ses_1',
        kind: 'subagent',
        description: 'Review code',
        status: 'running',
        createdAt: now,
        subagentPhase: 'working',
        subagentType: 'coder',
        parentToolCallId: 'tc_agent',
        outputLines: ['Reading files', 'Running tests'],
      },
    ];

    const turns = messagesToTurns(messages, [], undefined, true, tasks);
    expect(turns[0]?.blocks?.[1]).toEqual({
      kind: 'agent',
      member: expect.objectContaining({
        id: 'agent_1',
        name: 'Review code',
        phase: 'working',
        subagentType: 'coder',
        outputLines: ['Reading files', 'Running tests'],
      }),
    });
    expect(turns[0]?.tools).toBeUndefined();
  });

  it('does NOT render a dynamic workflow (subagents with a dynamicWorkflowIndex) inline — it is a DynamicWorkflowCard', () => {
    const messages: AppMessage[] = [
      {
        id: 'msg_1',
        sessionId: 'ses_1',
        role: 'assistant',
        promptId: 'pr_1',
        createdAt: now,
        content: [
          { type: 'toolUse', toolCallId: 'tc_workflow', toolName: 'dynamic_workflow', input: { description: 'review', count: 2 } },
        ],
      },
    ];
    const tasks: AppTask[] = [
      {
        id: 'agent_b', sessionId: 'ses_1', kind: 'subagent', description: 'Second',
        status: 'running', createdAt: now, subagentPhase: 'queued', parentToolCallId: 'tc_workflow', dynamicWorkflowIndex: 2,
      } as AppTask,
      {
        id: 'agent_a', sessionId: 'ses_1', kind: 'subagent', description: 'First',
        status: 'completed', createdAt: now, subagentPhase: 'completed', parentToolCallId: 'tc_workflow', dynamicWorkflowIndex: 1,
      } as AppTask,
    ];

    // The dynamic workflow is rendered as its own DynamicWorkflowCard, so it must
    // NOT also appear inline in the transcript — that was the "two blocks" bug.
    const turns = messagesToTurns(messages, [], undefined, false, tasks);
    const hasInlineAgent = (turns[0]?.blocks ?? []).some(
      (b) => b.kind === 'agent' || b.kind === 'agentGroup',
    );
    expect(hasInlineAgent).toBe(false);
    // ...but it IS surfaced once, as a dynamic workflow group.
    expect(buildDynamicWorkflowGroups(tasks)).toHaveLength(1);
  });

  it('rebuilds a subagent AgentCard from the transcript when no live task exists (refresh)', () => {
    // After a refresh, a foreground subagent has no background-task record, only
    // the persisted Agent tool call + result. It must still render as an
    // AgentCard (not degrade to a plain tool card), carrying the prompt + result.
    const messages: AppMessage[] = [
      {
        id: 'msg_1',
        sessionId: 'ses_1',
        role: 'assistant',
        promptId: 'pr_1',
        createdAt: now,
        content: [
          {
            type: 'toolUse',
            toolCallId: 'tc_agent',
            toolName: 'Agent',
            input: { description: 'Audit auth', subagent_type: 'security', prompt: 'Look for auth bugs' },
          },
        ],
      },
      {
        id: 'msg_2',
        sessionId: 'ses_1',
        role: 'tool',
        createdAt: now,
        content: [
          { type: 'toolResult', toolCallId: 'tc_agent', output: 'Found 2 issues', isError: false },
        ],
      },
    ];

    // No tasks passed (the refresh case).
    const turns = messagesToTurns(messages, [], undefined, false, []);
    const block = turns[0]?.blocks?.[0];
    expect(block?.kind).toBe('agent');
    if (block?.kind !== 'agent') return;
    expect(block.member).toEqual(
      expect.objectContaining({
        name: 'Audit auth',
        subagentType: 'security',
        prompt: 'Look for auth bugs',
        phase: 'completed',
        summary: 'Found 2 issues',
      }),
    );
    // It must NOT also appear as a plain tool call.
    expect(turns[0]?.tools).toBeUndefined();
  });

  it('renders multiple non-workflow subagents as an inline agentGroup', () => {
    const messages: AppMessage[] = [
      {
        id: 'msg_1',
        sessionId: 'ses_1',
        role: 'assistant',
        promptId: 'pr_1',
        createdAt: now,
        content: [
          { type: 'toolUse', toolCallId: 'tc_agent', toolName: 'agent', input: { description: 'review' } },
        ],
      },
    ];
    const tasks: AppTask[] = [
      {
        id: 'agent_a', sessionId: 'ses_1', kind: 'subagent', description: 'First',
        status: 'completed', createdAt: '2026-06-13T00:00:00.000Z', subagentPhase: 'completed', parentToolCallId: 'tc_agent',
      },
      {
        id: 'agent_b', sessionId: 'ses_1', kind: 'subagent', description: 'Second',
        status: 'running', createdAt: '2026-06-13T00:00:01.000Z', subagentPhase: 'queued', parentToolCallId: 'tc_agent',
      },
    ];

    const turns = messagesToTurns(messages, [], undefined, false, tasks);
    const block = turns[0]?.blocks?.[0];
    expect(block?.kind).toBe('agentGroup');
    if (block?.kind !== 'agentGroup') return;
    expect(block.members.map((member) => member.id)).toEqual(['agent_a', 'agent_b']);
    // Not a dynamic workflow → no DynamicWorkflowCard.
    expect(buildDynamicWorkflowGroups(tasks)).toHaveLength(0);
  });
});
