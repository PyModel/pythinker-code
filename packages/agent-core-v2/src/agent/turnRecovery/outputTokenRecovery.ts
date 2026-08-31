import { createDecorator } from '#/_base/di/instantiation';

export interface IAgentOutputTokenRecoveryService {
  readonly _serviceBrand: undefined;
}

export const IAgentOutputTokenRecoveryService =
  createDecorator<IAgentOutputTokenRecoveryService>('agentOutputTokenRecoveryService');

export const MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS = 3;

export const OUTPUT_TOKEN_RECOVERY_NUDGE =
  'Output token limit hit. Resume directly - no apology, no recap of what you were doing. '
  + 'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.';
