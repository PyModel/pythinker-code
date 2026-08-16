/**
 * Question adapter unit tests (W8.2 / Chain 6).
 *
 * Covers protocol answer normalization into the text the user sees.
 */

import { describe, expect, it } from 'vitest';

import type { QuestionRequest as InProcessQuestionRequest } from '../../src';

import {
  questionDismissedResult as dismissedResult,
  questionToAgentCoreResponse as toAgentCoreResponse,
  questionToBrokerRequest as toBrokerRequest,
} from '../../src/services';

describe('question-adapter · toBrokerRequest (in-process → protocol)', () => {
  const inProc: InProcessQuestionRequest = {
    turnId: 7,
    toolCallId: 'tc_q',
    questions: [
      {
        question: 'Which animal?',
        header: 'Pets',
        body: 'pick one',
        options: [
          {
            label: 'Cat',
            preview: 'Cat profile preview',
            url: 'https://example.test/cat',
          },
          { label: 'Dog' },
        ],
        multiSelect: false,
        allowOther: false,
      },
      {
        question: 'Which colors?',
        options: [
          { label: 'Red' },
          { label: 'Green' },
          { label: 'Blue' },
        ],
        multiSelect: true,
        otherLabel: 'Other',
      },
    ],
  };

  it('synthesizes stable q_<idx> + opt_<parent>_<opt> ids and maps fields', () => {
    const protoReq = toBrokerRequest(inProc, {
      questionId: '01J_QUESTION',
      sessionId: 'sess_x',
      createdAt: '2026-06-04T10:30:00.000Z',
      expiresAt: '2026-06-04T10:31:00.000Z',
    });

    expect(protoReq.question_id).toBe('01J_QUESTION');
    expect(protoReq.session_id).toBe('sess_x');
    expect(protoReq.turn_id).toBe(7);
    expect(protoReq.tool_call_id).toBe('tc_q');

    expect(protoReq.questions).toHaveLength(2);
    expect(protoReq.questions[0]?.id).toBe('q_0');
    expect(protoReq.questions[0]?.options[0]?.id).toBe('opt_0_0');
    expect(protoReq.questions[0]?.options[0]?.preview).toBe('Cat profile preview');
    expect(protoReq.questions[0]?.options[0]?.url).toBe('https://example.test/cat');
    expect(protoReq.questions[0]?.options[1]?.id).toBe('opt_0_1');
    expect(protoReq.questions[0]?.header).toBe('Pets');
    expect(protoReq.questions[0]?.body).toBe('pick one');
    expect(protoReq.questions[0]?.multi_select).toBe(false);
    expect(protoReq.questions[0]?.allow_other).toBe(false);

    expect(protoReq.questions[1]?.id).toBe('q_1');
    expect(protoReq.questions[1]?.options.map((o) => o.id)).toEqual([
      'opt_1_0',
      'opt_1_1',
      'opt_1_2',
    ]);
    expect(protoReq.questions[1]?.multi_select).toBe(true);
    expect(protoReq.questions[1]?.allow_other).toBe(true);
    expect(protoReq.questions[1]?.other_label).toBe('Other');
  });

  it('omits turn_id / tool_call_id when SDK does not provide them', () => {
    const minimal: InProcessQuestionRequest = {
      questions: [
        {
          question: '?',
          options: [{ label: 'A' }, { label: 'B' }],
        },
      ],
    };
    const protoReq = toBrokerRequest(minimal, {
      questionId: 'q',
      sessionId: 's',
      createdAt: '2026-06-04T10:30:00.000Z',
      expiresAt: '2026-06-04T10:31:00.000Z',
    });
    expect(protoReq.turn_id).toBeUndefined();
    expect(protoReq.tool_call_id).toBeUndefined();
  });
});

describe('question-adapter · toAgentCoreResponse (protocol ids → user-facing text)', () => {
  const request = {
    question_id: '01J_QUESTION',
    session_id: 'sess_x',
    questions: [
      {
        id: 'q_0',
        question: 'Which animal?',
        options: [
          { id: 'opt_0_0', label: 'Cat' },
          { id: 'opt_0_1', label: 'Dog' },
        ],
      },
      {
        id: 'q_1',
        question: 'Which colors?',
        options: [
          { id: 'opt_1_0', label: 'Red' },
          { id: 'opt_1_1', label: 'Green' },
          { id: 'opt_1_2', label: 'Blue' },
        ],
      },
    ],
    created_at: '2026-06-04T10:30:00.000Z',
    expires_at: '2026-06-04T11:00:00.000Z',
  };

  it("'single' maps the question text to the option label", () => {
    const inProc = toAgentCoreResponse({
      answers: { q_0: { kind: 'single', option_id: 'opt_0_1' } },
    }, request);
    expect(inProc.answers).toEqual({ 'Which animal?': 'Dog' });
  });

  it("'multi' maps option ids to labels", () => {
    const inProc = toAgentCoreResponse({
      answers: {
        q_1: { kind: 'multi', option_ids: ['opt_1_0', 'opt_1_2'] },
      },
    }, request);
    expect(inProc.answers).toEqual({ 'Which colors?': 'Red, Blue' });
  });

  it("'other' keeps the entered text", () => {
    const inProc = toAgentCoreResponse({
      answers: { q_0: { kind: 'other', text: 'Hippopotamus' } },
    }, request);
    expect(inProc.answers).toEqual({ 'Which animal?': 'Hippopotamus' });
  });

  it("'multi_with_other' maps labels and keeps the entered text", () => {
    const inProc = toAgentCoreResponse({
      answers: {
        q_1: {
          kind: 'multi_with_other',
          option_ids: ['opt_1_0', 'opt_1_1'],
          other_text: 'Custom',
        },
      },
    }, request);
    expect(inProc.answers).toEqual({ 'Which colors?': 'Red, Green, Custom' });
  });

  it("'skipped' omits the answer", () => {
    const inProc = toAgentCoreResponse({
      answers: {
        q_0: { kind: 'single', option_id: 'opt_0_0' },
        q_1: { kind: 'skipped' },
      },
    }, request);
    expect(inProc.answers).toEqual({
      'Which animal?': 'Cat',
    });
    expect(Object.keys(inProc.answers)).not.toContain('Which colors?');
  });

  it('falls back to raw ids for unknown questions and options', () => {
    const inProc = toAgentCoreResponse({
      answers: {
        q_0: { kind: 'single', option_id: 'opt_0_unknown' },
        q_unknown: { kind: 'single', option_id: 'opt_unknown' },
      },
    }, request);
    expect(inProc.answers).toEqual({
      'Which animal?': 'opt_0_unknown',
      q_unknown: 'opt_unknown',
    });
  });

  it("drops the protocol-only 'click' method", () => {
    const inProc = toAgentCoreResponse({
      answers: { q_0: { kind: 'single', option_id: 'opt_0_0' } },
      method: 'click',
    }, request);
    expect(inProc.answers).toEqual({ 'Which animal?': 'Cat' });
    expect((inProc as { method?: string }).method).toBeUndefined();
  });

  it("keeps agent-core method values like 'enter' / 'space' / 'number_key'", () => {
    const inProc = toAgentCoreResponse({
      answers: { q_0: { kind: 'skipped' } },
      method: 'enter',
    }, request);
    expect((inProc as { method?: string }).method).toBe('enter');
  });

  it('keeps per-question preview and notes annotations', () => {
    const inProc = toAgentCoreResponse({
      answers: { q_0: { kind: 'single', option_id: 'opt_0_0' } },
      annotations: {
        'Which animal?': {
          preview: 'Cat profile preview',
          notes: 'Use the calmer option.',
        },
      },
    }, request);

    expect(inProc.annotations).toEqual({
      'Which animal?': {
        preview: 'Cat profile preview',
        notes: 'Use the calmer option.',
      },
    });
  });

  it('produces an empty answers record when ALL questions are skipped (partial-answer marker, NOT dismiss)', () => {
    const inProc = toAgentCoreResponse({
      answers: {
        q_0: { kind: 'skipped' },
        q_1: { kind: 'skipped' },
      },
    }, request);
    expect(inProc.answers).toEqual({});
    // Distinct from dismissedResult() which returns null.
    expect(inProc).not.toBeNull();
  });
});

describe('question-adapter · dismissedResult helper', () => {
  it('returns null (== SCHEMAS §6.3 dismiss path)', () => {
    expect(dismissedResult()).toBeNull();
  });
});
