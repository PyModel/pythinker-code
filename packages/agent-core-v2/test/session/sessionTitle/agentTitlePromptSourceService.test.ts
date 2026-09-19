import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { createServices, type TestInstantiationService } from '#/_base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import type { ContentPart } from '#human/llm/message';
import { IAgentTitlePromptSource } from '#/session/sessionTitle/agentTitlePromptSource';
import { AgentTitlePromptSourceService } from '#/session/sessionTitle/agentTitlePromptSourceService';

const USER_ORIGIN: ContextMessage['origin'] = { kind: 'user' };

function userMessage(
  id: string,
  text: string,
  origin: ContextMessage['origin'] = USER_ORIGIN,
): ContextMessage {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
    origin,
  };
}

function assistantMessage(id: string, parts: ContentPart[]): ContextMessage {
  return { id, role: 'assistant', content: parts, toolCalls: [] };
}

function toolMessage(id: string, text: string): ContextMessage {
  return { id, role: 'tool', content: [{ type: 'text', text }], toolCalls: [] };
}

describe('AgentTitlePromptSource', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let liveMessages: readonly ContextMessage[];
  let queue: ReturnType<IAgentPromptService['list']>;

  beforeEach(() => {
    liveMessages = [];
    queue = { active: undefined, pending: [], launching: false };
    disposables = new DisposableStore();
    ix = createServices(disposables, {
      additionalServices: (reg) => {
        reg.definePartialInstance(IAgentContextMemoryService, { get: () => liveMessages });
        reg.definePartialInstance(IAgentPromptService, { list: () => queue });
        reg.define(IAgentTitlePromptSource, AgentTitlePromptSourceService);
      },
    });
  });

  afterEach(() => {
    disposables.dispose();
  });

  it('returns the first three prompts from the live context and queue in order', async () => {
    liveMessages = [userMessage('one', 'zh')];
    queue = {
      active: undefined,
      launching: false,
      pending: [
        {
          id: 'two',
          userMessageId: 'two',
          createdAt: '2026-01-01T00:00:00.000Z',
          state: 'pending',
          message: userMessage('two', 'zh'),
        },
        {
          id: 'three',
          userMessageId: 'three',
          createdAt: '2026-01-01T00:00:01.000Z',
          state: 'pending',
          message: userMessage('three', 'zh'),
        },
      ],
    };

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual([
      'zh',
      'zh',
      'zh',
    ]);
  });

  it('keeps the head user messages of a compacted window, skipping elision and summary', async () => {
    liveMessages = [
      userMessage('head', 'zh'),
      userMessage('elision', '... omitted ...', { kind: 'injection', variant: 'compaction_elision' }),
      userMessage('tail', 'zh'),
      userMessage('summary', ' compaction summary ', { kind: 'compaction_summary' }),
    ];

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual([
      'zh',
      'zh',
    ]);
  });

  it('returns no title prompts when history contains only slash activations', async () => {
    liveMessages = [
      userMessage('skill', 'expanded skill instructions', {
        kind: 'skill_activation',
        activationId: 'skill-1',
        skillName: 'compact',
        trigger: 'user-slash',
      }),
      userMessage('plugin', 'expanded plugin instructions', {
        kind: 'plugin_command',
        activationId: 'plugin-1',
        pluginId: 'example-plugin',
        commandName: 'run',
        trigger: 'user-slash',
      }),
    ];

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual([]);
  });

  it('counts a queued prompt already appended to the context only once', async () => {
    liveMessages = [userMessage('one', 'zh')];
    queue = {
      launching: false,
      active: {
        id: 'one',
        userMessageId: 'one',
        createdAt: '2026-01-01T00:00:00.000Z',
        state: 'running',
        message: userMessage('one', 'zh'),
      },
      pending: [],
    };

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual(['zh']);
  });

  it('firstTurnExcerpt pairs the opening prompt with the turn’s final assistant text', async () => {
    liveMessages = [
      userMessage('u1', 'zh'),
      assistantMessage('a1-think', [{ type: 'think', think: 'zh' }]),
      assistantMessage('a1-text', [{ type: 'text', text: 'zhzh' }]),
      toolMessage('t1', 'tool output'),
      assistantMessage('a2', [
        { type: 'text', text: 'zh' },
        { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
      ]),
      userMessage('u2', 'zh'),
      assistantMessage('a3', [{ type: 'text', text: 'zh' }]),
    ];

    await expect(ix.get(IAgentTitlePromptSource).firstTurnExcerpt()).resolves.toEqual({
      user: 'zh',
      assistant: 'zh',
    });
  });

  it('firstTurnExcerpt reports a missing assistant reply until the turn ends', async () => {
    liveMessages = [userMessage('u1', 'zh')];

    await expect(ix.get(IAgentTitlePromptSource).firstTurnExcerpt()).resolves.toEqual({
      user: 'zh',
      assistant: undefined,
    });
  });

  it('digestExcerpt counts a queued prompt already appended to the context only once', async () => {
    liveMessages = [
      userMessage('one', 'zh'),
      assistantMessage('a1', [{ type: 'text', text: 'zh' }]),
      userMessage('two', 'zh'),
    ];
    queue = {
      launching: false,
      active: {
        id: 'two',
        userMessageId: 'two',
        createdAt: '2026-01-01T00:00:01.000Z',
        state: 'running',
        message: userMessage('two', 'zh'),
      },
      pending: [],
    };

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [
        { user: 'zh', assistant: 'zh' },
        { user: 'zh', assistant: undefined },
      ],
    });
  });

  it('digestExcerpt pairs every prompt with its own turn’s final assistant text', async () => {
    liveMessages = [
      userMessage('u1', 'zh'),
      assistantMessage('a1', [{ type: 'text', text: 'zh' }]),
      userMessage('u2', 'zh'),
      assistantMessage('a2', [{ type: 'text', text: 'zh' }]),
      userMessage('u3', 'zh'),
      assistantMessage('a3', [{ type: 'think', think: 'zh' }]),
      assistantMessage('a4', [{ type: 'text', text: 'zh' }]),
    ];

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [
        { user: 'zh', assistant: 'zh' },
        { user: 'zh', assistant: 'zh' },
        { user: 'zh', assistant: 'zh' },
      ],
    });
  });

  it('digestExcerpt covers every turn, even with a dangling tool-only span', async () => {
    liveMessages = [
      userMessage('u1', 'zh'),
      assistantMessage('a1', [{ type: 'text', text: 'zh' }]),
      userMessage('u2', 'zh'),
      assistantMessage('a2', [{ type: 'think', think: 'zh' }]),
      userMessage('u3', 'zh'),
      assistantMessage('a3', [{ type: 'text', text: 'zh' }]),
      userMessage('u4', 'zh'),
      assistantMessage('a4', [{ type: 'text', text: 'zh' }]),
    ];

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [
        { user: 'zh', assistant: 'zh' },
        { user: 'zh', assistant: undefined },
        { user: 'zh', assistant: 'zh' },
        { user: 'zh', assistant: 'zh' },
      ],
    });
  });

  it('digestExcerpt keeps a single-prompt conversation and dangling questions', async () => {
    liveMessages = [
      userMessage('u1', 'zh'),
      assistantMessage('a1', [{ type: 'text', text: 'zh' }]),
      userMessage('u2', 'zh'),
    ];

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [
        { user: 'zh', assistant: 'zh' },
        { user: 'zh', assistant: undefined },
      ],
    });

    liveMessages = [userMessage('u1', 'zh')];
    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [{ user: 'zh', assistant: undefined }],
    });

    liveMessages = [];
    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({ turns: [] });
  });
});
