/* oxlint-disable typescript-eslint/no-unsafe-declaration-merging, eslint-plugin-import/namespace -- Event2 class+payload-interface declaration merging is the sanctioned event-declaration idiom. */
import { createDecorator } from '#/_base/di/instantiation';
import { Event2 } from '#/app/event/event2';
import type { LoopErrorContext } from '#/agent/loop/loop';

export interface IAgentModelFallbackService {
  readonly _serviceBrand: undefined;

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
