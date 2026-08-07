import { describe, expect, it } from 'vitest';

import { effortColorToken, shortEffortLabel } from '#/tui/utils/thinking-levels';

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
