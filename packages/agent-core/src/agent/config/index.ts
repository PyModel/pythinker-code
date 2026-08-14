import {
  createProvider,
  UNKNOWN_CAPABILITY,
  type ChatProvider,
  type ModelCapability,
  type ProviderConfig,
} from '@pymodel/kosong';

import { applyPythinkerEnvSamplingParams, applyPythinkerEnvThinkingKeep } from '#/config/pythinker-env-params';

import type { Agent } from '..';
import { ErrorCodes, PythinkerError } from '../../errors';
import type { AgentConfigData, AgentConfigUpdateData } from './types';
import { resolveThinkingEffort, type ThinkingEffort } from './thinking';
import type { ResolvedRuntimeProvider } from '../../session/provider-manager';

export * from './types';
export { resolveThinkingEffort, type ThinkingEffort } from './thinking';

export class ConfigState {
  private _cwd: string;
  private _modelAlias: string | undefined;
  private _profileName: string | undefined;
  private _thinkingLevel: ThinkingEffort = 'off';
  private _fastMode = false;
  private _systemPrompt: string = '';
  private _maxStepsPerTurn: number | undefined;

  constructor(protected readonly agent: Agent) {
    this._cwd = agent.kaos.getcwd();
    this._modelAlias = agent.modelProvider?.defaultModel;
  }

  update(changed: AgentConfigUpdateData): void {
    if (Object.keys(changed).length === 0) return;

    this.agent.records.logRecord({
      type: 'config.update',
      ...changed,
    });
    this.agent.replayBuilder.push({
      type: 'config_updated',
      config: changed,
    });
    if (changed.cwd) {
      this._cwd = changed.cwd;
      void this.agent.kaos.chdir(changed.cwd);
    }
    if (changed.modelAlias) {
      this._modelAlias = changed.modelAlias;
    }
    if (changed.profileName) {
      this._profileName = changed.profileName;
    }
    if (changed.thinkingLevel !== undefined) {
      this._thinkingLevel = resolveThinkingEffort(
        changed.thinkingLevel,
        this.agent.pythinkerConfig?.thinking,
      );
    }
    if (changed.fastMode !== undefined) {
      this._fastMode = changed.fastMode;
    }
    if (changed.systemPrompt !== undefined) {
      this._systemPrompt = changed.systemPrompt;
    }
    if ('maxStepsPerTurn' in changed) {
      this._maxStepsPerTurn = changed.maxStepsPerTurn;
    }
    if (this.hasProvider && (changed.cwd !== undefined || changed.modelAlias)) {
      this.agent.tools.initializeBuiltinTools();
    }
    this.agent.emitStatusUpdated();
  }

  data(): AgentConfigData {
    const resolved = this.tryResolvedProviderConfig();
    return {
      cwd: this.cwd,
      provider: resolved?.provider,
      modelAlias: this._modelAlias,
      modelCapabilities: resolved?.modelCapabilities ?? UNKNOWN_CAPABILITY,
      profileName: this.profileName,
      thinkingLevel: this.thinkingLevel,
      fastMode: this.fastMode,
      fastModeSupported: this.fastModeSupported,
      systemPrompt: this.systemPrompt,
      maxStepsPerTurn: this.maxStepsPerTurn,
    };
  }

  get cwd(): string {
    return this._cwd;
  }

  get hasModel(): boolean {
    return this._modelAlias !== undefined;
  }

  get hasProvider(): boolean {
    return this.tryResolvedProviderConfig() !== undefined;
  }

  get providerConfig(): ProviderConfig {
    const provider = this.resolvedProviderConfig?.provider;
    if (provider === undefined) {
      throw new PythinkerError(ErrorCodes.MODEL_NOT_CONFIGURED, 'Provider not set');
    }
    return provider;
  }

  get provider(): ChatProvider {
    // All provider-level request config is applied here so every request built
    // from config.provider — the main loop AND full-history compaction — carries it:
    //   - withThinking: preserve thinking during compaction (#464)
    //   - sampling params: PYTHINKER_MODEL_TEMPERATURE / PYTHINKER_MODEL_TOP_P
    //   - thinking.keep: PYTHINKER_MODEL_THINKING_KEEP (only while thinking is on)
    //   - fast mode: provider-native priority processing when supported
    const provider = createProvider(this.providerConfig).withThinking(this.thinkingLevel);
    const withEnvironment = applyPythinkerEnvThinkingKeep(
      applyPythinkerEnvSamplingParams(provider),
      this.thinkingLevel,
    );
    // Fast mode is a preference, not a hard requirement: when the current
    // provider cannot serve it, requests fall back to normal priority and
    // the preference re-applies once a supported model is active again.
    return this.fastMode && withEnvironment.withFastMode !== undefined
      ? withEnvironment.withFastMode(true)
      : withEnvironment;
  }

  get model(): string {
    if (this._modelAlias === undefined) {
      throw new PythinkerError(ErrorCodes.MODEL_NOT_CONFIGURED, 'Model not set');
    }
    return this._modelAlias;
  }

  get modelAlias(): string | undefined {
    return this._modelAlias;
  }

  get thinkingLevel(): ThinkingEffort {
    // Managed always-thinking models cannot run with thinking disabled.
    // Clamping in the getter (rather than in update()) keeps the request
    // builder, status events, and subagent inheritance consistent, and
    // re-applies after a later model switch onto an always-thinking alias.
    if (this._thinkingLevel === 'off' && this.alwaysThinkingModel) {
      return resolveThinkingEffort('on', this.agent.pythinkerConfig?.thinking);
    }
    return this._thinkingLevel;
  }

  private get alwaysThinkingModel(): boolean {
    const resolved = this.tryResolvedProviderConfig();
    return resolved?.provider.type === 'pythinker' && resolved.alwaysThinking === true;
  }

  get fastMode(): boolean {
    return this._fastMode;
  }

  get fastModeSupported(): boolean {
    // Support is a property of the *current* model's provider; switching
    // models may turn it on or off while the fastMode preference persists.
    const providerConfig = this.tryResolvedProviderConfig()?.provider;
    return providerConfig === undefined
      ? false
      : createProvider(providerConfig).supportsFastMode === true;
  }

  /** Whether this agent's provider can resolve `modelAlias` at all. */
  canResolveModel(modelAlias: string | undefined): boolean {
    return this.tryResolveProviderFor(modelAlias) !== undefined;
  }

  get profileName(): string | undefined {
    return this._profileName;
  }

  get systemPrompt(): string {
    return this._systemPrompt;
  }

  get maxStepsPerTurn(): number | undefined {
    return this._maxStepsPerTurn;
  }

  get modelCapabilities(): ModelCapability {
    return this.tryResolvedProviderConfig()?.modelCapabilities ?? UNKNOWN_CAPABILITY;
  }

  get maxOutputSize(): number | undefined {
    return this.tryResolvedProviderConfig()?.maxOutputSize;
  }

  private get resolvedProviderConfig(): ResolvedRuntimeProvider | undefined {
    if (this._modelAlias === undefined) return undefined;
    return this.agent.modelProvider?.resolveProviderConfig(this._modelAlias);
  }

  private tryResolvedProviderConfig(): ResolvedRuntimeProvider | undefined {
    return this.tryResolveProviderFor(this._modelAlias);
  }

  private tryResolveProviderFor(modelAlias: string | undefined): ResolvedRuntimeProvider | undefined {
    if (modelAlias === undefined) return undefined;
    try {
      return this.agent.modelProvider?.resolveProviderConfig(modelAlias);
    } catch {
      return undefined;
    }
  }
}
