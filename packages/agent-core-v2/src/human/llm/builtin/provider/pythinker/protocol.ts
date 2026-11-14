import type { Message, ToolDescription, ContentPart } from '#/llm/message';
import { providerImagePolicy } from '#/llm/protocol/kit/media';
import { requestIdFromHeader } from '#/llm/protocol/kit/http';
import type { Decoder } from '#/llm/protocol/protocol';
import type { LlmModelSpec, ThinkingRequestOptions } from '#/llm/request';
import type { LlmRemoteErrorMessage } from '#/llm/response';
import {
  anthropicProtocol,
  CONTEXT_MANAGEMENT_BETA,
  lowerMessage as lowerAnthropicMessage,
} from '#/llm/builtin/protocol/anthropic/index';
import {
  lowerMessage as lowerOpenAIMessage,
  openAIModelLegality,
  openAIProtocol,
  resolveOpenAIReasoningKey,
  type OpenAINativeMessage,
  type OpenAINativeToolCall,
  type OpenAILowerContext,
  type OpenAIRawChunk,
  type OpenAIRawUsage,
} from '#/llm/builtin/protocol/openai/index';
import {
  openAIResponsesModelLegality,
  openAIResponsesProtocol,
} from '#/llm/builtin/protocol/openai-responses/index';

import { classifyPythinkerQuotaError } from './errors';
import { normalizePythinkerToolSchema } from './schema';

export const PYTHINKER_DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';

export interface PythinkerThinkingConfig {
  type?: 'enabled' | 'disabled';
  effort?: string;
  keep?: unknown;
  [key: string]: unknown;
}

function isEffectivelyEmptyContent(parts: readonly ContentPart[]): boolean {
  for (const part of parts) {
    if (part.type !== 'text') {
      return false;
    }
    if (part.text.trim() !== '') {
      return false;
    }
  }
  return true;
}

function convertPythinkerTool(tool: ToolDescription): Record<string, unknown> {
  if (tool.name.startsWith('$')) {
    return {
      type: 'builtin_function',
      function: { name: tool.name },
    };
  }
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: normalizePythinkerToolSchema(tool.parameters),
    },
  };
}

function fillPythinkerMaxOutputTokens(
  model: LlmModelSpec,
  usedTokens: number | undefined,
): number | undefined {
  const window = model.maxContextSize;
  if (window === undefined || window <= 0 || usedTokens === undefined) return undefined;
  return Math.max(1, window - usedTokens);
}

function pythinkerOpenAIThinkingParams(thinking: ThinkingRequestOptions): Record<string, unknown> {
  const config: PythinkerThinkingConfig =
    thinking.effort === 'off'
      ? { type: 'disabled' }
      : thinking.effort === 'on'
        ? { type: 'enabled' }
        : { type: 'enabled', effort: thinking.effort };
  if (thinking.keep !== undefined) {
    config.keep = thinking.keep;
  }
  return { thinking: config };
}

function applyPythinkerMessageExtras(
  message: Message,
  native: OpenAINativeMessage,
): OpenAINativeMessage {
  const record = native as Partial<OpenAINativeMessage> & Record<string, unknown>;
  if (message.role === 'assistant' && message.toolCalls.length > 0) {
    const nonThinkParts = message.content.filter((part) => part.type !== 'think');
    if (isEffectivelyEmptyContent(nonThinkParts)) {
      delete record['content'];
    }
  }
  if (message.role === 'system' && message.tools !== undefined && message.tools.length > 0) {
    record['tools'] = message.tools.map((tool) => convertPythinkerTool(tool));
  }
  const convertedToolCalls = record['tool_calls'];
  if (message.role === 'assistant' && Array.isArray(convertedToolCalls)) {
    message.toolCalls.forEach((toolCall, index) => {
      if (toolCall.extras === undefined) {
        return;
      }
      const out: (OpenAINativeToolCall & { extras?: unknown }) | undefined =
        convertedToolCalls[index];
      if (out !== undefined) {
        out.extras = toolCall.extras;
      }
    });
  }
  return native;
}

function hoistPythinkerUsage(chunk: OpenAIRawChunk): OpenAIRawChunk {
  if (chunk.usage !== null && chunk.usage !== undefined && typeof chunk.usage === 'object') {
    return chunk;
  }
  const firstChoice = chunk.choices?.[0] as { usage?: OpenAIRawUsage | null } | undefined;
  const choiceUsage = firstChoice?.usage;
  if (choiceUsage === null || choiceUsage === undefined || typeof choiceUsage !== 'object') {
    return chunk;
  }
  return { ...chunk, usage: choiceUsage };
}

const pythinkerImageMimes = providerImagePolicy('pythinker').acceptedMimes;

function withPythinkerErrors(base: { readonly decodeError: (error: unknown) => LlmRemoteErrorMessage }) {
  return (error: unknown) => classifyPythinkerQuotaError(error) ?? base.decodeError(error);
}

export const pythinkerOpenAIProtocol = openAIProtocol.with((base) => ({
  requestId: requestIdFromHeader('x-trace-id'),
  legality: {
    ...openAIModelLegality,
    fillMaxOutputTokens: fillPythinkerMaxOutputTokens,
  },
  thinking: (thinking) => (thinking === undefined ? undefined : pythinkerOpenAIThinkingParams(thinking)),
  maxOutputTokens: (cap) => ({ max_completion_tokens: cap }),
  tool: convertPythinkerTool,
  message: (message, module) => {
    const ctx: OpenAILowerContext = {
      reasoningKey: resolveOpenAIReasoningKey(
        module.content.messages,
        module.options?.reasoningKey,
        module.options?.detectedReasoningKey,
      ),
      preserveThinking:
        module.model.thinking?.keep === 'all' && module.model.thinking?.effort !== 'off',
      toolMessageConversion: module.options?.toolMessageConversion ?? 'keep_parts',
    };
    return lowerOpenAIMessage(message, ctx).map((native) => applyPythinkerMessageExtras(message, native));
  },
  decoder: (module, sink): Decoder<OpenAIRawChunk> => {
    const inner = base.decoder(module, sink);
    return {
      push: (chunk) => inner.push(hoistPythinkerUsage(chunk)),
      end: () => inner.end(),
    };
  },
  flatten: (native, module) => {
    const { extra_body: extraBody, ...extras } = module.options?.extras ?? {};
    const options = { ...module.options, extras: { ...extras, ...extraBody } };
    return base.flatten(native, { ...module, options });
  },
  decodeError: withPythinkerErrors(base),
}));

export const pythinkerAnthropicProtocol = anthropicProtocol.with((base) => ({
  requestId: requestIdFromHeader('x-trace-id'),
  thinking: (thinking) =>
    thinking === undefined
      ? undefined
      : thinking.effort === 'off'
        ? { thinking: { type: 'disabled' }, betaFeatures: [CONTEXT_MANAGEMENT_BETA] }
        : {
            thinking: { type: 'enabled' },
            output_config: thinking.effort === 'on' ? undefined : { effort: thinking.effort },
            betaFeatures: [CONTEXT_MANAGEMENT_BETA],
          },
  message: (message) => lowerAnthropicMessage(message, pythinkerImageMimes),
  decodeError: withPythinkerErrors(base),
}));

export const pythinkerResponsesProtocol = openAIResponsesProtocol.with((base) => ({
  requestId: requestIdFromHeader('x-trace-id'),
  legality: {
    ...openAIResponsesModelLegality,
    fillMaxOutputTokens: fillPythinkerMaxOutputTokens,
  },
  decodeError: withPythinkerErrors(base),
}));
