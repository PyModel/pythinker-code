import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { defineState } from '#/state/state';
import { createUserMessage } from '#/kosong/contract/message';
import type { ContextMessage } from '#/agent/contextMemory/types';
import type { AfterStepContext } from '#/agent/loop/loop';
import { IAgentLoopService } from '#/agent/loop/loop';
import { TurnStarted } from '#/agent/loop/turnEvents';
import { StepRequest } from '#/agent/loop/stepRequest';
import { IEventBus } from '#/app/event/eventBus';
import { IFlagService } from '#/app/flag/flag';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IAgentStateService } from '#/agent/state/agentState';
import { OUTPUT_TOKEN_RECOVERY_FLAG_ID } from './flag';
import {
  IAgentOutputTokenRecoveryService,
  MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS,
  OUTPUT_TOKEN_RECOVERY_NUDGE,
} from './outputTokenRecovery';

export const outputTokenRecoveryAttemptsKey = defineState<number>(
  'turnRecovery.outputTokenAttempts',
  () => 0,
);

class OutputTokenRecoveryRequest extends StepRequest {
  readonly kind = 'output-token-recovery';

  constructor(private readonly message: ContextMessage) {
    super();
  }

  override resolveContextMessages(): readonly ContextMessage[] {
    return [this.message];
  }
}

export class AgentOutputTokenRecoveryService extends Disposable implements IAgentOutputTokenRecoveryService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IAgentLoopService private readonly loopService: IAgentLoopService,
    @IFlagService private readonly flags: IFlagService,
    @IEventBus private readonly eventBus: IEventBus,
    @ITelemetryService private readonly telemetry: ITelemetryService,
    @IAgentStateService private readonly states: IAgentStateService,
  ) {
    super();
    this.states.contributeState(outputTokenRecoveryAttemptsKey);
    this._register(this.eventBus.subscribe(TurnStarted, () => this.reset()));
    this._register(
      this.loopService.hooks.onDidFinishStep.register('output-token-recovery', async (context, next) => {
        await next();
        this.maybeContinue(context);
      }),
    );
  }

  private get attempts(): number {
    return this.states.get(outputTokenRecoveryAttemptsKey);
  }

  private set attempts(value: number) {
    this.states.set(outputTokenRecoveryAttemptsKey, value);
  }

  private reset(): void {
    this.attempts = 0;
  }

  private maybeContinue(context: AfterStepContext): void {
    if (!this.flags.enabled(OUTPUT_TOKEN_RECOVERY_FLAG_ID)) return;
    if (context.stopTurn || context.signal.aborted) return;
    if (context.finishReason !== 'truncated') return;
    if (this.loopService.status().hasPendingRequests) return;
    const attempt = this.attempts + 1;
    if (attempt > MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS) return;
    this.attempts = attempt;
    this.telemetry.track2('output_token_recovery', {
      turn_id: context.turnId,
      attempt,
      max_attempts: MAX_OUTPUT_TOKEN_RECOVERY_ATTEMPTS,
    });
    const message: ContextMessage = {
      ...createUserMessage(OUTPUT_TOKEN_RECOVERY_NUDGE),
      origin: { kind: 'retry', trigger: 'max_output_tokens' },
    };
    this.loopService.enqueue(new OutputTokenRecoveryRequest(message));
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentOutputTokenRecoveryService,
  AgentOutputTokenRecoveryService,
  ScopeActivation.OnScopeCreated,
  'outputTokenRecovery',
);
