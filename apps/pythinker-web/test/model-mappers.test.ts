import { describe, expect, it } from 'vitest';

import { toAppExperimentalFlagStates, toAppModel } from '../src/api/daemon/mappers';
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
