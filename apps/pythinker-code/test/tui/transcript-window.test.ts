import { describe, expect, it } from 'vitest';

import type { TranscriptEntry } from '#/tui/types';
import {
  groupTurns,
  turnsToTrim,
} from '#/tui/utils/transcript-window';

function entry(id: string, turnId?: string): TranscriptEntry {
  return { id, kind: 'assistant', turnId, renderMode: 'plain', content: id };
}

describe('transcript window', () => {
  it('groups pending prompts with their turn and trims complete oldest turns', () => {
    const entries = [
      entry('prompt-1'),
      entry('answer-1', '1'),
      entry('prompt-2'),
      entry('answer-2', '2'),
      entry('prompt-3'),
      entry('answer-3', '3'),
      entry('prompt-4'),
    ];
    const turns = groupTurns(entries);

    expect(turns.map((turn) => turn.entries.map(({ id }) => id))).toEqual([
      ['prompt-1', 'answer-1'],
      ['prompt-2', 'answer-2'],
      ['prompt-3', 'answer-3'],
      ['prompt-4'],
    ]);
    expect([...turnsToTrim(turns, 2, 1)].map(({ id }) => id)).toEqual([
      'prompt-1',
      'answer-1',
      'prompt-2',
      'answer-2',
    ]);
  });
});
