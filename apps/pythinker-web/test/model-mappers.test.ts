import { describe, expect, it } from 'vitest';

import {
  toAppExperimentalFlagStates,
  toAppModel,
  toAppSubagentRouting,
  toAppSubagentRoutingFromEvent,
  toAppTask,
} from '../src/api/daemon/mappers';
import type { WireTask } from '../src/api/daemon/wire';

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
