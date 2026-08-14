import {
  APIConnectionError,
  APIProviderQuotaExhaustedError,
  emptyUsage,
  isRetryableGenerateError,
} from '@pymodel/kosong';
import { describe, expect, it } from 'vitest';

import type { PythinkerConfig } from '#/config';
import { ErrorCodes, PythinkerError } from '#/errors';
import type { LLM, LLMChatParams, LLMChatResponse } from '#/loop/llm';
import { chatWithRetry, DEFAULT_MAX_RETRY_ATTEMPTS } from '#/loop/retry';
import { ProviderManager } from '#/session/provider-manager';

function okResponse(): LLMChatResponse {
  return { toolCalls: [], usage: emptyUsage() };
}

function makeInput(
  llm: LLM,
  signal: AbortSignal,
): Parameters<typeof chatWithRetry>[0] {
  return {
    llm,
    params: { messages: [], tools: [], signal },
    dispatchEvent: async () => {},
    turnId: 't',
    currentStep: 1,
    stepUuid: 'u',
  };
}

describe('chatWithRetry: terminated stream drops', () => {
  it('uses a ten-attempt default retry budget', () => {
    expect(DEFAULT_MAX_RETRY_ATTEMPTS).toBe(10);
  });

  it('retries an APIConnectionError("terminated") and succeeds on a later attempt', async () => {
    // A mid-stream `terminated` is classified as a retryable APIConnectionError,
    // so an intermittent connection drop should be recovered transparently.
    let calls = 0;
    const llm: LLM = {
      systemPrompt: '',
      modelName: 'mock',
      isRetryableError: (e) => isRetryableGenerateError(e),
      async chat(_params: LLMChatParams): Promise<LLMChatResponse> {
        calls += 1;
        if (calls === 1) throw new APIConnectionError('terminated');
        return okResponse();
      },
    };

    const response = await chatWithRetry(makeInput(llm, new AbortController().signal));

    expect(calls).toBe(2);
    expect(response).toEqual(okResponse());
  });

  it('does NOT retry when the signal is aborted (user ESC), surfacing a clean AbortError', async () => {
    // Even though `terminated` is retryable, a user-aborted request must never
    // be retried: the abort signal is checked before any retry, so it surfaces
    // as an AbortError rather than a provider error.
    let calls = 0;
    const ac = new AbortController();
    ac.abort();

    const llm: LLM = {
      systemPrompt: '',
      modelName: 'mock',
      isRetryableError: (e) => isRetryableGenerateError(e),
      async chat(_params: LLMChatParams): Promise<LLMChatResponse> {
        calls += 1;
        throw new APIConnectionError('terminated');
      },
    };

    await expect(chatWithRetry(makeInput(llm, ac.signal))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(calls).toBe(1);
  });
});

describe('chatWithRetry: quota-exhausted 429 fails fast', () => {
  it('does not retry a quota-exhausted 429', async () => {
    // Same status as a rate limit, but exhausted quota/balance never clears
    // on its own — the error must surface after a single attempt instead of
    // burning the whole default budget.
    let calls = 0;
    const llm: LLM = {
      systemPrompt: '',
      modelName: 'mock',
      isRetryableError: (e) => isRetryableGenerateError(e),
      async chat(): Promise<LLMChatResponse> {
        calls += 1;
        throw new APIProviderQuotaExhaustedError(
          'Your account is suspended due to insufficient balance, please recharge your account',
          null,
        );
      },
    };

    await expect(
      chatWithRetry(makeInput(llm, new AbortController().signal)),
    ).rejects.toMatchObject({ name: 'APIProviderQuotaExhaustedError' });

    expect(calls).toBe(1);
  });
});
