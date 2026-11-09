import { describe, expect, it } from 'vitest';

import {
  CUSTOM_REGISTRY_MODEL_FIELDS,
  OPEN_PLATFORM_MODEL_FIELDS,
  mergeRefreshedModelAlias,
} from '../src/model-alias-merge';

describe('mergeRefreshedModelAlias', () => {
  it('preserves overrides while refreshing platform fields', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'platform',
        model: 'model-a',
        maxContextSize: 262144,
        supportEfforts: ['low'],
        overrides: { supportEfforts: ['low'] },
      },
      {
        provider: 'platform',
        model: 'model-a',
        maxContextSize: 262144,
        supportEfforts: ['low', 'high', 'max'],
      },
      OPEN_PLATFORM_MODEL_FIELDS,
    );

    expect(merged.supportEfforts).toEqual(['low', 'high', 'max']);
    expect(merged.overrides).toEqual({ supportEfforts: ['low'] });
  });

  it('drops platform top-level fields when the remote stops declaring them', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'platform',
        model: 'model-a',
        maxContextSize: 262144,
        supportEfforts: ['low'],
      },
      {
        provider: 'platform',
        model: 'model-a',
        maxContextSize: 262144,
      },
      OPEN_PLATFORM_MODEL_FIELDS,
    );

    expect(merged.supportEfforts).toBeUndefined();
  });

  it('refreshes custom-registry supportEfforts from upstream', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'registry',
        model: 'gpt-5.5',
        maxContextSize: 131072,
        supportEfforts: ['low', 'high'],
      },
      {
        provider: 'registry',
        model: 'gpt-5.5',
        maxContextSize: 131072,
        supportEfforts: ['low', 'high', 'max'],
        defaultEffort: 'high',
      },
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );

    expect(merged.supportEfforts).toEqual(['low', 'high', 'max']);
    expect(merged.defaultEffort).toBe('high');
  });

  it('drops custom-registry effort fields when upstream stops declaring them', () => {
    const merged = mergeRefreshedModelAlias(
      {
        provider: 'registry',
        model: 'gpt-5.5',
        maxContextSize: 131072,
        supportEfforts: ['low', 'high'],
        defaultEffort: 'high',
      },
      {
        provider: 'registry',
        model: 'gpt-5.5',
        maxContextSize: 131072,
      },
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );

    expect(merged.supportEfforts).toBeUndefined();
    expect(merged.defaultEffort).toBeUndefined();
  });
});
