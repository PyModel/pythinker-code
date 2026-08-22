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
    liveMessages = [userMessage('one', 'First entry')];
    queue = {
      active: undefined,
      pending: [
        {
          id: 'two',
          userMessageId: 'two',
          createdAt: '2026-01-01T00:00:00.000Z',
          state: 'pending',
          message: userMessage('two', 'Second entry'),
        },
        {
          id: 'three',
          userMessageId: 'three',
          createdAt: '2026-01-01T00:00:01.000Z',
          state: 'pending',
          message: userMessage('three', 'Third entry'),
        },
      ],
    };

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual([
      'First entry',
      'Second entry',
      'Third entry',
    ]);
  });

  it('keeps the head user messages of a compacted window, skipping elision and summary', async () => {
    liveMessages = [
      userMessage('head', 'Opening question'),
      userMessage('elision', '... omitted ...', { kind: 'injection', variant: 'compaction_elision' }),
      userMessage('tail', 'Latest follow-up'),
      userMessage('summary', ' compaction summary ', { kind: 'compaction_summary' }),
    ];

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual([
      'Opening question',
      'Latest follow-up',
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
    liveMessages = [userMessage('one', 'Same entry')];
    queue = {
      active: {
        id: 'one',
        userMessageId: 'one',
        createdAt: '2026-01-01T00:00:00.000Z',
        state: 'running',
        message: userMessage('one', 'Same entry'),
      },
      pending: [],
    };

    await expect(ix.get(IAgentTitlePromptSource).firstUserPrompts(3)).resolves.toEqual(['Same entry']);
  });

  it('firstTurnExcerpt pairs the opening prompt with the turn’s final assistant text', async () => {
    liveMessages = [
      userMessage('u1', 'Write me a quicksort'),
      assistantMessage('a1-think', [{ type: 'think', think: 'Let me think' }]),
      assistantMessage('a1-text', [{ type: 'text', text: '\u597D\u7684，\u5148\u5199\u4E00\u7248' }]),
      toolMessage('t1', 'tool output'),
      assistantMessage('a2', [
        { type: 'text', text: 'This is the final implementation' },
        { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
      ]),
      userMessage('u2', 'Add a unit test too'),
      assistantMessage('a3', [{ type: 'text', text: 'Second-round reply' }]),
    ];

    await expect(ix.get(IAgentTitlePromptSource).firstTurnExcerpt()).resolves.toEqual({
      user: 'Write me a quicksort',
      assistant: 'This is the final implementation',
    });
  });

  it('firstTurnExcerpt reports a missing assistant reply until the turn ends', async () => {
    liveMessages = [userMessage('u1', 'Just-sent question')];

    await expect(ix.get(IAgentTitlePromptSource).firstTurnExcerpt()).resolves.toEqual({
      user: 'Just-sent question',
      assistant: undefined,
    });
  });

  it('digestExcerpt counts a queued prompt already appended to the context only once', async () => {
    liveMessages = [
      userMessage('one', 'earliest question'),
      assistantMessage('a1', [{ type: 'text', text: 'first reply' }]),
      userMessage('two', 'in-progress question'),
    ];
    queue = {
      active: {
        id: 'two',
        userMessageId: 'two',
        createdAt: '2026-01-01T00:00:01.000Z',
        state: 'running',
        message: userMessage('two', 'in-progress question'),
      },
      pending: [],
    };

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [
        { user: 'earliest question', assistant: 'first reply' },
        { user: 'in-progress question', assistant: undefined },
      ],
    });
  });

  it('digestExcerpt pairs every prompt with its own turn’s final assistant text', async () => {
    liveMessages = [
      userMessage('u1', 'Original goal'),
      assistantMessage('a1', [{ type: 'text', text: 'First-round reply' }]),
      userMessage('u2', 'Midway follow-up'),
      assistantMessage('a2', [{ type: 'text', text: 'Middle reply' }]),
      userMessage('u3', 'Latest request'),
      assistantMessage('a3', [{ type: 'think', think: 'Thinking' }]),
      assistantMessage('a4', [{ type: 'text', text: 'Latest reply body' }]),
    ];

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [
        { user: 'Original goal', assistant: 'First-round reply' },
        { user: 'Midway follow-up', assistant: 'Middle reply' },
        { user: 'Latest request', assistant: 'Latest reply body' },
      ],
    });
  });

  it('digestExcerpt covers every turn, even with a dangling tool-only span', async () => {
    liveMessages = [
      userMessage('u1', 'original goal'),
      assistantMessage('a1', [{ type: 'text', text: 'first reply' }]),
      userMessage('u2', 'second topic'),
      assistantMessage('a2', [{ type: 'think', think: 'thinking only' }]),
      userMessage('u3', 'third topic'),
      assistantMessage('a3', [{ type: 'text', text: 'third reply' }]),
      userMessage('u4', 'latest topic'),
      assistantMessage('a4', [{ type: 'text', text: 'latest reply' }]),
    ];

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [
        { user: 'original goal', assistant: 'first reply' },
        { user: 'second topic', assistant: undefined },
        { user: 'third topic', assistant: 'third reply' },
        { user: 'latest topic', assistant: 'latest reply' },
      ],
    });
  });

  it('digestExcerpt keeps a single-prompt conversation and dangling questions', async () => {
    liveMessages = [
      userMessage('u1', 'Only question'),
      assistantMessage('a1', [{ type: 'text', text: 'Only reply' }]),
      userMessage('u2', 'New question still awaiting a reply'),
    ];

    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [
        { user: 'Only question', assistant: 'Only reply' },
        { user: 'New question still awaiting a reply', assistant: undefined },
      ],
    });

    liveMessages = [userMessage('u1', 'Only question')];
    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({
      turns: [{ user: 'Only question', assistant: undefined }],
    });

    liveMessages = [];
    await expect(ix.get(IAgentTitlePromptSource).digestExcerpt()).resolves.toEqual({ turns: [] });
  });
});
