import type { QuestionRequest } from '@pythoughts/pythinker-code-sdk';
import { describe, expect, it, vi } from 'vitest';

import { QuestionController } from '#/tui/reverse-rpc/question/controller';
import { createQuestionAskHandler } from '#/tui/reverse-rpc/question/handler';

function questionEvent(overrides: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    toolCallId: 'q-1',
    questions: [
      {
        question: 'Q1?',
        options: [{ label: 'Alpha' }],
      },
    ],
    ...overrides,
  };
}

describe('question reverse-rpc', () => {
  it('QuestionController cancels pending requests with an empty answer list', async () => {
    const controller = new QuestionController();
    const pending = controller.show({
      id: 'req-1',
      tool_call_id: 'tc-1',
      questions: [],
    });

    controller.cancelAll('closed');

    await expect(pending).resolves.toEqual({ answers: [] });
  });

  it('normalizes question payloads and returns the selected answer', async () => {
    const controller = new QuestionController();
    const show = vi
      .spyOn(controller, 'show')
      .mockResolvedValue({
        answers: ['Alpha'],
        method: 'number_key',
        annotations: {
          'Q1?': { preview: 'Alpha preview', notes: 'Use the first option.' },
        },
      });
    const handler = createQuestionAskHandler(controller);
    const event = questionEvent({
      questions: [
        {
          question: 'Q1?',
          header: 'Pick',
          body: 'Choose one',
          multiSelect: true,
          allowOther: false,
          otherLabel: 'Other',
          otherDescription: 'Type a custom answer',
          options: [
            {
              label: 'Alpha',
              description: 'First option',
              preview: 'Alpha preview',
            },
          ],
        },
      ],
    });

    await expect(handler(event)).resolves.toEqual({
      answers: { 'Q1?': 'Alpha' },
      method: 'number_key',
      annotations: {
        'Q1?': { preview: 'Alpha preview', notes: 'Use the first option.' },
      },
    });
    expect(show).toHaveBeenCalledWith({
      id: 'q-1',
      tool_call_id: 'q-1',
      questions: [
        {
          question: 'Q1?',
          header: 'Pick',
          body: 'Choose one',
          multi_select: true,
          allow_other: false,
          other_label: 'Other',
          other_description: 'Type a custom answer',
          options: [
            {
              label: 'Alpha',
              description: 'First option',
              preview: 'Alpha preview',
            },
          ],
        },
      ],
    });

    show.mockResolvedValueOnce({ answers: [''] });
    await expect(handler(questionEvent())).resolves.toBeNull();

    show.mockRejectedValueOnce(new Error('boom'));
    await expect(handler(questionEvent())).resolves.toBeNull();
  });

  it('maps multiple question answers by question text', async () => {
    const controller = new QuestionController();
    const show = vi
      .spyOn(controller, 'show')
      .mockResolvedValue({ answers: ['Alpha', 'SQLite'], method: 'enter' });
    const handler = createQuestionAskHandler(controller);
    const event = questionEvent({
      toolCallId: 'call_question',
      questions: [
        {
          question: 'Q1?',
          options: [{ label: 'Alpha' }],
        },
        {
          question: 'Storage?',
          header: 'Store',
          options: [{ label: 'SQLite' }],
        },
      ],
    });

    await expect(handler(event)).resolves.toEqual({
      answers: {
        'Q1?': 'Alpha',
        'Storage?': 'SQLite',
      },
      method: 'enter',
    });
    expect(show).toHaveBeenCalledWith({
      id: 'call_question',
      tool_call_id: 'call_question',
      questions: [
        {
          question: 'Q1?',
          header: undefined,
          body: undefined,
          multi_select: false,
          other_label: undefined,
          other_description: undefined,
          options: [{ label: 'Alpha', description: undefined }],
        },
        {
          question: 'Storage?',
          header: 'Store',
          body: undefined,
          multi_select: false,
          other_label: undefined,
          other_description: undefined,
          options: [{ label: 'SQLite', description: undefined }],
        },
      ],
    });
  });

  it('preserves and opens the URL attached to a selected question option', async () => {
    const controller = new QuestionController();
    const show = vi
      .spyOn(controller, 'show')
      .mockResolvedValue({ answers: ['Open URL'], method: 'enter' });
    const openUrl = vi.fn();
    const handler = createQuestionAskHandler(controller, openUrl);
    const event = questionEvent({
      questions: [
        {
          question: 'Open account?',
          options: [
            {
              label: 'Open URL',
              description: 'example.test',
              url: 'https://example.test/account',
            },
            { label: 'Decline' },
          ],
        },
      ],
    });

    await expect(handler(event)).resolves.toMatchObject({
      answers: { 'Open account?': 'Open URL' },
    });
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            options: [
              expect.objectContaining({
                label: 'Open URL',
                url: 'https://example.test/account',
              }),
              expect.objectContaining({ label: 'Decline' }),
            ],
          }),
        ],
      }),
    );
    expect(openUrl).toHaveBeenCalledWith('https://example.test/account');
  });
});
