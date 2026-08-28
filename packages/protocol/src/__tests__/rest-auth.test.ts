import { describe, expect, it } from 'vitest';

import {
  authSummarySchema,
  type AuthSummary,
} from '../rest/auth';

describe('authSummarySchema', () => {
  const emptyState: AuthSummary = {
    ready: false,
    models_ready: false,
    providers_count: 0,
    default_model: null,
  };

  const readyState: AuthSummary = {
    ready: true,
    models_ready: true,
    providers_count: 1,
    default_model: 'example-model',
  };

  it('round-trips an empty (unprovisioned) state', () => {
    const parsed = authSummarySchema.parse(emptyState);
    expect(parsed.ready).toBe(false);
    expect(parsed.models_ready).toBe(false);
    expect(parsed.providers_count).toBe(0);
    expect(parsed.default_model).toBeNull();
  });

  it('round-trips a ready state', () => {
    const parsed = authSummarySchema.parse(readyState);
    expect(parsed.ready).toBe(true);
    expect(parsed.models_ready).toBe(true);
    expect(parsed.providers_count).toBe(1);
    expect(parsed.default_model).toBe('example-model');
  });

  it('rejects missing ready', () => {
    const { ready: _omit, ...rest } = emptyState;
    expect(authSummarySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing models_ready', () => {
    const { models_ready: _omit, ...rest } = emptyState;
    expect(authSummarySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing providers_count', () => {
    const { providers_count: _omit, ...rest } = emptyState;
    expect(authSummarySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing default_model', () => {
    const { default_model: _omit, ...rest } = emptyState;
    expect(authSummarySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects negative providers_count', () => {
    const bad = { ...emptyState, providers_count: -1 };
    expect(authSummarySchema.safeParse(bad).success).toBe(false);
  });

});
