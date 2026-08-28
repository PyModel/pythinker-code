import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Error2, ErrorCodes } from '#/errors';
import { IConfigService } from '#/app/config/config';
import { IFlagService } from '#/app/flag/flag';
import { THINKING_SECTION } from '#/app/kosongConfig/configSection';
import { IModelCatalog } from '#/kosong/model/catalog';
import { declaredDefaultEffortForModel, type ThinkingConfig } from '#/kosong/model/thinking';

import { SECONDARY_MODEL_FLAG_ID } from './flag';
import {
  INHERIT_SUBAGENT_MODEL_POLICY,
  type LegacySecondaryModelConfig,
  LegacySecondaryModelConfigSchema,
  normalizeLegacySecondaryModel,
  normalizeLegacySecondaryModelOrInherit,
  parseCanonicalSubagentModelPolicy,
  routingEnvironmentRevision,
  SECONDARY_MODEL_SECTION,
  type SubagentFeatureState,
  type SubagentPolicyValidationContext,
  subagentPolicyResourceVersion,
  toPersistedSecondaryModel,
  validateSubagentModelPolicy,
} from './policy';
import {
  type EffectiveSubagentModelPolicy,
  ISubagentModelPolicyService,
  type PreparedSubagentPolicyMutation,
  type SubagentCallerBinding,
  type SubagentModelPolicySnapshot,
} from './subagentModelPolicy';

export class SubagentModelPolicyService implements ISubagentModelPolicyService {
  declare readonly _serviceBrand: undefined;

  private commitChain: Promise<unknown> = Promise.resolve();

  constructor(
    @IConfigService private readonly config: IConfigService,
    @IFlagService private readonly flags: IFlagService,
    @IModelCatalog private readonly modelCatalog: IModelCatalog,
  ) {}

  get(): SubagentModelPolicySnapshot {
    const persisted = this.persisted();
    return {
      policy: normalizeLegacySecondaryModelOrInherit(persisted),
      resourceVersion: subagentPolicyResourceVersion(persisted),
    };
  }

  getEffective(): EffectiveSubagentModelPolicy {
    const section = this.config.get<LegacySecondaryModelConfig | undefined>(SECONDARY_MODEL_SECTION);
    const configuredPolicy = normalizeLegacySecondaryModelOrInherit(section);
    const feature = this.feature();
    return {
      configuredPolicy,
      effectivePolicy: feature.enabled ? configuredPolicy : INHERIT_SUBAGENT_MODEL_POLICY,
      policySource:
        feature.enabled && section !== undefined && configuredPolicy.mode !== 'inherit'
          ? 'config'
          : 'default',
      feature,
    };
  }

  async set(input: unknown, expectedVersion?: string): Promise<SubagentModelPolicySnapshot> {
    const policy = parseCanonicalSubagentModelPolicy(input);
    validateSubagentModelPolicy(policy, this.liveContext());
    await this.commit(toPersistedSecondaryModel(policy), expectedVersion);
    return this.get();
  }

  async clear(expectedVersion?: string): Promise<SubagentModelPolicySnapshot> {
    await this.commit(undefined, expectedVersion);
    return this.get();
  }

  prepareLegacyMutation(
    input: unknown,
    context: SubagentPolicyValidationContext = this.liveContext(),
  ): PreparedSubagentPolicyMutation {
    if (input === null || input === undefined) {
      return { policy: INHERIT_SUBAGENT_MODEL_POLICY, section: undefined };
    }
    const parsed = LegacySecondaryModelConfigSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error2(
        ErrorCodes.CONFIG_INVALID,
        `Invalid [secondary_model] section: ${issue?.path.join('.') ?? ''} ${issue?.message ?? 'malformed'}`.trim(),
        { details: { section: SECONDARY_MODEL_SECTION } },
      );
    }
    const policy = normalizeLegacySecondaryModel(parsed.data);
    validateSubagentModelPolicy(policy, context);
    return { policy, section: toPersistedSecondaryModel(policy) };
  }

  resolveRevision(caller: SubagentCallerBinding): string {
    const effective = this.getEffective();
    const boundModel =
      effective.effectivePolicy.mode === 'inherit'
        ? caller.modelAlias
        : effective.effectivePolicy.defaultModel;
    return routingEnvironmentRevision({
      effectivePolicy: effective.effectivePolicy,
      policySource: effective.policySource,
      feature: effective.feature,
      callerModel: caller.modelAlias,
      callerThinking: caller.thinkingLevel,
      thinkingEnabled:
        this.config.get<ThinkingConfig | undefined>(THINKING_SECTION)?.enabled !== false,
      boundModelDefaultEffort: this.declaredDefaultEffort(boundModel),
    });
  }

  private persisted(): LegacySecondaryModelConfig | undefined {
    return this.config.inspect<LegacySecondaryModelConfig | undefined>(SECONDARY_MODEL_SECTION)
      .userValue;
  }

  private feature(): SubagentFeatureState {
    const state = this.flags.explain(SECONDARY_MODEL_FLAG_ID);
    return {
      enabled: state?.enabled ?? this.flags.enabled(SECONDARY_MODEL_FLAG_ID),
      source: state?.source ?? 'default',
    };
  }

  private liveContext(): SubagentPolicyValidationContext {
    return {
      resolveModel: (alias) => {
        const model = this.modelCatalog.get(alias);
        return {
          id: model.id,
          defaultEffort: model.defaultEffort,
          supportEfforts: model.supportEfforts,
        };
      },
    };
  }

  private declaredDefaultEffort(alias: string): string | undefined {
    try {
      return declaredDefaultEffortForModel(this.modelCatalog.get(alias));
    } catch {
      return undefined;
    }
  }

  private commit(
    section: LegacySecondaryModelConfig | undefined,
    expectedVersion: string | undefined,
  ): Promise<void> {
    const run = this.commitChain.then(
      () => this.commitNow(section, expectedVersion),
      () => this.commitNow(section, expectedVersion),
    );
    this.commitChain = run.catch(() => undefined);
    return run;
  }

  private async commitNow(
    section: LegacySecondaryModelConfig | undefined,
    expectedVersion: string | undefined,
  ): Promise<void> {
    await this.config.ready;
    if (expectedVersion !== undefined) {
      const currentVersion = subagentPolicyResourceVersion(this.persisted());
      if (currentVersion !== expectedVersion) {
        throw new Error2(
          ErrorCodes.CONFIG_VERSION_CONFLICT,
          'The subagent model policy changed since it was read; reload and retry.',
          { details: { section: SECONDARY_MODEL_SECTION, expectedVersion, currentVersion } },
        );
      }
    }
    await this.config.replace(SECONDARY_MODEL_SECTION, section);
  }
}

registerScopedService(
  LifecycleScope.App,
  ISubagentModelPolicyService,
  SubagentModelPolicyService,
  ScopeActivation.OnScopeCreated,
  'subagent',
);
