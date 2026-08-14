import { APIProviderQuotaExhaustedError } from '@pymodel/kosong';
import { describe, expect, it } from 'vitest';

import { toPythinkerErrorPayload } from '#/errors/serialize';

describe('toPythinkerErrorPayload — quota-exhausted 429', () => {
  it('maps a quota-exhausted 429 to provider.api_error, not provider.rate_limit', () => {
    // provider.rate_limit is retryable and re-minted as a rate-limit error
    // across the wire boundary, which would drive a retry loop; quota
    // exhaustion must carry the non-retryable generic code instead.
    const payload = toPythinkerErrorPayload(
      new APIProviderQuotaExhaustedError(
        'Your account is suspended due to insufficient balance, please recharge your account',
        'req-quota',
      ),
    );
    expect(payload.code).toBe('provider.api_error');
    expect(payload.retryable).toBe(false);
    expect(payload.message).toContain('recharge');
    expect(payload.details).toMatchObject({ statusCode: 429, requestId: 'req-quota' });
  });
});
