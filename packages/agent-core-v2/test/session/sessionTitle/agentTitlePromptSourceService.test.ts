import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { createServices, type TestInstantiationService } from '#/_base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import type { ContentPart } from '#/kosong/contract/message';
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
    queue = { active: undefined, pending: [] };
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
    liveMessages = [userMessage('one', '\u7B2C\u4E00\u6761')];
    queue = {
      active: undefined,
      pending: [
        {
          id: 'two',
          userMessageId: 'two',
          createdAt: '2026-01-01T00:00:00.000Z',
          state: 'pending',
          message: userMessage('two', '\u7B2C\u4E8C\u6761'),
        },
        {
          id: 'three',
          userMessageId: 'three',
          createdAt: '2026-01-01T00:00:01.000Z',
          state: 'pending',
          message: userMessage('three', '\u7B2C\u4E09\u6761'),
        },
      ],
    };

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual([
      '\u7B2C\u4E00\u6761',
      '\u7B2C\u4E8C\u6761',
      '\u7B2C\u4E09\u6761',
    ]);
  });

  it('keeps the head user messages of a compacted window, skipping elision and summary', async () => {
    liveMessages = [
      userMessage('head', '\u5F00\u573A\u63D0\u95EE'),
      userMessage('elision', '... omitted ...', { kind: 'injection', variant: 'compaction_elision' }),
      userMessage('tail', '\u6700\u8FD1\u7684\u8FFD\u95EE'),
      userMessage('summary', ' compaction summary ', { kind: 'compaction_summary' }),
    ];

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual([
      '\u5F00\u573A\u63D0\u95EE',
      '\u6700\u8FD1\u7684\u8FFD\u95EE',
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
    liveMessages = [userMessage('one', '\u540C\u4E00\u6761')];
    queue = {
      active: {
        id: 'one',
        userMessageId: 'one',
        createdAt: '2026-01-01T00:00:00.000Z',
        state: 'running',
        message: userMessage('one', '\u540C\u4E00\u6761'),
      },
      pending: [],
    };

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual(['\u540C\u4E00\u6761']);
  });

  it('firstTurnExcerpt pairs the opening prompt with the turn’s final assistant text', async () => {
    liveMessages = [
      userMessage('u1', '\u5E2E\u6211\u5199\u4E00\u4E2A\u5FEB\u6392'),
      assistantMessage('a1-think', [{ type: 'think', think: '\u8BA9\u6211\u60F3\u60F3' }]),
      assistantMessage('a1-text', [{ type: 'text', text: '\u597D\u7684，\u5148\u5199\u4E00\u7248' }]),
      toolMessage('t1', 'tool output'),
      assistantMessage('a2', [
        { type: 'text', text: '\u8FD9\u662F\u6700\u7EC8\u7248\u5B9E\u73B0' },
        { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
      ]),
      userMessage('u2', '\u518D\u52A0\u4E2A\u5355\u6D4B'),
      assistantMessage('a3', [{ type: 'text', text: '\u7B2C\u4E8C\u8F6E\u7684\u56DE\u590D' }]),
    ];

    await expect(ix.get(IAgentTitlePromptSource).firstTurnExcerpt()).resolves.toEqual({
      user: '\u5E2E\u6211\u5199\u4E00\u4E2A\u5FEB\u6392',
      assistant: '\u8FD9\u662F\u6700\u7EC8\u7248\u5B9E\u73B0',
    });
  });

  it('firstTurnExcerpt reports a missing assistant reply until the turn ends', async () => {
    liveMessages = [userMessage('u1', '\u521A\u53D1\u7684\u95EE\u9898')];

    await expect(ix.get(IAgentTitlePromptSource).firstTurnExcerpt()).resolves.toEqual({
      user: '\u521A\u53D1\u7684\u95EE\u9898',
      assistant: undefined,
    });
  });

  it('digestExcerpt anchors the first prompt and lands on the latest turn', async () => {
    liveMessages = [
      userMessage('u1', '\u6700\u521D\u7684\u76EE\u6807'),
      assistantMessage('a1', [{ type: 'text', text: '\u7B2C\u4E00\u8F6E\u56DE\u7B54' }]),
      userMessage('u2', '\u4E2D\u9014\u8FFD\u95EE'),
      assistantMessage('a2', [{ type: 'text', text: '\u4E2D\u95F4\u56DE\u7B54' }]),
      userMessage('u3', '\u6700\u8FD1\u7684\u8981\u6C42'),
      assistantMessage('a3', [{ type: 'think', think: '\u601D\u8003\u4E2D' }]),
      assistantMessage('a4', [{ type: 'text', text: '\u6700\u65B0\u6B63\u6587' }]),
    ];

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      firstUser: '\u6700\u521D\u7684\u76EE\u6807',
      lastUser: '\u6700\u8FD1\u7684\u8981\u6C42',
      assistant: '\u6700\u65B0\u6B63\u6587',
    });
  });

  it('digestExcerpt collapses a single-prompt conversation and skips dangling questions', async () => {
    liveMessages = [
      userMessage('u1', '\u552F\u4E00\u7684\u95EE\u9898'),
      assistantMessage('a1', [{ type: 'text', text: '\u552F\u4E00\u7684\u56DE\u7B54' }]),
      userMessage('u2', '\u8FD8\u6CA1\u5F97\u5230\u56DE\u590D\u7684\u65B0\u95EE\u9898'),
    ];

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      firstUser: '\u552F\u4E00\u7684\u95EE\u9898',
      lastUser: '\u8FD8\u6CA1\u5F97\u5230\u56DE\u590D\u7684\u65B0\u95EE\u9898',
      assistant: '\u552F\u4E00\u7684\u56DE\u7B54',
    });

    liveMessages = [userMessage('u1', '\u552F\u4E00\u7684\u95EE\u9898')];
    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      firstUser: '\u552F\u4E00\u7684\u95EE\u9898',
      lastUser: undefined,
      assistant: undefined,
    });
  });
});
