import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentTitlePromptSource } from '#/session/sessionTitle/agentTitlePromptSource';

import { createTestAgent, type TestAgentContext } from '../../harness';

describe('title excerpts over the real context memory', () => {
  let ctx: TestAgentContext;

  beforeEach(() => {
    ctx = createTestAgent();
  });

  afterEach(async () => {
    await ctx.dispose();
  });

  it('first_turn pairs the opening prompt with the folded assistant final text', async () => {
    const context = ctx.get(IAgentContextMemoryService);
    context.append({
      role: 'user',
      content: [{ type: 'text', text: '\u5E2E\u6211\u90E8\u7F72\u8FD9\u4E2A\u670D\u52A1' }],
      toolCalls: [],
      origin: { kind: 'user' },
    });
    context.appendLoopEvent({ type: 'step.begin', uuid: 's1' });
    context.appendLoopEvent({
      type: 'content.part',
      stepUuid: 's1',
      part: { type: 'text', text: '\u5148\u770B\u4E00\u4E0B\u914D\u7F6E' },
    });
    context.appendLoopEvent({
      type: 'tool.call',
      stepUuid: 's1',
      toolCallId: 'c1',
      name: 'Read',
      args: {},
    });
    context.appendLoopEvent({
      type: 'tool.result',
      toolCallId: 'c1',
      result: { output: 'file contents', isError: false },
    });
    context.appendLoopEvent({ type: 'step.end', uuid: 's1' });
    context.appendLoopEvent({ type: 'step.begin', uuid: 's2' });
    context.appendLoopEvent({
      type: 'content.part',
      stepUuid: 's2',
      part: { type: 'think', think: '\u6536\u5C3E' },
    });
    context.appendLoopEvent({
      type: 'content.part',
      stepUuid: 's2',
      part: { type: 'text', text: '\u90E8\u7F72\u5B8C\u6210，\u670D\u52A1\u5728 8080 \u7AEF\u53E3' },
    });
    context.appendLoopEvent({ type: 'step.end', uuid: 's2' });

    const source = ctx.get(IAgentTitlePromptSource);
    await expect(source.firstTurnExcerpt()).resolves.toEqual({
      user: '\u5E2E\u6211\u90E8\u7F72\u8FD9\u4E2A\u670D\u52A1',
      assistant: '\u90E8\u7F72\u5B8C\u6210，\u670D\u52A1\u5728 8080 \u7AEF\u53E3',
    });
    await expect(source.digestExcerpt()).resolves.toEqual({
      turns: [{
        user: '\u5E2E\u6211\u90E8\u7F72\u8FD9\u4E2A\u670D\u52A1',
        assistant: '\u90E8\u7F72\u5B8C\u6210，\u670D\u52A1\u5728 8080 \u7AEF\u53E3',
      }],
    });
  });

  it('first_turn reports no assistant text while the turn has not produced any', async () => {
    const context = ctx.get(IAgentContextMemoryService);
    context.append({
      role: 'user',
      content: [{ type: 'text', text: '\u521A\u53D1\u7684\u95EE\u9898' }],
      toolCalls: [],
      origin: { kind: 'user' },
    });

    await expect(ctx.get(IAgentTitlePromptSource).firstTurnExcerpt()).resolves.toEqual({
      user: '\u521A\u53D1\u7684\u95EE\u9898',
      assistant: undefined,
    });
  });

  it('excludes bundled skill blocks from the excerpt of a bundled prompt', async () => {
    const context = ctx.get(IAgentContextMemoryService);
    context.append({
      role: 'user',
      content: [
        { type: 'text', text: 'User activated the skill "review". Follow the loaded skill instructions.' },
        { type: 'text', text: 'User activated the skill "security". Follow the loaded skill instructions.' },
        { type: 'text', text: '\u68C0\u67E5\u8FD9\u6B21\u6539\u52A8\u7684\u6B63\u786E\u6027' },
      ],
      toolCalls: [],
      origin: {
        kind: 'user',
        skillActivations: [
          { activationId: 'act-1', skillName: 'review' },
          { activationId: 'act-2', skillName: 'security' },
        ],
      },
    });

    const source = ctx.get(IAgentTitlePromptSource);
    await expect(source.firstTurnExcerpt()).resolves.toEqual({
      user: '\u68C0\u67E5\u8FD9\u6B21\u6539\u52A8\u7684\u6B63\u786E\u6027',
      assistant: undefined,
    });
    await expect(source.firstUserPrompts(5)).resolves.toEqual(['\u68C0\u67E5\u8FD9\u6B21\u6539\u52A8\u7684\u6B63\u786E\u6027']);
  });
});
