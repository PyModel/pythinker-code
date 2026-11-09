import { describe, expect, it } from 'vitest';
import {
  formatThinkingSpinnerLabel,
  getThinkingSpinnerLabel,
  THINKING_SPINNER_LABEL_INTERVAL_MS,
  THINKING_SPINNER_LABELS,
} from '../src/lib/thinkingSpinnerLabels';

describe('thinkingSpinnerLabels', () => {
  it('rotates labels every 60 seconds', () => {
    expect(getThinkingSpinnerLabel(0)).toBe('pythinking');
    expect(formatThinkingSpinnerLabel(0)).toBe('pythinking…');
    expect(getThinkingSpinnerLabel(THINKING_SPINNER_LABEL_INTERVAL_MS)).toBe('pyreasoning');
    expect(
      getThinkingSpinnerLabel(THINKING_SPINNER_LABELS.length * THINKING_SPINNER_LABEL_INTERVAL_MS),
    ).toBe('pythinking');
  });
});
