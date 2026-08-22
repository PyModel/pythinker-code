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
import { LOOP_CONTROL_SECTION, type LoopControl } from '#/agent/loop/configSection';
import { IConfigService } from '#/app/config/config';
import { IEventBus } from '#/app/event/eventBus';
import { IFlagService } from '#/app/flag/flag';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IAgentStateService } from '#/agent/state/agentState';
import { TURN_BUDGET_CONTINUATION_FLAG_ID } from './flag';
import {
  IAgentTurnBudgetService,
  TURN_BUDGET_COMPLETION_THRESHOLD,
  TURN_BUDGET_DIMINISHING_MIN_DELTA_TOKENS,
  TURN_BUDGET_MAX_DIMINISHING_CONTINUATIONS,
  turnBudgetNudgeText,
} from './turnBudget';

export const turnBudgetTokensUsedKey = defineState<number>('turnBudget.tokensUsed', () => 0);
export const turnBudgetContinuationsKey = defineState<number>('turnBudget.continuations', () => 0);
export const turnBudgetLastDeltaTokensKey = defineState<number>(
  'turnBudget.lastDeltaTokens',
  () => 0,
);

class TurnBudgetContinuationRequest extends StepRequest {
  readonly kind = 'turn-budget-continuation';

  constructor(private readonly message: ContextMessage) {
    super();
  }

  override resolveContextMessages(): readonly ContextMessage[] {
    return [this.message];
  }
}

export class AgentTurnBudgetService extends Disposable implements IAgentTurnBudgetService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IAgentLoopService private readonly loopService: IAgentLoopService,
    @IFlagService private readonly flags: IFlagService,
    @IConfigService private readonly config: IConfigService,
    @IEventBus private readonly eventBus: IEventBus,
    @ITelemetryService private readonly telemetry: ITelemetryService,
    @IAgentStateService private readonly states: IAgentStateService,
  ) {
    super();
    this.states.contributeState(turnBudgetTokensUsedKey);
    this.states.contributeState(turnBudgetContinuationsKey);
    this.states.contributeState(turnBudgetLastDeltaTokensKey);
    this._register(this.eventBus.subscribe(TurnStarted, () => this.reset()));
    this._register(
      this.loopService.hooks.onDidFinishStep.register('turn-budget', async (context, next) => {
        await next();
        this.maybeContinue(context);
      }),
    );
  }

  private get tokensUsed(): number {
    return this.states.get(turnBudgetTokensUsedKey);
  }

  private set tokensUsed(value: number) {
    this.states.set(turnBudgetTokensUsedKey, value);
  }

  private get continuations(): number {
    return this.states.get(turnBudgetContinuationsKey);
  }

  private set continuations(value: number) {
    this.states.set(turnBudgetContinuationsKey, value);
  }

  private get lastDeltaTokens(): number {
    return this.states.get(turnBudgetLastDeltaTokensKey);
  }

  private set lastDeltaTokens(value: number) {
    this.states.set(turnBudgetLastDeltaTokensKey, value);
  }

  private reset(): void {
    this.tokensUsed = 0;
    this.continuations = 0;
    this.lastDeltaTokens = 0;
  }

  private budgetTokens(): number {
    return this.config.get<LoopControl>(LOOP_CONTROL_SECTION)?.turnBudgetTokens ?? 0;
  }

  private maybeContinue(context: AfterStepContext): void {
    if (!this.flags.enabled(TURN_BUDGET_CONTINUATION_FLAG_ID)) return;
    if (context.stopTurn || context.signal.aborted) return;
    const budget = this.budgetTokens();
    if (budget <= 0) return;

    const delta = context.usage.output;
    const used = this.tokensUsed + delta;
    const previousDelta = this.lastDeltaTokens;
    this.lastDeltaTokens = delta;
    this.tokensUsed = used;

    if (context.finishReason === 'tool_calls') return;
    if (context.finishReason !== 'completed') return;
    if (this.loopService.status().hasPendingRequests) return;

    const diminishing =
      this.continuations >= TURN_BUDGET_MAX_DIMINISHING_CONTINUATIONS &&
      delta < TURN_BUDGET_DIMINISHING_MIN_DELTA_TOKENS &&
      previousDelta < TURN_BUDGET_DIMINISHING_MIN_DELTA_TOKENS;
    if (diminishing) return;
    if (used >= budget * TURN_BUDGET_COMPLETION_THRESHOLD) return;

    const pct = Math.round((used / budget) * 100);
    this.continuations += 1;
    this.telemetry.track2('budget_continuation', {
      turn_id: context.turnId,
      continuation_count: this.continuations,
      tokens_used: used,
      budget_tokens: budget,
    });
    const message: ContextMessage = {
      ...createUserMessage(turnBudgetNudgeText(pct, used, budget)),
      origin: { kind: 'retry', trigger: 'token_budget' },
    };
    this.loopService.enqueue(new TurnBudgetContinuationRequest(message));
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentTurnBudgetService,
  AgentTurnBudgetService,
  ScopeActivation.OnScopeCreated,
  'turnBudget',
);
