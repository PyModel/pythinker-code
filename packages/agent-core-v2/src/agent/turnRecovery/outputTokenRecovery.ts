import { createDecorator } from '#/_base/di/instantiation';

/**
 * Recovers turns whose model response ended truncated at the output token
 * limit without tool calls, by injecting a resume nudge and continuing the
 * turn. Ported from the reference design's max_output_tokens recovery ladder.
 */
export interface IAgentOutputTokenRecoveryService {
  readonly _serviceBrand: undefined;
}

export const IAgentOutputTokenRecoveryService =
  createDecorator<IAgentOutputTokenRecoveryService>('agentOutputTokenRecoveryService');

/** Maximum resume-nudge continuations injected per turn for truncated output. */
export const MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS = 3;

/** Meta user message appended before each output-token recovery continuation. */
export const OUTPUT_TOKEN_RECOVERY_NUDGE =
  'Output token limit hit. Resume directly - no apology, no recap of what you were doing. '
  + 'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.';
