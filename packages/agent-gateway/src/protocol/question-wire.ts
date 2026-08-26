import type {
  QuestionItem,
  QuestionOption,
  QuestionRequest,
} from '@pymodel/agent-core-v2';

import type {
  QuestionItem as ProtocolQuestionItem,
  QuestionOption as ProtocolQuestionOption,
  QuestionRequest as ProtocolQuestionRequest,
} from './question';

export interface WireQuestionSource {
  readonly id: string;
  readonly createdAt: number;
  readonly payload: unknown;
}

function buildOption(opt: QuestionOption, itemIdx: number, optIdx: number): ProtocolQuestionOption {
  return { id: `opt_${itemIdx}_${optIdx}`, label: opt.label, description: opt.description };
}

function buildItem(item: QuestionItem, itemIdx: number): ProtocolQuestionItem {
  return {
    id: `q_${itemIdx}`,
    question: item.question,
    options: item.options.map((option, optionIndex) => buildOption(option, itemIdx, optionIndex)),
    header: item.header,
    body: item.body,
    multi_select: item.multiSelect,
    allow_other: true,
    other_label: item.otherLabel,
    other_description: item.otherDescription,
  };
}

export function toWireQuestion(
  interaction: WireQuestionSource,
  sessionId: string,
): ProtocolQuestionRequest {
  const request = interaction.payload as QuestionRequest;
  const out: ProtocolQuestionRequest = {
    question_id: interaction.id,
    session_id: sessionId,
    questions: request.questions.map((question, index) => buildItem(question, index)),
    created_at: new Date(interaction.createdAt).toISOString(),
  };
  if (request.turnId !== undefined) out.turn_id = request.turnId;
  if (request.toolCallId !== undefined) out.tool_call_id = request.toolCallId;
  return out;
}
