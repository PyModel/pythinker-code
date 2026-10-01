import { APIError as OpenAIAPIError } from 'openai';
import { describe, expect, it } from 'vitest';

import { convertOpenAIError } from '#human/llm/requester/bases/openai/format';
import {
  APIProviderQuotaExhaustedError,
  APIProviderRateLimitError,
  ChatProviderError,
  errorFromLlmMessage,
  PROVIDER_API_ERROR_CODE,
  PROVIDER_AUTH_ERROR_CODE,
} from '#/llm-adapter/contract/errors';

function classify(source: unknown): ChatProviderError {
  const error = errorFromLlmMessage(convertOpenAIError(source));
  if (!(error instanceof ChatProviderError)) throw new Error('expected a ChatProviderError');
  return error;
}

describe('OpenCode billing rejection classification', () => {
  it.each([401, 402, 403])('keeps a %s insufficient-balance response out of provider.auth_error', (status) => {
    const error = classify(
      new OpenAIAPIError(
        status,
        { message: 'Insufficient balance. Manage your billing here: https://example.test/billing' },
        `${status} Insufficient balance. Manage your billing here: https://example.test/billing`,
        new Headers({ 'x-request-id': 'req-123' }),
      ),
    );
    expect(error.code).toBe(PROVIDER_API_ERROR_CODE);
    expect('statusCode' in error && error.statusCode).toBe(status);
  });

  it('classifies a structured 429 insufficient_quota response as exhausted quota', () => {
    const source = new OpenAIAPIError(429, { code: 'insufficient_quota' }, 'Quota exhausted', new Headers());
    expect(classify(source)).toBeInstanceOf(APIProviderQuotaExhaustedError);
  });

  it('leaves generic 429 billing messages as rate limits', () => {
    const source = new OpenAIAPIError(429, { message: 'Insufficient balance' }, 'Insufficient balance', new Headers());
    expect(classify(source)).toBeInstanceOf(APIProviderRateLimitError);
  });

  it('still classifies a normal 401 as provider.auth_error', () => {
    const source = new OpenAIAPIError(401, { message: 'Invalid API key' }, '401 Invalid API key', new Headers());
    expect(classify(source).code).toBe(PROVIDER_AUTH_ERROR_CODE);
  });
});
