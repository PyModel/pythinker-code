import { describe, expect, it } from 'vitest';

import { configChangedEventSchema, configWarningEventSchema } from '@pymodel/protocol';

import {
  toAppEvent,
  toAppExperimentalFlagStates,
  toAppModel,
  toAppSubagentRouting,
  toAppSubagentRoutingFromEvent,
  toAppTask,
} from '../src/api/daemon/mappers';
import type { WireEvent, WireTask } from '../src/api/daemon/wire';

describe('subagent routing mappers', () => {
  const wire = {
    operation: 'spawn' as const,
    profile_source: 'requested' as const,
    model_source: 'policy-force' as const,
    policy_mode: 'force' as const,
    policy_source: 'config' as const,
    feature_source: 'env' as const,
    routing_env_revision: 'route-env:v1:aaa',
    route_decision: 'route-decision:v1:bbb',
  };
  const app = {
    operation: 'spawn',
    profileSource: 'requested',
    modelSource: 'policy-force',
    policyMode: 'force',
    policySource: 'config',
    featureSource: 'env',
    routingEnvRevision: 'route-env:v1:aaa',
    routeDecision: 'route-decision:v1:bbb',
  };

  it('maps the REST snake_case shape and rejects incomplete objects', () => {
    expect(toAppSubagentRouting(wire)).toEqual(app);
    expect(toAppSubagentRouting({ ...wire, route_decision: undefined })).toBeUndefined();
    expect(toAppSubagentRouting(undefined)).toBeUndefined();
  });

  it('maps the engine camelCase event shape', () => {
    expect(
      toAppSubagentRoutingFromEvent({
        operation: 'spawn',
        profileSource: 'requested',
        modelSource: 'policy-force',
        policyMode: 'force',
        policySource: 'config',
        featureSource: 'env',
        resolvedFromRoutingEnvironmentRevision: 'route-env:v1:aaa',
        routeDecisionFingerprint: 'route-decision:v1:bbb',
      }),
    ).toEqual(app);
    expect(toAppSubagentRoutingFromEvent({ operation: 'spawn' })).toBeUndefined();
  });

  it('rejects values outside the routing contract instead of casting them through', () => {
    expect(toAppSubagentRouting({ ...wire, policy_mode: 'invalid' })).toBeUndefined();
    expect(toAppSubagentRouting({ ...wire, routing_env_revision: '' })).toBeUndefined();
    expect(
      toAppSubagentRoutingFromEvent({
        operation: 'spawn',
        profileSource: 'requested',
        modelSource: 'policy-force',
        policyMode: 'force',
        policySource: 'config',
        featureSource: 'somewhere-else',
        resolvedFromRoutingEnvironmentRevision: 'route-env:v1:aaa',
        routeDecisionFingerprint: 'route-decision:v1:bbb',
      }),
    ).toBeUndefined();
  });

  it('toAppTask carries routing and the current revision', () => {
    const task: WireTask = {
      id: 't1',
      session_id: 's1',
      kind: 'subagent',
      description: 'd',
      status: 'running',
      created_at: '2026-01-01T00:00:00.000Z',
      routing: wire,
      current_routing_env_revision: 'route-env:v1:now',
    };
    expect(toAppTask(task)).toMatchObject({ routing: app, currentRoutingEnvRevision: 'route-env:v1:now' });
    expect(toAppTask({ ...task, routing: undefined }).routing).toBeUndefined();
  });
});
import type { WireExperimentalFlagState, WireModel } from '../src/api/daemon/wire';

describe('experimental flag state mapper', () => {
  it('keeps the server decision fields and never infers them', () => {
    const wire: WireExperimentalFlagState[] = [
      {
        id: 'secondary-model',
        enabled: true,
        source: 'env',
        config_value: false,
        default_enabled: false,
        externally_controlled: true,
        overridden: true,
      },
      {
        id: 'tool-select',
        enabled: false,
        source: 'default',
        default_enabled: false,
        externally_controlled: false,
        overridden: false,
      },
    ];
    expect(toAppExperimentalFlagStates(wire)).toEqual([
      {
        id: 'secondary-model',
        enabled: true,
        source: 'env',
        configValue: false,
        defaultEnabled: false,
        externallyControlled: true,
        overridden: true,
      },
      {
        id: 'tool-select',
        enabled: false,
        source: 'default',
        configValue: undefined,
        defaultEnabled: false,
        externallyControlled: false,
        overridden: false,
      },
    ]);
  });

  it('maps a missing list from an older server to an empty list', () => {
    expect(toAppExperimentalFlagStates(undefined)).toEqual([]);
  });
});

describe('model mappers', () => {
  it('maps per-model thinking metadata to app fields', () => {
    const wire: WireModel = {
      provider: 'pythinker',
      model: 'k2',
      display_name: 'Pythinker K2',
      max_context_size: 131072,
      capabilities: ['thinking'],
      support_efforts: ['low', 'high', 'max'],
      adaptive_thinking: true,
    };

    expect(toAppModel(wire)).toEqual({
      id: 'k2',
      provider: 'pythinker',
      model: 'k2',
      displayName: 'Pythinker K2',
      maxContextSize: 131072,
      capabilities: ['thinking'],
      supportEfforts: ['low', 'high', 'max'],
      adaptiveThinking: true,
    });
  });
});

describe('wire event contract (mapper reads vs protocol zod)', () => {
  const frameBase = {
    session_id: '__global__',
    seq: 1,
    timestamp: '2026-01-01T00:00:00.000Z',
  };

  it('maps a gateway-shaped event.config.changed frame validated by the real schema', () => {
    const payload = {
      type: 'event.config.changed' as const,
      changed_fields: ['models', 'providers'],
      config: { providers: {}, default_model: 'm1' },
    };
    const parsed = configChangedEventSchema.safeParse(payload);
    expect(parsed.success).toBe(true);

    const app = toAppEvent({ type: 'event.config.changed', ...frameBase, payload } as unknown as WireEvent);
    expect(app).toMatchObject({
      type: 'configChanged',
      changedFields: ['models', 'providers'],
    });
    expect((app as { changedFields?: unknown }).changedFields).toHaveLength(2);
  });

  it('rejects the legacy camelCase payload so field drift fails here, not in the UI', () => {
    const parsed = configChangedEventSchema.safeParse({
      type: 'event.config.changed',
      changedFields: ['models'],
      config: { providers: {} },
    });
    expect(parsed.success).toBe(false);
  });

  it('yields empty changedFields when event.config.changed omits changed_fields', () => {
    const app = toAppEvent({
      type: 'event.config.changed',
      session_id: '__global__',
      seq: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { type: 'event.config.changed', config: { providers: {} } },
    } as unknown as WireEvent);
    expect(app).toMatchObject({ type: 'configChanged', changedFields: [] });
  });

  it('renders a gateway-shaped event.config.warning as a readable warning notice', () => {
    const message =
      'Default model "gone" is no longer available (dangling-alias); switched to "my-openai/gpt-4o-mini".';
    const payload = {
      type: 'event.config.warning' as const,
      warnings: [{ domain: 'default_model', message }],
    };
    expect(configWarningEventSchema.safeParse(payload).success).toBe(true);

    const app = toAppEvent({
      type: 'event.config.warning',
      session_id: '__global__',
      seq: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      payload,
    } as unknown as WireEvent);
    expect(app).toMatchObject({ type: 'unknown', raw: { _agentWarning: true, message } });
  });

  it('treats the phantom event.session.updated as unknown instead of reading a dead field', () => {
    const app = toAppEvent({
      type: 'event.session.updated',
      ...frameBase,
      payload: { session: {}, changed_fields: ['title'] },
    } as unknown as WireEvent);
    expect(app).toMatchObject({ type: 'unknown' });
  });

  it('does not throw when event.message.updated carries a non-array content', () => {
    const app = toAppEvent({
      type: 'event.message.updated',
      session_id: 's1',
      seq: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { message_id: 'm1', content: 'oops', status: 'completed' },
    } as unknown as WireEvent);
    expect(app).toMatchObject({ type: 'messageUpdated', content: [] });
  });

  it('maps event.session.work_changed payload fields the schema actually declares', () => {
    const app = toAppEvent({
      type: 'event.session.work_changed',
      ...frameBase,
      payload: {
        busy: true,
        main_turn_active: true,
        pending_interaction: 'approval',
        last_turn_reason: 'completed',
      },
    } as unknown as WireEvent);
    expect(app).toEqual({
      type: 'sessionWorkChanged',
      sessionId: '__global__',
      busy: true,
      mainTurnActive: true,
      pendingInteraction: 'approval',
      lastTurnReason: 'completed',
    });
  });
});
