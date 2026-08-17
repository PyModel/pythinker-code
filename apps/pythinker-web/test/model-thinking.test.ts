import { describe, expect, it } from 'vitest';
import {
  coerceThinkingForModel,
  effortLevelsForModel,
} from '../src/lib/modelThinking';

describe('effortLevelsForModel', () => {
  it('keeps declared efforts in canonical order and prepends off', () => {
    expect(
      effortLevelsForModel({ capabilities: ['thinking'], supportEfforts: ['low', 'high', 'max'] }),
    ).toEqual(['off', 'low', 'high', 'max']);
  });

  it('falls back to low/medium/high when supportEfforts is absent', () => {
    expect(effortLevelsForModel({ capabilities: ['thinking'] })).toEqual([
      'off',
      'low',
      'medium',
      'high',
    ]);
  });

  it('treats an empty supportEfforts array as high only', () => {
    expect(effortLevelsForModel({ capabilities: ['thinking'], supportEfforts: [] })).toEqual([
      'off',
      'high',
    ]);
  });

  it('omits off for always-thinking models', () => {
    expect(effortLevelsForModel({ capabilities: ['always_thinking'] })).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });

  it('offers only off when thinking is unsupported', () => {
    expect(effortLevelsForModel({ capabilities: [] })).toEqual(['off']);
  });
});

describe('coerceThinkingForModel', () => {
  it('clamps an unsupported level down to the nearest lower supported one', () => {
    expect(
      coerceThinkingForModel(
        { capabilities: ['thinking'], supportEfforts: ['low', 'medium'] },
        'xhigh',
      ),
    ).toBe('medium');
  });

  it('promotes off to the first supported level for always-thinking models', () => {
    expect(
      coerceThinkingForModel(
        { capabilities: ['always_thinking'], supportEfforts: ['medium', 'max'] },
        'off',
      ),
    ).toBe('medium');
  });

  it('returns off when thinking is unsupported', () => {
    expect(coerceThinkingForModel({ capabilities: [] }, 'high')).toBe('off');
  });
});
