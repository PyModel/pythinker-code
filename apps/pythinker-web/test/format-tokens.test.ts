import { describe, expect, it } from 'vitest';

import { formatTokens } from '../src/lib/formatTokens';

describe('formatTokens', () => {
  it('uses 1024-based compact units', () => {
    expect(formatTokens(1_000)).toBe('1000');
    expect(formatTokens(1_024)).toBe('1k');
    expect(formatTokens(50_552)).toBe('49.4k');
    expect(formatTokens(262_144)).toBe('256k');
    expect(formatTokens(1_048_576)).toBe('1M');
  });
});
