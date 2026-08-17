import { describe, expect, it } from 'vitest';

import { codexLoginStartSchema } from '../rest/codexLogin';

describe('rest/codexLogin', () => {
  it('requires an absolute authorize URL and an ISO 8601 expiry timestamp', () => {
    const valid = {
      login_id: 'login_1',
      authorize_url: 'https://auth.openai.com/oauth/authorize?state=test',
      loopback: true,
      expires_at: '2026-08-17T00:10:00.000Z',
    };

    expect(codexLoginStartSchema.safeParse(valid).success).toBe(true);
    expect(codexLoginStartSchema.safeParse({ ...valid, authorize_url: 'not a URL' }).success)
      .toBe(false);
    expect(codexLoginStartSchema.safeParse({ ...valid, expires_at: 'ten minutes' }).success)
      .toBe(false);
  });
});
