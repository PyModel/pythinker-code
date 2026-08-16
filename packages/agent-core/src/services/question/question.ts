/**
 * Question service interface + protocol adapter.
 *
 * **Service interface** (`IQuestionService`): Reverse-RPC one-shot broker
 * role — routes `QuestionRequest`s coming out of `PythinkerCore` to a waiter
 * and resolves the promise when the response arrives or the user dismisses it.
 *
 * Role: one-shot broker — see `packages/services/AGENTS.md`. Kept under the
 * `Service` suffix per the package-wide convention; the broker semantics
 * lives in the interface shape (`request` + `resolve` + `dismiss`) and the
 * docstring, not in the type name.
 *
 * **Shape note:** the service returns the in-process
 * `QuestionResult = null | QuestionAnswers | QuestionResponse`. The
 * protocol↔in-process adapter lives at the daemon boundary, not inside the
 * service interface.
 *
 * **Adapter** (`toBrokerRequest` / `toAgentCoreResponse` / `dismissedResult`):
 * Bridges two representations of the same question interaction. Protocol ids
 * go in; question text and option labels that the user saw come out. This is
 * the only protocol↔SDK translation site for questions:
 *
 *   1. **In-process SDK shape** (agent-core, camelCase) — what
 *      `BridgeClientAPI` sees from `PythinkerCore.requestQuestion(...)`:
 *        `QuestionRequest { turnId?, toolCallId?, questions: QuestionItem[] }`
 *      where `QuestionItem` has `question, header?, body?, options[],
 *      multiSelect?, allowOther?, otherLabel?, otherDescription?`.
 *      `QuestionResult = null | QuestionAnswers | QuestionResponse`,
 *      `QuestionAnswers = Record<string, string | true>`.
 *
 *   2. **Protocol wire shape** (snake_case, with daemon-allocated metadata).
 *
 * **Synthesizing stable ids** (SDK has no per-item / per-option `id`):
 *   - `QuestionItem.id`     ← `q_<index>` (e.g. `q_0`, `q_1`, ...)
 *   - `QuestionOption.id`   ← `opt_<parent_idx>_<option_idx>` (e.g. `opt_0_0`)
 *
 */

import { createDecorator } from '../../di';
import type { QuestionAnswers as InProcessQuestionAnswers, QuestionItem as InProcessQuestionItem, QuestionRequest as InProcessQuestionRequest, QuestionRequest, QuestionResponse as InProcessQuestionResponse, QuestionResult } from '../../rpc';
import type {
  QuestionItem as ProtocolQuestionItem,
  QuestionOption as ProtocolQuestionOption,
  QuestionRequest as ProtocolQuestionRequest,
  QuestionResponse as ProtocolQuestionResponse,
} from '@pymodel/protocol';
 // type-only marker — keep protocol dep referenced

// Re-export for service-side consumers.
export type { QuestionRequest, QuestionResult };

export interface IQuestionService {
  readonly _serviceBrand: undefined;

  /**
   * Called by the adapter when PythinkerCore needs the user to answer a question.
   * Resolves with the in-process `QuestionResult` (null = no handler / fully
   * dismissed). Concrete impls own timeout policy.
   */
  request(req: InProcessQuestionRequest & { sessionId: string; agentId: string }): Promise<QuestionResult>;

  /**
   * Called by the answer-side (REST handler / TUI / mock) to settle a pending
   * `request()` with user answers. `id` matches `QuestionRequest`'s correlation
   * id (`turnId`+`toolCallId` today; SCHEMAS.md §6.2's `question_id` once the
   * protocol exposes it).
   */
  resolve(id: string, response: QuestionResult): void;

  /**
   * Called when the user dismisses the panel without answering (ESC / close).
   * Concrete impls resolve the pending `request()` with the equivalent of
   * `dismissedQuestionResult()` (`packages/agent-core` — see SCHEMAS.md §6.3).
   */
  dismiss(id: string): void;

  /**
   * Returns the protocol-shaped pending question requests for a session.
   * Used by the session status lifecycle to detect `awaiting_question`.
   */
  listPending(sessionId: string): readonly ProtocolQuestionRequest[];
}

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const IQuestionService = createDecorator<IQuestionService>('questionService');

// ---------------------------------------------------------------------------
// Adapter helpers (moved from adapter/question-adapter.ts)
// ---------------------------------------------------------------------------

export interface QuestionToBrokerRequestParams {
  /** Daemon-minted ULID identifying this question interaction. */
  readonly questionId: string;
  /** Session the question lives in. */
  readonly sessionId: string;
  /** `createdAt` ISO string; broker passes `new Date().toISOString()`. */
  readonly createdAt: string;
  /** `expiresAt` ISO string; broker computes the lease deadline. */
  readonly expiresAt: string;
}

/**
 * Build a protocol option from an SDK option. SDK has only `label?:string` +
 * `description?:string`; we synthesize `id` from parent and child indices so
 * the response adapter can map answers back to the question text and labels.
 */
function buildOption(
  opt: {
    readonly label: string;
    readonly description?: string;
    readonly preview?: string;
    readonly url?: string;
  },
  parentIdx: number,
  optIdx: number,
): ProtocolQuestionOption {
  return {
    id: `opt_${parentIdx}_${optIdx}`,
    label: opt.label,
    description: opt.description,
    preview: opt.preview,
    url: opt.url,
  };
}

/**
 * Build a protocol question item from an SDK item + its position. The
 * synthesized `id` (`q_<parentIdx>`) identifies the matching response item.
 */
function buildItem(
  item: InProcessQuestionItem,
  parentIdx: number,
): ProtocolQuestionItem {
  const id = `q_${parentIdx}`;
  const out: ProtocolQuestionItem = {
    id,
    question: item.question,
    options: item.options.map((o, oi) => buildOption(o, parentIdx, oi)),
  };
  if (item.header !== undefined) out.header = item.header;
  if (item.body !== undefined) out.body = item.body;
  if (item.multiSelect !== undefined) out.multi_select = item.multiSelect;
  const hasOtherAffordance =
    item.otherLabel !== undefined || item.otherDescription !== undefined;
  if (item.allowOther !== undefined) out.allow_other = item.allowOther;
  else if (hasOtherAffordance) out.allow_other = true;
  if (item.otherLabel !== undefined) out.other_label = item.otherLabel;
  if (item.otherDescription !== undefined) out.other_description = item.otherDescription;
  return out;
}

/**
 * In-process SDK request + daemon-allocated metadata → protocol wire shape.
 */
export function toBrokerRequest(
  req: InProcessQuestionRequest,
  params: QuestionToBrokerRequestParams,
): ProtocolQuestionRequest {
  const out: ProtocolQuestionRequest = {
    question_id: params.questionId,
    session_id: params.sessionId,
    questions: req.questions.map((q, i) => buildItem(q, i)),
    created_at: params.createdAt,
    expires_at: params.expiresAt,
  };
  if (req.turnId !== undefined) out.turn_id = req.turnId;
  if (req.toolCallId !== undefined) out.tool_call_id = req.toolCallId;
  return out;
}

/**
 * Protocol response ids + the original request → in-process SDK
 * `QuestionResponse` with answers flattened to `Record<string, string | true>`.
 *
 * The original request is the lookup for the text and labels displayed to the
 * user:
 *   - single            → option label
 *   - multi             → option labels joined with `, `
 *   - other             → text
 *   - multi_with_other  → option labels and text joined with `, `
 *   - skipped           → OMIT entry
 */
export function toAgentCoreResponse(
  resp: ProtocolQuestionResponse,
  request: ProtocolQuestionRequest,
): InProcessQuestionResponse {
  const flattened: InProcessQuestionAnswers = {};
  for (const [qid, ans] of Object.entries(resp.answers)) {
    const item = request.questions.find((question) => question.id === qid);
    const question = item?.question ?? qid;
    const optionLabel = (id: string): string =>
      item?.options.find((option) => option.id === id)?.label ?? id;
    switch (ans.kind) {
      case 'single':
        flattened[question] = optionLabel(ans.option_id);
        break;
      case 'multi':
        flattened[question] = ans.option_ids.map(optionLabel).join(', ');
        break;
      case 'other':
        flattened[question] = ans.text;
        break;
      case 'multi_with_other':
        flattened[question] = [...ans.option_ids.map(optionLabel), ans.other_text].join(', ');
        break;
      case 'skipped':
        // Omitted from the record.
        break;
      default: {
        // Defensive: never-reached if Zod schema is the SOT, but TS narrowing
        // is exhaustive so this is unreachable.
        const _exhaustive: never = ans;
        void _exhaustive;
      }
    }
  }
  const out: InProcessQuestionResponse = { answers: flattened };
  if (resp.method !== undefined) {
    // Protocol allows 'click' as a method; agent-core's in-process
    // `QuestionAnswerMethod` is `'enter' | 'space' | 'number_key'` (NO 'click').
    // Drop 'click' on the in-process side to preserve type safety; the wire
    // form keeps it for clients that want to surface the affordance used.
    if (resp.method !== 'click') {
      (out as { method?: typeof resp.method }).method = resp.method;
    }
  }
  if (resp.annotations !== undefined) {
    (out as { annotations?: typeof resp.annotations }).annotations = resp.annotations;
  }
  return out;
}

/**
 * Convenience: SDK semantics for "dismiss the entire question group" is the
 * `null` QuestionResult. Exposed as a helper so daemon code reads
 * intentionally rather than litter `null` constants.
 */
export function dismissedResult(): null {
  return null;
}
