import type { LlmEndpoint } from '#/llm/request';
import { createRequester } from '#/llm/requester';

import { pythinkerAnthropicFiles, pythinkerFiles } from './files';
import {
  PYTHINKER_DEFAULT_BASE_URL,
  pythinkerAnthropicProtocol,
  pythinkerOpenAIProtocol,
  pythinkerResponsesProtocol,
} from './protocol';

export { classifyPythinkerQuotaError } from './errors';
export { PYTHINKER_DEFAULT_BASE_URL, pythinkerAnthropicProtocol, pythinkerOpenAIProtocol, pythinkerResponsesProtocol } from './protocol';

const pythinkerEndpoint: LlmEndpoint = {
  defaultBaseUrl: PYTHINKER_DEFAULT_BASE_URL,
  files: pythinkerFiles,
};

const pythinkerAnthropicEndpoint: LlmEndpoint = {
  defaultBaseUrl: PYTHINKER_DEFAULT_BASE_URL,
  files: pythinkerAnthropicFiles,
};

export const pythinkerRequester = createRequester().with({
  protocol: { base: pythinkerOpenAIProtocol },
  endpoint: pythinkerEndpoint,
});

export const pythinkerAnthropicRequester = createRequester().with({
  protocol: { base: pythinkerAnthropicProtocol, options: { betaApi: true } },
  endpoint: pythinkerAnthropicEndpoint,
});

export const pythinkerResponsesRequester = createRequester().with({
  protocol: { base: pythinkerResponsesProtocol },
  endpoint: pythinkerEndpoint,
});

export const pythinkerRequesters = {
  openai: pythinkerRequester,
  anthropic: pythinkerAnthropicRequester,
  openai_responses: pythinkerResponsesRequester,
} as const;
