import { describe, expect, it } from 'vitest';

import { toAppModel } from '../src/api/daemon/mappers';
import type { WireModel } from '../src/api/daemon/wire';

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
