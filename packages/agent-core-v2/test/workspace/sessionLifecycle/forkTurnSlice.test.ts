import { describe, expect, it } from 'vitest';

import {
  sliceMainRecordsAtTurn,
  sliceMainRecordsBeforePrompt,
} from '#/workspace/sessionLifecycle/internal/forkTurnSlice';
import type { WireRecord } from '#/wire/record';

function userTurnRecord(text: string, time: number, id?: string): WireRecord {
  return {
    type: 'context.append_message',
    message: {
      role: 'user',
      id,
      content: [{ type: 'text', text }],
      origin: { kind: 'user' },
    },
    time,
  };
}

describe('sliceMainRecordsAtTurn', () => {
  it('keeps cron records that fall inside a truncated fork slice', () => {
    const records: WireRecord[] = [
      { type: 'metadata', protocol_version: '1.5', created_at: 1 },
      {
        type: 'cron.add',
        task: { id: 'aa11bb22', cron: '0 9 * * *', prompt: 'legacy', createdAt: 2 },
        time: 2,
      },
      userTurnRecord('hello', 3),
      { type: 'cron.cursor', id: 'aa11bb22', lastFiredAt: 4, time: 4 },
      userTurnRecord('second turn', 5),
      { type: 'cron.add', task: { id: 'bb22cc33', cron: '0 10 * * *', prompt: 'late', createdAt: 6 }, time: 6 },
    ];

    const slice = sliceMainRecordsAtTurn(records, 'ses_source', 0);

    const types = slice.records.map((record) => record.type);
    expect(types).toContain('cron.add');
    expect(types).toContain('cron.cursor');
    expect(
      slice.records.filter((record) => record.type === 'cron.add'),
    ).toHaveLength(1);
    expect(types).toContain('metadata');
    expect(types).toContain('context.append_message');
  });
});

describe('sliceMainRecordsBeforePrompt', () => {
  it('keeps the completed turn before an active Expert Talk prompt', () => {
    const records: WireRecord[] = [
      { type: 'metadata', protocol_version: '1.5', created_at: 1 },
      { type: 'turn.prompt', input: [{ type: 'text', text: 'first' }], origin: { kind: 'user' }, time: 2 },
      userTurnRecord('first', 3, 'prompt-1'),
      { type: 'assistant.delta', delta: 'answer one', time: 4 },
      { type: 'turn.prompt', input: [{ type: 'text', text: 'active' }], origin: { kind: 'user' }, time: 5 },
      userTurnRecord('active', 6, 'prompt-2'),
      { type: 'assistant.delta', delta: 'partial exchange', time: 7 },
    ];

    const slice = sliceMainRecordsBeforePrompt(records, 'ses_source', 'prompt-2');

    expect(slice.records).toContainEqual(userTurnRecord('first', 3, 'prompt-1'));
    expect(slice.records).not.toContainEqual(userTurnRecord('active', 6, 'prompt-2'));
    expect(slice.records.some((record) => record['delta'] === 'partial exchange')).toBe(false);
    expect(slice.lastPrompt).toBe('first');
    expect(slice.cutoffTime).toBe(4);
  });

  it('keeps only pre-turn records when the active Expert Talk prompt is first', () => {
    const records: WireRecord[] = [
      { type: 'metadata', protocol_version: '1.5', created_at: 1 },
      { type: 'turn.prompt', input: [{ type: 'text', text: 'active' }], origin: { kind: 'user' }, time: 2 },
      userTurnRecord('active', 3, 'prompt-1'),
      { type: 'assistant.delta', delta: 'partial exchange', time: 4 },
    ];

    const slice = sliceMainRecordsBeforePrompt(records, 'ses_source', 'prompt-1');

    expect(slice.records).toEqual([{ type: 'metadata', protocol_version: '1.5', created_at: 1 }]);
    expect(slice.cutoffTime).toBe(1);
    expect(slice.lastPrompt).toBeUndefined();
  });

  it('rejects an unknown active prompt', () => {
    expect(() => sliceMainRecordsBeforePrompt(
      [userTurnRecord('first', 1, 'prompt-1')],
      'ses_source',
      'missing',
    )).toThrow('Prompt "missing" was not found');
  });
});
