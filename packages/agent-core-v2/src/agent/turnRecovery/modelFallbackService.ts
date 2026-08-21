import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { defineState } from '#/state/state';
import { isRetryableGenerateError } from '#/kosong/contract/errors';
import { unwrapErrorCause } from '#/errors';
import type { LoopErrorContext } from '#/agent/loop/loop';
import { TurnStarted } from '#/agent/loop/turnEvents';
import { LOOP_CONTROL_SECTION, type LoopControl } from '#/agent/loop/configSection';
import { IConfigService } from '#/app/config/config';
import { IEventBus } from '#/app/event/eventBus';
import { IFlagService } from '#/app/flag/flag';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IEventDispatcher } from '#/state/eventDispatcher';
import { IAgentStateService } from '#/agent/state/agentState';
import { MODEL_FALLBACK_FLAG_ID } from './flag';
import { IAgentModelFallbackService, ModelFallbackSwitched } from './modelFallback';

export const modelFallbackUsedKey = defineState<boolean>(
  'turnRecovery.modelFallbackUsed',
  () => false,
);

export class AgentModelFallbackService extends Disposable implements IAgentModelFallbackService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IFlagService private readonly flags: IFlagService,
    @IConfigService private readonly config: IConfigService,
    @IAgentProfileService private readonly profile: IAgentProfileService,
    @IEventBus private readonly eventBus: IEventBus,
    @IEventDispatcher private readonly dispatcher: IEventDispatcher,
    @ITelemetryService private readonly telemetry: ITelemetryService,
    @IAgentStateService private readonly states: IAgentStateService,
  ) {
    super();
    this.states.contributeState(modelFallbackUsedKey);
    this._register(this.eventBus.subscribe(TurnStarted, () => this.reset()));
  }

  private get used(): boolean {
    return this.states.get(modelFallbackUsedKey);
  }

  private set used(value: boolean) {
    this.states.set(modelFallbackUsedKey, value);
  }

  private reset(): void {
    this.used = false;
  }

  private fallbackModel(): string | undefined {
    return this.config.get<LoopControl>(LOOP_CONTROL_SECTION)?.fallbackModel;
  }

  async tryFallbackSwitch(context: LoopErrorContext): Promise<boolean> {
    if (!this.flags.enabled(MODEL_FALLBACK_FLAG_ID)) return false;
    const target = this.fallbackModel();
    if (target === undefined || target.length === 0) return false;
    if (this.used || target === this.profile.getModel()) return false;
    if (!isRetryableGenerateError(unwrapErrorCause(context.error))) return false;

    const fromModel = this.profile.getModel();
    this.used = true;
    try {
      await this.profile.setModel(target);
    } catch {
      this.used = false;
      return false;
    }
    void this.dispatcher.dispatch(
      new ModelFallbackSwitched({
        turnId: context.turnId,
        step: context.step,
        fromModel,
        toModel: target,
      }),
    );
    this.telemetry.track2('model_fallback_triggered', {
      turn_id: context.turnId,
      from_model: fromModel,
      to_model: target,
    });
    return true;
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentModelFallbackService,
  AgentModelFallbackService,
  ScopeActivation.OnScopeCreated,
  'modelFallback',
);
