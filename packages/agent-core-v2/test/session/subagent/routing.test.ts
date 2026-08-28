import { ITelemetryService } from '#/app/telemetry/telemetry';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import { TestInstantiationService } from '#/_base/di/test';
import { Event } from '#/_base/event';
import { LifecycleScope } from '#/app/scopes';
import { IConfigService } from '#/app/config/config';
import { IFlagService, type ExperimentalFeatureState } from '#/app/flag/flag';
import { normalizeAgentProfile } from '#/app/agentProfileCatalog/agentProfileCatalog';
import { IAgentProfileService, type ProfileData } from '#/agent/profile/profile';
import { ErrorCodes, Error2, isError2 } from '#/errors';
import { IModelCatalog, type Model } from '#/kosong/model/catalog';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ISessionAgentProfileCatalog } from '#/session/sessionAgentProfileCatalog/sessionAgentProfileCatalog';
import {
  AgentBindingProvenanceService,
  IAgentBindingProvenanceService,
  SubagentBindingProvenanceRecorded,
  subagentBindingProvenanceKey,
} from '#/session/subagent/bindingProvenance';
import type { Event2, Event2Class } from '#/app/event/event2';
import type { FoldContext } from '#/state/state';
import { SECONDARY_MODEL_FLAG_ID } from '#/session/subagent/flag';
import { type CanonicalSubagentModelPolicy, SECONDARY_MODEL_SECTION } from '#/session/subagent/policy';
import {
  resolveSubagentModelRoute,
  resumedBindingProvenance,
  type SubagentBindingProvenance,
} from '#/session/subagent/routing';
import { ISubagentModelPolicyService } from '#/session/subagent/subagentModelPolicy';
import { SubagentModelPolicyService } from '#/session/subagent/subagentModelPolicyService';
import {
  ISubagentRoutingService,
  SessionSubagentRoutingService,
} from '#/session/subagent/subagentRoutingService';

import { StubConfigService } from '../../kosong/stubs';
import { stubFlag } from '../../app/flag/stubs';

const OWN = { modelAlias: 'acme/sol', thinkingLevel: 'high' };
const POOL: CanonicalSubagentModelPolicy = {
  mode: 'pool',
  defaultModel: 'acme/luna',
  models: { 'acme/luna': 'fast', 'acme/sol': 'main' },
  defaultEffort: 'low',
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return isError2(error) ? error.code : 'not-error2';
  }
}

describe('resolveSubagentModelRoute', () => {
  it('inherit binds the caller and rejects an explicit non-primary model', () => {
    expect(resolveSubagentModelRoute({ policy: { mode: 'inherit' }, own: OWN })).toEqual({
      model: 'acme/sol',
      thinking: 'high',
      source: 'caller',
    });
    expect(
      resolveSubagentModelRoute({ policy: { mode: 'inherit' }, own: OWN, requested: 'primary' }),
    ).toMatchObject({ model: 'acme/sol', source: 'caller' });
    expect(
      codeOf(() =>
        resolveSubagentModelRoute({ policy: { mode: 'inherit' }, own: OWN, requested: 'acme/luna' }),
      ),
    ).toBe(ErrorCodes.CONFIG_INVALID);
  });

  it('default binds the policy model and still honors primary', () => {
    const policy: CanonicalSubagentModelPolicy = { mode: 'default', defaultModel: 'acme/luna', defaultEffort: 'low' };
    expect(resolveSubagentModelRoute({ policy, own: OWN })).toEqual({
      model: 'acme/luna',
      thinking: 'low',
      source: 'policy-default',
    });
    expect(resolveSubagentModelRoute({ policy, own: OWN, requested: 'primary' }).source).toBe('caller');
    expect(codeOf(() => resolveSubagentModelRoute({ policy, own: OWN, requested: 'acme/other' }))).toBe(
      ErrorCodes.CONFIG_INVALID,
    );
  });

  it('pool binds the default or a pool member and rejects outsiders', () => {
    expect(resolveSubagentModelRoute({ policy: POOL, own: OWN })).toEqual({
      model: 'acme/luna',
      thinking: 'low',
      source: 'policy-pool',
    });
    expect(resolveSubagentModelRoute({ policy: POOL, own: OWN, requested: 'acme/sol' })).toMatchObject({
      model: 'acme/sol',
      source: 'policy-pool',
    });
    expect(codeOf(() => resolveSubagentModelRoute({ policy: POOL, own: OWN, requested: 'acme/zzz' }))).toBe(
      ErrorCodes.CONFIG_INVALID,
    );
  });

  it('force binds the pinned model and rejects any explicit choice, primary included', () => {
    const policy: CanonicalSubagentModelPolicy = { mode: 'force', defaultModel: 'acme/luna' };
    expect(resolveSubagentModelRoute({ policy, own: OWN })).toEqual({
      model: 'acme/luna',
      thinking: undefined,
      source: 'policy-force',
    });
    expect(codeOf(() => resolveSubagentModelRoute({ policy, own: OWN, requested: 'primary' }))).toBe(
      ErrorCodes.CONFIG_INVALID,
    );
    expect(codeOf(() => resolveSubagentModelRoute({ policy, own: OWN, requested: 'acme/luna' }))).toBe(
      ErrorCodes.CONFIG_INVALID,
    );
  });

  it('resumedBindingProvenance keeps the original revision and marks the sources as existing', () => {
    const stored: SubagentBindingProvenance = {
      operation: 'spawn',
      profileSource: 'requested',
      modelSource: 'policy-pool',
      policyMode: 'pool',
      policySource: 'config',
      featureSource: 'config',
      resolvedFromRoutingEnvironmentRevision: 'route-env:v1:aaa',
      routeDecisionFingerprint: 'route-decision:v1:bbb',
    };
    expect(resumedBindingProvenance(stored)).toEqual({
      ...stored,
      operation: 'resume',
      profileSource: 'resume-existing',
      modelSource: 'resume-existing',
    });
  });
});

describe('SessionSubagentRoutingService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let config: StubConfigService;
  let callerData: ProfileData;
  let childData: ProfileData;
  let childProvenance: SubagentBindingProvenance | undefined;
  let featureEnabled: boolean;
  let telemetry: ITelemetryService & { track2: ReturnType<typeof vi.fn> };

  const profiles = [
    normalizeAgentProfile({ name: 'coder', description: 'Coder', systemPrompt: () => 'coder' }),
    normalizeAgentProfile({ name: 'explore', description: 'Explore', systemPrompt: () => 'explore' }),
  ];

  function handle(id: string, data: () => ProfileData): IAgentScopeHandle {
    return {
      id,
      kind: LifecycleScope.Agent,
      accessor: {
        get: (serviceId: unknown) => {
          if (serviceId === IAgentProfileService) {
            return {
              _serviceBrand: undefined,
              data,
              getEffectiveThinkingLevel: () => data().thinkingLevel,
            } as unknown as IAgentProfileService;
          }
          if (serviceId === IAgentBindingProvenanceService) {
            return {
              _serviceBrand: undefined,
              current: () => childProvenance,
              record: (provenance: SubagentBindingProvenance) => {
                childProvenance ??= provenance;
              },
            };
          }
          return undefined;
        },
      } as IAgentScopeHandle['accessor'],
      dispose: () => {},
    };
  }

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    featureEnabled = true;
    childProvenance = undefined;
    telemetry = { _serviceBrand: undefined, track2: vi.fn(), track: vi.fn() } as unknown as ITelemetryService & { track2: ReturnType<typeof vi.fn> };
    callerData = {
      profileName: 'orchestrator',
      modelAlias: 'acme/sol',
      thinkingLevel: 'high',
      systemPrompt: '',
      modelCapabilities: {} as never,
    };
    childData = { ...callerData, profileName: 'coder', modelAlias: 'acme/luna', thinkingLevel: 'low' };
  });
  afterEach(() => disposables.dispose());

  function service(sections: Record<string, unknown>): ISubagentRoutingService {
    config = new StubConfigService(sections);
    ix.stub(IConfigService, config);
    const flags = stubFlag((id) => featureEnabled && id === SECONDARY_MODEL_FLAG_ID);
    ix.stub(IFlagService, {
      ...flags,
      explain: (id: string) =>
        id === SECONDARY_MODEL_FLAG_ID
          ? ({ id, enabled: featureEnabled, source: 'config' } as ExperimentalFeatureState)
          : undefined,
    });
    ix.stub(IModelCatalog, {
      _serviceBrand: undefined,
      get: (id: string) => {
        if (!['acme/sol', 'acme/luna'].includes(id)) {
          throw new Error2(ErrorCodes.CONFIG_INVALID, `Model "${id}" is not configured in config.toml.`, {
            details: { model: id },
          });
        }
        return { id, supportEfforts: ['low', 'high'], defaultEffort: 'high' } as unknown as Model;
      },
    } as unknown as IModelCatalog);
    ix.stub(IAgentLifecycleService, {
      _serviceBrand: undefined,
      onDidCreate: Event.None,
      onDidCreateScope: Event.None,
      onWillClose: Event.None,
      onDidClose: Event.None,
      handleOf: (agentId: string) =>
        agentId === 'main' ? handle('main', () => callerData) : agentId === 'child' ? handle('child', () => childData) : undefined,
      list: () => [],
    } as unknown as IAgentLifecycleService);
    ix.stub(ISessionAgentProfileCatalog, {
      _serviceBrand: undefined,
      ready: Promise.resolve(),
      onDidChange: Event.None,
      get: (name: string) => profiles.find((profile) => profile.name === name),
      getDefault: () => profiles[0]!,
      list: () => profiles,
      inspect: () => ({ sourceId: 'builtin' }),
    } as unknown as ISessionAgentProfileCatalog);
    ix.stub(ITelemetryService, telemetry);
    ix.set(ISubagentModelPolicyService, new SyncDescriptor(SubagentModelPolicyService));
    ix.set(ISubagentRoutingService, new SyncDescriptor(SessionSubagentRoutingService));
    return ix.get(ISubagentRoutingService);
  }

  it('resolves spawn plans with provenance for every policy mode', async () => {
    const inherit = await service({}).resolve({ callerAgentId: 'main', profileName: 'coder' });
    expect(inherit).toMatchObject({
      profileName: 'coder',
      model: 'acme/sol',
      routing: { operation: 'spawn', profileSource: 'requested', modelSource: 'caller', policyMode: 'inherit', policySource: 'default' },
    });
    expect(inherit.routing.resolvedFromRoutingEnvironmentRevision).toMatch(/^route-env:v1:/);
    expect(inherit.routing.routeDecisionFingerprint).toMatch(/^route-decision:v1:/);

    disposables.dispose();
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    const pooled = await service({
      [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/luna', models: { 'acme/luna': '', 'acme/sol': '' } },
    }).resolve({ callerAgentId: 'main' });
    expect(pooled).toMatchObject({
      profileName: 'coder',
      model: 'acme/luna',
      routing: { profileSource: 'default', modelSource: 'policy-pool', policyMode: 'pool', policySource: 'config' },
    });

    disposables.dispose();
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    const forced = await service({ [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/luna', force: true } }).resolve({
      callerAgentId: 'main',
    });
    expect(forced.routing).toMatchObject({ modelSource: 'policy-force', policyMode: 'force' });
    await expect(
      service({ [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/luna', force: true } }).resolve({
        callerAgentId: 'main',
        model: 'primary',
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.CONFIG_INVALID });
  });

  it('a fork inherits the caller binding regardless of the policy and never rebinds', async () => {
    const forked = await service({ [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/luna', force: true } }).resolve({
      callerAgentId: 'main',
      fork: true,
    });
    expect(forked).toMatchObject({
      profileName: 'orchestrator',
      model: 'acme/sol',
      thinking: 'high',
      fork: true,
      routing: { operation: 'fork', profileSource: 'fork-inherit', modelSource: 'fork-inherit', policyMode: 'force' },
    });
  });

  it('two spawns with different explicit models share the environment revision and differ in decision', async () => {
    const svc = service({
      [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/luna', models: { 'acme/luna': '', 'acme/sol': '' } },
    });
    const a = await svc.resolve({ callerAgentId: 'main', model: 'acme/luna' });
    const b = await svc.resolve({ callerAgentId: 'main', model: 'acme/sol' });
    expect(a.routing.resolvedFromRoutingEnvironmentRevision).toBe(b.routing.resolvedFromRoutingEnvironmentRevision);
    expect(a.routing.routeDecisionFingerprint).not.toBe(b.routing.routeDecisionFingerprint);
  });

  it('resume keeps the child on its recorded binding and provenance after the caller changed models', async () => {
    const svc = service({});
    callerData = { ...callerData, modelAlias: 'acme/luna' };
    const plan = await svc.resolve({ callerAgentId: 'main', profileName: 'coder' });
    expect(plan.model).toBe('acme/luna');
    const revisionA = plan.routing.resolvedFromRoutingEnvironmentRevision;
    handle('child', () => childData).accessor.get(IAgentBindingProvenanceService).record(plan.routing);

    callerData = { ...callerData, modelAlias: 'acme/sol' };
    const revisionB = svc.currentRevision('main');
    expect(revisionB).toBeDefined();
    expect(revisionB).not.toBe(revisionA);

    const resumed = svc.resumed('main', handle('child', () => childData));
    expect(resumed.routing).toEqual({
      ...plan.routing,
      operation: 'resume',
      profileSource: 'resume-existing',
      modelSource: 'resume-existing',
    });
    expect(resumed.routing?.resolvedFromRoutingEnvironmentRevision).toBe(revisionA);
    expect(resumed.currentRoutingEnvironmentRevision).toBe(revisionB);
  });

  it('honors an explicit thinking effort and folds it into the decision fingerprint only', async () => {
    const svc = service({});
    const plain = await svc.resolve({ callerAgentId: 'main', profileName: 'coder' });
    const explicit = await svc.resolve({ callerAgentId: 'main', profileName: 'coder', thinking: 'low' });
    expect(plain.thinking).toBe('high');
    expect(explicit.thinking).toBe('low');
    expect(explicit.routing.resolvedFromRoutingEnvironmentRevision).toBe(plain.routing.resolvedFromRoutingEnvironmentRevision);
    expect(explicit.routing.routeDecisionFingerprint).not.toBe(plain.routing.routeDecisionFingerprint);
  });

  it('emits subagent_spawn_plan_resolved with the routing attribute set and no prompt content', async () => {
    const svc = service({ [SECONDARY_MODEL_SECTION]: { defaultModel: 'acme/luna', force: true } });
    const plan = await svc.resolve({ callerAgentId: 'main', profileName: 'explore' });
    expect(telemetry.track2).toHaveBeenCalledTimes(1);
    const [name, payload] = telemetry.track2.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('subagent_spawn_plan_resolved');
    expect(payload).toEqual({
      operation: 'spawn',
      profile_source: 'requested',
      model_source: 'policy-force',
      policy_mode: 'force',
      policy_source: 'config',
      feature_source: 'config',
      routing_env_revision: plan.routing.resolvedFromRoutingEnvironmentRevision,
      route_decision: plan.routing.routeDecisionFingerprint,
      explicit_profile: true,
      explicit_model: false,
      explicit_thinking: false,
    });
    expect(Object.keys(payload).toSorted()).toEqual([
      'explicit_model',
      'explicit_profile',
      'explicit_thinking',
      'feature_source',
      'model_source',
      'operation',
      'policy_mode',
      'policy_source',
      'profile_source',
      'route_decision',
      'routing_env_revision',
    ]);
  });

  it('resume without a recorded provenance still reports the current revision', () => {
    const svc = service({});
    const resumed = svc.resumed('main', handle('child', () => childData));
    expect(resumed.routing).toBeUndefined();
    expect(resumed.currentRoutingEnvironmentRevision).toMatch(/^route-env:v1:/);
  });
});

describe('subagent binding provenance state', () => {
  const provenance: SubagentBindingProvenance = {
    operation: 'spawn',
    profileSource: 'default',
    modelSource: 'caller',
    policyMode: 'inherit',
    policySource: 'default',
    featureSource: 'default',
    resolvedFromRoutingEnvironmentRevision: 'route-env:v1:aaa',
    routeDecisionFingerprint: 'route-decision:v1:bbb',
  };
  const foldContext: FoldContext = {
    silent: false,
    checkpoint: () => {},
    clearCheckpoints: () => {},
    undoToCheckpoint: () => {},
    emit: () => {},
  };

  it('folds the durable recorded event into the replayable key', () => {
    const event = new SubagentBindingProvenanceRecorded({ agentId: 'child', provenance });
    const fold = subagentBindingProvenanceKey.replayable.folds.get(event.constructor as Event2Class);
    expect(fold).toBeDefined();
    expect(subagentBindingProvenanceKey.initial()).toBeUndefined();
    expect(fold!(undefined, event as Event2, foldContext)).toEqual(provenance);
    expect(subagentBindingProvenanceKey.replayable.durable).toBe(true);
  });

  it('the service records once and never overwrites an existing provenance', () => {
    const dispatched: Event2[] = [];
    let stored: SubagentBindingProvenance | undefined;
    const service = new AgentBindingProvenanceService(
      { dispatch: (event: Event2) => { dispatched.push(event); return Promise.resolve(); } } as never,
      { agentId: 'child' } as never,
      {
        contributeState: () => {},
        get: () => stored,
      } as never,
    );
    service.record(provenance);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toBeInstanceOf(SubagentBindingProvenanceRecorded);
    stored = provenance;
    service.record({ ...provenance, modelSource: 'policy-force' });
    expect(dispatched).toHaveLength(1);
    expect(service.current()).toEqual(provenance);
  });
});
