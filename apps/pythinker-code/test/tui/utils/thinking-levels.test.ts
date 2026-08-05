import type { ModelAlias } from '@pythoughts/pythinker-code-sdk';
import { describe, expect, it } from 'vitest';

import {
  coerceEffortForModel,
  effortColorToken,
  effortLevelsForModel,
  shortEffortLabel,
} from '#/tui/utils/thinking-levels';

function model(overrides: Partial<ModelAlias> = {}): ModelAlias {
  return {
    provider: 'managed:kimi-code',
    model: 'k2',
    maxContextSize: 200_000,
    capabilities: ['thinking'],
    ...overrides,
  } as ModelAlias;
}

describe('effortLevelsForModel', () => {
  it('falls back to low/medium/high without supportEfforts metadata', () => {
    expect(effortLevelsForModel(model())).toEqual(['off', 'low', 'medium', 'high']);
    expect(effortLevelsForModel(undefined)).toEqual(['off', 'low', 'medium', 'high']);
  });

  it('uses declared supportEfforts in canonical order, filtering unknown values', () => {
    expect(
      effortLevelsForModel(
        model({ supportEfforts: ['max', 'none', 'low', 'bogus', 'minimal', 'high'] }),
      ),
    ).toEqual(['off', 'minimal', 'low', 'high', 'max']);
  });

  it('uses one fixed level for explicit empty effort metadata', () => {
    expect(
      effortLevelsForModel(
        model({ capabilities: ['always_thinking'], supportEfforts: [] }),
      ),
    ).toEqual(['high']);
  });

  it('falls back when supportEfforts only contains unknown values', () => {
    expect(effortLevelsForModel(model({ supportEfforts: ['bogus'] }))).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
  });

  it('returns only off for unsupported models', () => {
    expect(effortLevelsForModel(model({ capabilities: ['tool_use'] }))).toEqual(['off']);
  });

  it('excludes off for always-on models', () => {
    expect(
      effortLevelsForModel(model({ capabilities: ['always_thinking'], supportEfforts: ['high'] })),
    ).toEqual(['high']);
  });

  it('treats adaptiveThinking models as toggleable', () => {
    expect(effortLevelsForModel(model({ capabilities: [], adaptiveThinking: true }))).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
  });
});

describe('coerceEffortForModel', () => {
  it('passes through supported levels', () => {
    expect(coerceEffortForModel(model(), 'medium')).toBe('medium');
    expect(coerceEffortForModel(model(), 'off')).toBe('off');
  });

  it('clamps an unsupported level down to the nearest lower one', () => {
    expect(coerceEffortForModel(model({ supportEfforts: ['low', 'high'] }), 'max')).toBe('high');
    expect(coerceEffortForModel(model({ supportEfforts: ['low', 'high'] }), 'medium')).toBe('low');
  });

  it('falls back to the first level when nothing lower is supported', () => {
    expect(coerceEffortForModel(model({ supportEfforts: ['max'] }), 'low')).toBe('off');
    expect(
      coerceEffortForModel(
        model({ capabilities: ['always_thinking'], supportEfforts: ['max'] }),
        'low',
      ),
    ).toBe('max');
  });

  it('maps always-on + off to the first supported level', () => {
    expect(
      coerceEffortForModel(
        model({ capabilities: ['always_thinking'], supportEfforts: ['high', 'max'] }),
        'off',
      ),
    ).toBe('high');
  });

  it('maps unsupported models to off', () => {
    expect(coerceEffortForModel(model({ capabilities: ['tool_use'] }), 'high')).toBe('off');
  });

  it('maps the legacy on value to high before clamping', () => {
    expect(coerceEffortForModel(model(), 'on')).toBe('high');
    expect(coerceEffortForModel(model({ supportEfforts: ['low'] }), 'on')).toBe('low');
  });
});

describe('effortColorToken', () => {
  it.each([
    ['minimal', 'effortLow'],
    ['low', 'effortLow'],
    ['medium', 'effortMedium'],
    ['high', 'effortHigh'],
    ['xhigh', 'effortXHigh'],
    ['max', 'effortMax'],
    ['legacy', 'primary'],
  ])('maps %s to %s', (level, token) => {
    expect(effortColorToken(level)).toBe(token);
  });
});

describe('shortEffortLabel', () => {
  it('shortens medium to med and keeps other labels', () => {
    expect(shortEffortLabel('medium')).toBe('med');
    expect(shortEffortLabel('high')).toBe('high');
    expect(shortEffortLabel('off')).toBe('off');
  });
});
