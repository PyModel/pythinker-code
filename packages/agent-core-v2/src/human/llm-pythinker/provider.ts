import { createProvider } from '#/llm/provider/definition';
import { anthropicBetaBase } from '#/llm/requester/bases/anthropic/requester';
import { openAIBase } from '#/llm/requester/bases/openai/requester';
import { openAIResponsesBase } from '#/llm/requester/bases/openai-responses/requester';

import { pythinkerAnthropicTrait, pythinkerConnection, pythinkerOpenAITrait } from './trait';
import { classifyPythinkerQuotaError } from './errors';
import { pythinkerMediaContribution } from './media';

export const pythinkerProvider = createProvider({
  id: 'pythinker',
  protocols: {
    openai: {
      base: openAIBase,
      trait: pythinkerOpenAITrait,
      connection: pythinkerConnection,
      convertError: classifyPythinkerQuotaError,
    },
    anthropic: {
      base: anthropicBetaBase,
      trait: pythinkerAnthropicTrait,
      connection: pythinkerConnection,
      convertError: classifyPythinkerQuotaError,
    },
    openai_responses: {
      base: openAIResponsesBase,
      connection: pythinkerConnection,
      convertError: classifyPythinkerQuotaError,
    },
  },
  media: pythinkerMediaContribution,
});
