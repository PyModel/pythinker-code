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
});
