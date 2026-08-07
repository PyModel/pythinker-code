import { describe, expect, it } from 'vitest';

import { authSummarySchema, type AuthSummary } from '../rest/auth';

describe('authSummarySchema', () => {
  const emptyState: AuthSummary = {
    ready: false,
    providers_count: 0,
    default_model: null,
  };

  const readyState: AuthSummary = {
    ready: true,
    providers_count: 1,
    default_model: 'pythinker-k2',
  };

  it('round-trips an empty (unprovisioned) state', () => {
    const parsed = authSummarySchema.parse(emptyState);
    expect(parsed.ready).toBe(false);
    expect(parsed.providers_count).toBe(0);
    expect(parsed.default_model).toBeNull();
  });

  it('round-trips a ready state', () => {
    const parsed = authSummarySchema.parse(readyState);
    expect(parsed.ready).toBe(true);
    expect(parsed.providers_count).toBe(1);
    expect(parsed.default_model).toBe('pythinker-k2');
  });

  it('rejects a negative providers_count', () => {
    expect(() => authSummarySchema.parse({ ...emptyState, providers_count: -1 })).toThrow(/invalid|expected|Invalid/i);
  });

  it('rejects a non-integer providers_count', () => {
    expect(() => authSummarySchema.parse({ ...emptyState, providers_count: 1.5 })).toThrow(/invalid|expected|Invalid/i);
  });

  it('rejects a missing default_model rather than defaulting it', () => {
    const { default_model: _omit, ...rest } = emptyState;
    expect(() => authSummarySchema.parse(rest)).toThrow(/invalid|expected|Invalid/i);
  });
});
