import type { AgentTranscriptSnapshot } from '@pymodel/transcript';
import { describe, expect, it } from 'vitest';
import { transcriptSnapshotToTurns } from '../src/lib/transcriptToTurns';

const snapshot: AgentTranscriptSnapshot = {
  items: [
    {
      kind: 'turn',
      turnId: 'turn_1',
      ordinal: 1,
      state: 'running',
      origin: { kind: 'user' },
      prompt: 'Inspect the implementation',
      steps: [
        {
          kind: 'step',
          stepId: 'step_1',
          turnId: 'turn_1',
          ordinal: 1,
          state: 'running',
          frames: [
            {
              kind: 'thinking',
              frameId: 'thinking_1',
              text: 'I will inspect the source.',
            },
            {
              kind: 'tool',
              frameId: 'tool_frame_1',
              toolCallId: 'tool_1',
              name: 'Read',
              state: 'done',
              input: { path: 'src/App.vue' },
              output: 'Read complete',
            },
            {
              kind: 'text',
              frameId: 'text_1',
              role: 'assistant',
              text: 'The implementation is correct.',
            },
          ],
        },
      ],
    },
  ],
  tasks: [],
  interactions: [],
  attachments: [],
  todos: [],
  prompts: [],
  meta: { activity: 'turn' },
  hasMoreOlder: true,
};

describe('transcriptSnapshotToTurns', () => {
  it('projects the selected subagent prompt, thinking, tools, and output', () => {
    const turns = transcriptSnapshotToTurns(
      snapshot,
      { agentId: 'agent_1', type: 'sub', label: 'Inspector' },
      {
        sessionId: 'session_1',
        getFileUrl: (fileId) => `/files/${fileId}`,
      },
    );

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: 'user', text: 'Inspect the implementation' });
    expect(turns[1]).toMatchObject({
      role: 'assistant',
      text: 'The implementation is correct.',
      thinking: 'I will inspect the source.',
    });
    expect(turns[1]?.tools?.[0]).toMatchObject({
      id: 'tool_1',
      name: 'Read',
      status: 'ok',
      output: ['Read complete'],
    });
  });

  it('restores a mid-turn task notification from a task-linked user frame', () => {
    const turns = transcriptSnapshotToTurns(
      {
        items: [
          {
            kind: 'turn',
            turnId: 'turn_2',
            ordinal: 2,
            state: 'done',
            origin: { kind: 'user' },
            steps: [
              {
                kind: 'step',
                stepId: 'step_2',
                turnId: 'turn_2',
                ordinal: 1,
                state: 'done',
                frames: [
                  {
                    kind: 'text',
                    frameId: 'notification_1',
                    role: 'user',
                    text: [
                      '<notification id="notification_1" category="task" type="task.completed" source_kind="background_task" source_id="task_1">',
                      'Title: Background process completed',
                      'Severity: info',
                      '42 passed',
                      '<output-file path="/tmp/task-1.log" bytes="128">',
                      'Read the output file to retrieve the result: /tmp/task-1.log',
                      '</output-file>',
                      '</notification>',
                    ].join('\n'),
                    taskId: 'task_1',
                  },
                  {
                    kind: 'text',
                    frameId: 'answer_1',
                    role: 'assistant',
                    text: 'All checks passed.',
                  },
                ],
              },
            ],
          },
        ],
        tasks: [
          {
            taskId: 'task_1',
            kind: 'process',
            state: 'completed',
            detached: true,
            description: 'pnpm test',
            outputTail: '42 passed',
          },
        ],
        interactions: [],
        attachments: [],
        todos: [],
        prompts: [],
        meta: { activity: 'idle' },
        hasMoreOlder: false,
      },
      { agentId: 'main', type: 'main', label: 'Pythinker' },
      { sessionId: 'session_1', getFileUrl: (fileId) => `/files/${fileId}` },
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]?.blocks?.map((block) => block.kind)).toEqual(['notification', 'text']);
    expect(turns[0]?.blocks?.[0]).toMatchObject({
      kind: 'notification',
      notification: {
        id: 'notification_1',
        type: 'task.completed',
        sourceKind: 'background_task',
        sourceId: 'task_1',
        title: 'Background process completed',
        body: '42 passed',
        outputFile: { path: '/tmp/task-1.log', bytes: 128 },
      },
    });
  });
});
