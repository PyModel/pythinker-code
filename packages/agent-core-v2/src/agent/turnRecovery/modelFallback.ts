/* oxlint-disable typescript-eslint/no-unsafe-declaration-merging, eslint-plugin-import/namespace -- Event2 class+payload-interface declaration merging is the sanctioned event-declaration idiom. */
import { createDecorator } from '#/_base/di/instantiation';
import { Event2 } from '#/app/event/event2';
import type { LoopErrorContext } from '#/agent/loop/loop';

/**
 * Switches the agent to the configured fallback model when step retries are
 * exhausted on persistent retryable provider errors, so the retrying layer can
 * resend the failed step on the fallback.
 */
export interface IAgentModelFallbackService {
  readonly _serviceBrand: undefined;

  /**
   * Switches the agent profile to `loopControl.fallback_model` when allowed
   * (flag on, model configured and different from the current one, not yet
   * used this turn). Returns true when the switch happened and the caller
   * should retry the failed driver.
   */
  tryFallbackSwitch(context: LoopErrorContext): Promise<boolean>;
}

export const IAgentModelFallbackService =
  createDecorator<IAgentModelFallbackService>('agentModelFallbackService');

export interface ModelFallbackSwitchedPayload {
  readonly turnId: number;
  readonly step?: number;
  readonly fromModel: string;
  readonly toModel: string;
}

export class ModelFallbackSwitched extends Event2<ModelFallbackSwitchedPayload> {
  static override readonly type = 'turn.model_fallback.switched';
  static override readonly observable = true;
}
export interface ModelFallbackSwitched extends ModelFallbackSwitchedPayload {}
