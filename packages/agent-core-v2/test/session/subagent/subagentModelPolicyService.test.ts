import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IConfigService } from '#/app/config/config';
import { type ExperimentalFeatureState, IFlagService } from '#/app/flag/flag';
import { THINKING_SECTION } from '#/app/kosongConfig/configSection';
import { ErrorCodes, Error2, isError2 } from '#/errors';
import { IModelCatalog, type Model } from '#/kosong/model/catalog';
import { SECONDARY_MODEL_FLAG_ID } from '#/session/subagent/flag';
import { SECONDARY_MODEL_SECTION } from '#/session/subagent/policy';
import { ISubagentModelPolicyService } from '#/session/subagent/subagentModelPolicy';
import { SubagentModelPolicyService } from '#/session/subagent/subagentModelPolicyService';

import { StubConfigService } from '../../kosong/stubs';
import { stubFlag } from '../../app/flag/stubs';

describe('SubagentModelPolicyService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let config: StubConfigService;
  let models: Map<string, Partial<Model>>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    models = new Map([
      ['acme/sol', { id: 'acme/sol', supportEfforts: ['low', 'high'], defaultEffort: 'high' }],
      ['acme/luna', { id: 'acme/luna', supportEfforts: ['low', 'high'] }],
    ]);
  });
  afterEach(() => disposables.dispose());

  function setup(
    sections: Record<string, unknown>,
    feature: { enabled: boolean; source?: ExperimentalFeatureState['source'] } = { enabled: true },
  ): ISubagentModelPolicyService {
    config = new StubConfigService(sections);
    ix.stub(IConfigService, config);
    const flags = stubFlag((id) => feature.enabled && id === SECONDARY_MODEL_FLAG_ID);
    ix.stub(IFlagService, {
      ...flags,
      explain: (id: string) =>
        id === SECONDARY_MODEL_FLAG_ID
          ? ({
              id,
              enabled: feature.enabled,
              source: feature.source ?? 'config',
              externallyControlled: feature.source === 'env',
              overridden: false,
              defaultEnabled: false,
              title: '',
              description: '',
              surface: 'core',
              env: '',
            } as ExperimentalFeatureState)
          : undefined,
    });
    ix.stub(IModelCatalog, {
      _serviceBrand: undefined,
      get: (id: string) => {
        const model = models.get(id);
        if (model === undefined) {
          throw new Error2(ErrorCodes.CONFIG_INVALID, `Model "${id}" is not configured in config.toml.`, {
            details: { model: id },
          });
        }
        return model as Model;
      },
    } as unknown as IModelCatalog);
    ix.set(ISubagentModelPolicyService, new SyncDescriptor(SubagentModelPolicyService));
    return ix.get(ISubagentModelPolicyService);
  }

  async function codeOf(fn: () => Promise<unknown> | unknown): Promise<string | undefined> {
    try {
      await fn();
      return undefined;
    } catch (error) {
      return isError2(error) ? error.code : 'not-error2';
    }
  }

  it('reads the persisted policy with a resource version and reports inherit for an absent section', () => {
    const service = setup({});
    const snapshot = service.get();
    expect(snapshot.policy).toEqual({ mode: 'inherit' });
    expect(snapshot.resourceVersion).toMatch(/^subagent-policy-v1:/);
  });

  it('set validates against the live catalog and persists the canonical section', async () => {
    const service = setup({});
    await expect(
      service.set({ mode: 'default', defaultModel: 'acme/nope' }),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFIG_INVALID });
    expect(config.get(SECONDARY_MODEL_SECTION)).toBeUndefined();

    const snapshot = await service.set({ mode: 'force', defaultModel: 'acme/sol', defaultEffort: 'low' });
    expect(snapshot.policy).toEqual({ mode: 'force', defaultModel: 'acme/sol', defaultEffort: 'low' });
    expect(config.get(SECONDARY_MODEL_SECTION)).toEqual({
      defaultModel: 'acme/sol',
      force: true,
      defaultEffort: 'low',
    });

    await service.set({ mode: 'default', defaultModel: 'acme/luna' });
    expect(config.get(SECONDARY_MODEL_SECTION)).toEqual({
      defaultModel: 'acme/luna',
      defaultEffort: undefined,
    });
  });

  it('clear removes the section and expectedVersion guards both set and clear', async () => {
    const service = setup({ [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/sol' } });
    const before = service.get().resourceVersion;
    expect(await codeOf(() => service.set({ mode: 'inherit' }, 'subagent-policy-v1:stale'))).toBe(
      ErrorCodes.CONFIG_VERSION_CONFLICT,
    );
    expect(config.get(SECONDARY_MODEL_SECTION)).toEqual({ defaultModel: 'acme/sol' });
    const cleared = await service.clear(before);
    expect(cleared.policy).toEqual({ mode: 'inherit' });
    expect(config.get(SECONDARY_MODEL_SECTION)).toBeUndefined();
    expect(cleared.resourceVersion).not.toBe(before);
    expect(await codeOf(() => service.clear(before))).toBe(ErrorCodes.CONFIG_VERSION_CONFLICT);
  });

  it('serializes concurrent commits so a stale expectedVersion cannot slip past the version check', async () => {
    const service = setup({ [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/sol' } });
    const replace = config.replace.bind(config);
    config.replace = async (domain, value) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await replace(domain, value);
    };
    const version = service.get().resourceVersion;
    const [first, second] = await Promise.allSettled([
      service.set({ mode: 'default', defaultModel: 'acme/luna' }, version),
      service.set({ mode: 'force', defaultModel: 'acme/sol' }, version),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason).toMatchObject({
      code: ErrorCodes.CONFIG_VERSION_CONFLICT,
    });
    expect(config.get(SECONDARY_MODEL_SECTION)).toEqual({ defaultModel: 'acme/luna', defaultEffort: undefined });
  });

  it('getEffective reports inherit while the feature is disabled and keeps the configured policy', () => {
    const service = setup(
      { [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/sol', force: true } },
      { enabled: false, source: 'default' },
    );
    const effective = service.getEffective();
    expect(effective.configuredPolicy).toEqual({ mode: 'force', defaultModel: 'acme/sol' });
    expect(effective.effectivePolicy).toEqual({ mode: 'inherit' });
    expect(effective.policySource).toBe('default');
    expect(effective.feature).toEqual({ enabled: false, source: 'default' });
  });

  it('prepareLegacyMutation validates against the supplied prospective context, not the live catalog', () => {
    const service = setup({});
    const prospective = {
      resolveModel: (alias: string) => (alias === 'acme/future' ? { id: alias } : undefined),
    };
    const prepared = service.prepareLegacyMutation(
      { defaultModel: 'acme/future', models: { 'acme/future': 'soon' } },
      prospective,
    );
    expect(prepared.policy).toEqual({
      mode: 'pool',
      defaultModel: 'acme/future',
      models: { 'acme/future': 'soon' },
      defaultEffort: undefined,
    });
    expect(prepared.section).toEqual({
      defaultModel: 'acme/future',
      models: { 'acme/future': 'soon' },
      defaultEffort: undefined,
    });
    expect(config.get(SECONDARY_MODEL_SECTION)).toBeUndefined();
    expect(() => service.prepareLegacyMutation({ defaultModel: 'acme/sol' }, prospective)).toThrow();
    expect(() => service.prepareLegacyMutation({ defaultModel: 'acme/sol' })).not.toThrow();
    expect(service.prepareLegacyMutation(null)).toEqual({ policy: { mode: 'inherit' }, section: undefined });
    expect(() => service.prepareLegacyMutation({ defaultModel: 42 })).toThrow();
  });

  it('resolveRevision changes only with ambient routing inputs', async () => {
    const service = setup({ [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/luna' } });
    const caller = { modelAlias: 'acme/sol', thinkingLevel: 'high' };
    const a = service.resolveRevision(caller);
    expect(a).toMatch(/^route-env:v1:/);
    expect(service.resolveRevision({ ...caller })).toBe(a);
    expect(service.resolveRevision({ modelAlias: 'acme/luna', thinkingLevel: 'high' })).not.toBe(a);
    await config.replace(THINKING_SECTION, { enabled: false });
    expect(service.resolveRevision(caller)).not.toBe(a);
  });

  it('resolveRevision ignores a configured policy while the feature is disabled', async () => {
    const service = setup({}, { enabled: false, source: 'default' });
    const caller = { modelAlias: 'acme/sol', thinkingLevel: 'high' };
    const before = service.resolveRevision(caller);
    const versionBefore = service.get().resourceVersion;
    await config.replace(SECONDARY_MODEL_SECTION, { defaultModel: 'acme/luna', force: true });
    expect(service.resolveRevision(caller)).toBe(before);
    expect(service.get().resourceVersion).not.toBe(versionBefore);
  });
});
