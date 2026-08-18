import { describe, it, expect } from 'vitest';

import {
  questionAnswerMethodSchema,
  questionAnswerSchema,
  questionItemSchema,
  questionOptionSchema,
  questionRequestSchema,
  questionResponseSchema,
} from '../question';
import {
  questionResolveRequestSchema,
  questionResolveResultSchema,
  questionAlreadyResolvedDataSchema,
  questionDismissResultSchema,
  listPendingQuestionsQuerySchema,
  listPendingQuestionsResponseSchema,
} from '../rest/question';

describe('questionOptionSchema (SCHEMAS §6.2)', () => {
  it('accepts id+label', () => {
    expect(questionOptionSchema.parse({ id: 'opt_1', label: 'Yes' })).toEqual({
      id: 'opt_1',
      label: 'Yes',
    });
  });

  it('accepts optional description', () => {
    const parsed = questionOptionSchema.parse({
      id: 'opt_1',
      label: 'Yes',
      description: 'long form',
      preview: '```ts\nconst answer = true;\n```',
      url: 'https://example.test/answer',
    });
    expect(parsed.description).toBe('long form');
    expect(parsed.preview).toBe('```ts\nconst answer = true;\n```');
    expect(parsed.url).toBe('https://example.test/answer');
  });

  it('rejects missing id', () => {
    expect(() => questionOptionSchema.parse({ label: 'Yes' })).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "expected": "string",
          "code": "invalid_type",
          "path": [
            "id"
          ],
          "message": "Invalid input: expected string, received undefined"
        }
      ]]
    `);
  });
});

describe('questionItemSchema (SCHEMAS §6.2)', () => {
  const baseItem = {
    id: 'q_1',
    question: 'Which?',
    options: [
      { id: 'opt_1', label: 'Yes' },
      { id: 'opt_2', label: 'No' },
    ],
  };

  it('accepts a standard 2-option single-select item', () => {
    expect(questionItemSchema.parse(baseItem).id).toBe('q_1');
  });

  it('accepts a 4-option multi_select item with allow_other', () => {
    const parsed = questionItemSchema.parse({
      ...baseItem,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
        { id: 'd', label: 'D' },
      ],
      multi_select: true,
      allow_other: true,
      other_label: 'Other',
    });
    expect(parsed.multi_select).toBe(true);
    expect(parsed.allow_other).toBe(true);
    expect(parsed.other_label).toBe('Other');
  });

  it('accepts free input and single-preset questions', () => {
    expect(
      questionItemSchema.parse({ ...baseItem, options: [], allow_other: true }).options,
    ).toEqual([]);
    expect(
      questionItemSchema.parse({ ...baseItem, options: [baseItem.options[0]] }).options,
    ).toHaveLength(1);
  });

  it('accepts more than 4 options for schema-driven forms', () => {
    const tooMany = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, label: `L${i}` }));
    expect(questionItemSchema.parse({ ...baseItem, options: tooMany }).options).toHaveLength(5);
  });
});

describe('questionRequestSchema (SCHEMAS §6.2)', () => {
  const baseReq = {
    question_id: '01J_QUESTION',
    session_id: 'sess_x',
    questions: [
      {
        id: 'q_1',
        question: 'Which?',
        options: [
          { id: 'opt_1', label: 'A' },
          { id: 'opt_2', label: 'B' },
        ],
      },
    ],
    created_at: '2026-06-04T10:30:00Z',
  };

  it('accepts a 1-question request', () => {
    expect(questionRequestSchema.parse(baseReq).question_id).toBe('01J_QUESTION');
  });

  it('rejects 0 questions', () => {
    expect(() => questionRequestSchema.parse({ ...baseReq, questions: [] })).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "origin": "array",
          "code": "too_small",
          "minimum": 1,
          "inclusive": true,
          "path": [
            "questions"
          ],
          "message": "Too small: expected array to have >=1 items"
        }
      ]]
    `);
  });

  it('rejects more than 4 questions', () => {
    const tooMany = Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`,
      question: `?${i}`,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    }));
    expect(() => questionRequestSchema.parse({ ...baseReq, questions: tooMany })).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "origin": "array",
          "code": "too_big",
          "maximum": 4,
          "inclusive": true,
          "path": [
            "questions"
          ],
          "message": "Too big: expected array to have <=4 items"
        }
      ]]
    `);
  });

  it('normalizes timestamps to UTC', () => {
    const parsed = questionRequestSchema.parse({
      ...baseReq,
      created_at: '2026-06-04T18:30:00+08:00',
    });
    expect(parsed.created_at).toBe('2026-06-04T10:30:00.000Z');
  });
});

describe('questionAnswerSchema 5-kind discriminated union (SCHEMAS §6.2)', () => {
  it.each([
    ['single', { kind: 'single', option_id: 'opt_1' }],
    ['multi', { kind: 'multi', option_ids: ['opt_1', 'opt_2'] }],
    ['other', { kind: 'other', text: 'free form' }],
    [
      'multi_with_other',
      { kind: 'multi_with_other', option_ids: ['opt_1'], other_text: 'tail' },
    ],
    ['skipped', { kind: 'skipped' }],
  ] as const)('accepts %s kind', (_, val) => {
    expect(questionAnswerSchema.parse(val)).toEqual(val);
  });

  it('rejects single with empty option_id', () => {
    expect(() => questionAnswerSchema.parse({ kind: 'single', option_id: '' })).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "origin": "string",
          "code": "too_small",
          "minimum": 1,
          "inclusive": true,
          "path": [
            "option_id"
          ],
          "message": "Too small: expected string to have >=1 characters"
        }
      ]]
    `);
  });

  it('rejects multi with empty option_ids array', () => {
    expect(() => questionAnswerSchema.parse({ kind: 'multi', option_ids: [] })).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "origin": "array",
          "code": "too_small",
          "minimum": 1,
          "inclusive": true,
          "path": [
            "option_ids"
          ],
          "message": "Too small: expected array to have >=1 items"
        }
      ]]
    `);
  });

  it('rejects unknown kind', () => {
    expect(() => questionAnswerSchema.parse({ kind: 'rangefinder', value: 42 })).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "code": "invalid_union",
          "errors": [],
          "note": "No matching discriminator",
          "discriminator": "kind",
          "options": [
            "single",
            "multi",
            "other",
            "multi_with_other",
            "skipped"
          ],
          "path": [
            "kind"
          ],
          "message": "Invalid discriminator value. Expected 'single' | 'multi' | 'other' | 'multi_with_other' | 'skipped'"
        }
      ]]
    `);
  });
});

describe('questionResponseSchema annotations', () => {
  it('accepts selected previews and trimmed user notes keyed by question text', () => {
    const parsed = questionResponseSchema.parse({
      answers: { q_0: { kind: 'single', option_id: 'opt_0_1' } },
      annotations: {
        'Which database?': {
          preview: 'const database = new Database("example.db");',
          notes: 'Prefer the embedded option.',
        },
      },
    });

    expect(parsed.annotations).toEqual({
      'Which database?': {
        preview: 'const database = new Database("example.db");',
        notes: 'Prefer the embedded option.',
      },
    });
  });
});

describe('questionAnswerMethodSchema', () => {
  it.each(['enter', 'space', 'number_key', 'click'] as const)('accepts %s', (m) => {
    expect(questionAnswerMethodSchema.parse(m)).toBe(m);
  });

  it('rejects unknown method', () => {
    expect(() => questionAnswerMethodSchema.parse('voice')).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "code": "invalid_value",
          "values": [
            "enter",
            "space",
            "number_key",
            "click"
          ],
          "path": [],
          "message": "Invalid option: expected one of \\"enter\\"|\\"space\\"|\\"number_key\\"|\\"click\\""
        }
      ]]
    `);
  });
});

describe('questionResponseSchema (SCHEMAS §6.2)', () => {
  it('accepts a single-answer response with all optional fields', () => {
    const parsed = questionResponseSchema.parse({
      answers: { q_1: { kind: 'single', option_id: 'opt_1' } },
      method: 'click',
      note: 'all done',
    });
    expect(parsed.answers['q_1']).toEqual({ kind: 'single', option_id: 'opt_1' });
    expect(parsed.method).toBe('click');
    expect(parsed.note).toBe('all done');
  });

  it('accepts a mixed-kind response (partial-answer pattern)', () => {
    const parsed = questionResponseSchema.parse({
      answers: {
        q_1: { kind: 'single', option_id: 'opt_1' },
        q_2: { kind: 'multi', option_ids: ['opt_1', 'opt_2'] },
        q_3: { kind: 'other', text: 'free' },
        q_4: { kind: 'skipped' },
      },
    });
    expect(Object.keys(parsed.answers)).toHaveLength(4);
  });
});

describe('questionResolveRequestSchema (REST §3.6)', () => {
  it('aliases questionResponseSchema', () => {
    const parsed = questionResolveRequestSchema.parse({
      answers: { q_1: { kind: 'skipped' } },
    });
    expect(parsed.answers['q_1']).toEqual({ kind: 'skipped' });
  });
});

describe('questionResolveResultSchema (REST §3.6)', () => {
  it('requires resolved:true literal + ISO resolved_at', () => {
    const parsed = questionResolveResultSchema.parse({
      resolved: true,
      resolved_at: '2026-06-04T10:31:00Z',
    });
    expect(parsed.resolved).toBe(true);
  });

  it('rejects resolved:false', () => {
    expect(() =>
      questionResolveResultSchema.parse({ resolved: false, resolved_at: '2026-06-04T10:31:00Z' }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "code": "invalid_value",
          "values": [
            true
          ],
          "path": [
            "resolved"
          ],
          "message": "Invalid input: expected true"
        }
      ]]
    `);
  });
});

describe('questionAlreadyResolvedDataSchema (REST §3.6 idempotent 40902)', () => {
  it('accepts resolved:false', () => {
    expect(questionAlreadyResolvedDataSchema.parse({ resolved: false })).toEqual({
      resolved: false,
    });
  });

  it('rejects resolved:true', () => {
    expect(() => questionAlreadyResolvedDataSchema.parse({ resolved: true })).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "code": "invalid_value",
          "values": [
            false
          ],
          "path": [
            "resolved"
          ],
          "message": "Invalid input: expected false"
        }
      ]]
    `);
  });
});

describe('questionDismissResultSchema (REST §3.6 dismiss with code 40909)', () => {
  it('requires dismissed:true literal + ISO dismissed_at', () => {
    const parsed = questionDismissResultSchema.parse({
      dismissed: true,
      dismissed_at: '2026-06-04T10:32:00Z',
    });
    expect(parsed.dismissed).toBe(true);
    expect(parsed.dismissed_at).toBe('2026-06-04T10:32:00.000Z');
  });

  it('rejects dismissed:false', () => {
    expect(() =>
      questionDismissResultSchema.parse({
        dismissed: false,
        dismissed_at: '2026-06-04T10:32:00Z',
      }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "code": "invalid_value",
          "values": [
            true
          ],
          "path": [
            "dismissed"
          ],
          "message": "Invalid input: expected true"
        }
      ]]
    `);
  });
});

describe('listPendingQuestionsResponseSchema (REST pending recovery)', () => {
  const pendingQuestion = {
    question_id: '01J_QUESTION',
    session_id: 'sess_x',
    questions: [
      {
        id: 'q_1',
        question: 'Which?',
        options: [
          { id: 'opt_1', label: 'A' },
          { id: 'opt_2', label: 'B' },
        ],
      },
    ],
    created_at: '2026-06-04T10:30:00Z',
  };

  it('accepts status=pending query', () => {
    expect(listPendingQuestionsQuerySchema.parse({ status: 'pending' })).toEqual({
      status: 'pending',
    });
  });

  it('rejects unsupported status query', () => {
    expect(() =>
      listPendingQuestionsQuerySchema.parse({ status: 'answered' }),
    ).toThrowErrorMatchingInlineSnapshot(`
      [ZodError: [
        {
          "code": "invalid_value",
          "values": [
            "pending"
          ],
          "path": [
            "status"
          ],
          "message": "Invalid input: expected \\"pending\\""
        }
      ]]
    `);
  });

  it('returns question request items', () => {
    const parsed = listPendingQuestionsResponseSchema.parse({
      items: [pendingQuestion],
    });
    expect(parsed.items[0]?.question_id).toBe('01J_QUESTION');
    expect(parsed.items[0]?.questions[0]?.options).toHaveLength(2);
  });
});
