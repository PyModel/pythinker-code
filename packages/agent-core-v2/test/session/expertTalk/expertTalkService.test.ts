import { afterEach, describe, expect, it, vi } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import {
  resetUnexpectedErrorHandler,
  setUnexpectedErrorHandler,
} from '#/_base/errors/unexpectedError';
import { Event } from '#/_base/event';
import { IEventBus } from '#/app/event/eventBus';
import { TurnEnded } from '#/agent/loop/turnOps';
import { IAgentRuntimeService } from '#/agent/runtimeBinding/agentRuntime';
import { IFlagService } from '#/app/flag/flag';
import { emptyUsage } from '#/kosong/contract/usage';
import { APIEmptyResponseError } from '#/kosong/contract/errors';
import { AppendLogStore } from '#/persistence/backends/node-fs/appendLogStore';
import { IAppendLogStore } from '#/persistence/interface/appendLogStore';
import { IEventDispatcher } from '#/state/eventDispatcher';
import {
  IAgentLifecycleService,
  MAIN_AGENT_ID,
} from '#/session/agentLifecycle/agentLifecycle';
import {
  ISessionExpertTalkService,
  type ExpertTalkRunStatus,
} from '#/session/expertTalk/expertTalk';
import { EXPERT_TALK_FLAG_ID } from '#/session/expertTalk/flag';
import { expertTalkStateKey } from '#/session/expertTalk/expertTalkService';
import { ISessionStateService } from '#/session/state/sessionState';
import {
  IRuntimeResolver,
  IWorkspaceInstanceManager,
  type WorkspaceInstanceChange,
} from '#/workspace/workspaceInstance/workspaceInstanceManager';

import { stubFlag } from '../../app/flag/stubs';
import {
  appService,
  createTestAgent,
  llmGenerateServices,
  sessionServices,
  type TestAgentContext,
} from '../../harness';

const TERMINAL_STATUSES = new Set<ExpertTalkRunStatus>([
  'COMPLETED',
  'CANCELLED',
  'FAILED_OPENING',
  'FAILED_REVIEW',
  'FAILED_FUSION',
  'INTERRUPTED',
]);

type GenerateResponse = Parameters<typeof llmGenerateServices>[0];

function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function successfulGenerator(): GenerateResponse {
  let callId = 0;
  return async (_chat, _systemPrompt, _tools, history) => {
    callId += 1;
    const input = history
      .flatMap((message) => message.content)
      .map((part) => part.type === 'text' ? part.text : '')
      .join('\n');
    const text = input.includes('EXPERT TALK FUSION CONTRACT')
      ? JSON.stringify({
          version: 'expert_talk_result/v1',
          answer: 'Use the verified result.',
          notes: {
            consensus: ['Both experts agree.'],
            divergence: [],
            uncertainty: [],
            attribution: [],
          },
        })
      : input.includes('REVIEW OF')
        ? '## Agreement\nVerified.\n\n## Rejection and missing points\nNone.\n\n## Revised position\nUse the verified result.'
        : 'Position\n\nUse the verified result.';
    return {
      id: `answer-${String(callId)}`,
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text }],
        toolCalls: [],
      },
      usage: emptyUsage(),
      finishReason: 'completed' as const,
      rawFinishReason: 'stop',
    };
  };
}

function createDiscussionAgent(generate: GenerateResponse): TestAgentContext {
  let result!: TestAgentContext;
  const runtimeResolver: IRuntimeResolver = {
    _serviceBrand: undefined,
    inspect: () => result.get(IAgentRuntimeService).inspect(),
    acquire: (_binding, required) => result.get(IAgentRuntimeService).acquire(required),
  };
  result = createTestAgent(
    appService(IFlagService, stubFlag((id) => id === EXPERT_TALK_FLAG_ID)),
    appService(IAppendLogStore, new SyncDescriptor(AppendLogStore)),
    sessionServices((reg) => {
      reg.defineInstance(IRuntimeResolver, runtimeResolver);
      reg.definePartialInstance(IWorkspaceInstanceManager, {
        onDidChange: Event.None as Event<WorkspaceInstanceChange>,
        get: () => undefined,
      });
    }),
    llmGenerateServices(generate),
  );
  const capabilities = {
    image_in: false,
    video_in: false,
    audio_in: false,
    thinking: false,
    tool_use: true,
    max_context_tokens: 1_000_000,
  };
  result.configureRuntimeModel({ type: 'pythinker', model: 'lead-model' }, capabilities);
  result.configureRuntimeModel({ type: 'pythinker', model: 'peer-model' }, capabilities);
  return result;
}

async function startDiscussion(ctx: TestAgentContext, prompt: string) {
  const service = ctx.get(ISessionExpertTalkService);
  await service.ready;
  await service.configure({
    fusionLeadModelId: 'lead-model',
    peerModelId: 'peer-model',
  });
  const arm = service.arm('test-client');
  const started = await service.start({
    armId: arm.armId,
    clientId: 'test-client',
    prompt,
  });
  return { service, started };
}

describe('SessionExpertTalkService', () => {
  let ctx: TestAgentContext;

  afterEach(async () => {
    await ctx.dispose();
    vi.restoreAllMocks();
    resetUnexpectedErrorHandler();
  });

  it('reserves the final stage request for an answer after tool research', async () => {
    let callId = 0;
    const toolCounts: number[] = [];
    const runtimeResolver: IRuntimeResolver = {
      _serviceBrand: undefined,
      inspect: () => ctx.get(IAgentRuntimeService).inspect(),
      acquire: (_binding, required) => ctx.get(IAgentRuntimeService).acquire(required),
    };
    ctx = createTestAgent(
      appService(IFlagService, stubFlag((id) => id === EXPERT_TALK_FLAG_ID)),
      appService(IAppendLogStore, new SyncDescriptor(AppendLogStore)),
      sessionServices((reg) => {
        reg.defineInstance(IRuntimeResolver, runtimeResolver);
        reg.definePartialInstance(IWorkspaceInstanceManager, {
          onDidChange: Event.None as Event<WorkspaceInstanceChange>,
          get: () => undefined,
        });
      }),
      llmGenerateServices(async (_chat, _systemPrompt, tools, history) => {
        toolCounts.push(tools.length);
        callId += 1;
        if (tools.length > 0) {
          return {
            id: `research-${String(callId)}`,
            message: {
              role: 'assistant' as const,
              content: [],
              toolCalls: [{
                type: 'function' as const,
                id: `read-${String(callId)}`,
                name: 'Read',
                arguments: JSON.stringify({ path: 'package.json', n_lines: 1 }),
              }],
            },
            usage: { ...emptyUsage(), output: 6_172 },
            finishReason: 'tool_calls' as const,
            rawFinishReason: 'tool_calls',
          };
        }
        const input = history
          .flatMap((message) => message.content)
          .map((part) => part.type === 'text' ? part.text : '')
          .join('\n');
        const text = input.includes('EXPERT TALK FUSION CONTRACT')
          ? JSON.stringify({
              version: 'expert_talk_result/v1',
              answer: 'Use the verified result.',
              notes: {
                consensus: ['Both experts agree.'],
                divergence: [],
                uncertainty: [],
                attribution: [],
              },
            })
          : '## Agreement\nVerified.\n\n## Rejection and missing points\nNone.\n\n## Revised position\nUse the verified result.';
        return {
          id: `answer-${String(callId)}`,
          message: {
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text }],
            toolCalls: [],
          },
          usage: { ...emptyUsage(), output: 6_172 },
          finishReason: 'completed' as const,
          rawFinishReason: 'stop',
        };
      }),
    );
    const capabilities = {
      image_in: false,
      video_in: false,
      audio_in: false,
      thinking: false,
      tool_use: true,
      max_context_tokens: 1_000_000,
    };
    ctx.configureRuntimeModel({ type: 'pythinker', model: 'lead-model' }, capabilities);
    ctx.configureRuntimeModel({ type: 'pythinker', model: 'peer-model' }, capabilities);
    const service = ctx.get(ISessionExpertTalkService);
    await service.ready;
    await service.configure({
      fusionLeadModelId: 'lead-model',
      peerModelId: 'peer-model',
    });
    const arm = service.arm('test-client');
    const started = await service.start({
      armId: arm.armId,
      clientId: 'test-client',
      prompt: 'Compare the verified options.',
    });

    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    }, { timeout: 5_000 });

    const run = service.getRun(started.runId);
    expect(
      run.status,
      JSON.stringify({ toolCounts, artifacts: run.artifacts, error: run.error }),
    ).toBe('COMPLETED');
    expect(toolCounts.filter((count) => count === 0)).toHaveLength(5);
    expect(run.artifacts).toMatchObject({
      leadOpening: { status: 'completed', requestCount: 3 },
      peerOpening: { status: 'completed', requestCount: 3 },
      leadReview: { status: 'completed', requestCount: 1 },
      peerReview: { status: 'completed', requestCount: 1 },
      fusion: { status: 'completed', requestCount: 1 },
    });
  });

  it('keeps a second synthesis request after a late tool call', async () => {
    let callId = 0;
    let peerSynthesisRequests = 0;
    ctx = createDiscussionAgent(async (chat, _systemPrompt, tools, history) => {
      callId += 1;
      const input = history
        .flatMap((message) => message.content)
        .map((part) => part.type === 'text' ? part.text : '')
        .join('\n');
      const peerOpening = chat.modelName === 'peer-model'
        && input.includes('EXPERT TALK OPENING CONTRACT');
      if (peerOpening && (tools.length > 0 || peerSynthesisRequests++ === 0)) {
        return {
          id: `research-${String(callId)}`,
          message: {
            role: 'assistant' as const,
            content: [],
            toolCalls: [{
              type: 'function' as const,
              id: `read-${String(callId)}`,
              name: 'Read',
              arguments: JSON.stringify({ path: 'package.json', n_lines: 1 }),
            }],
          },
          usage: emptyUsage(),
          finishReason: 'tool_calls' as const,
          rawFinishReason: 'tool_calls',
        };
      }
      const text = input.includes('EXPERT TALK FUSION CONTRACT')
        ? JSON.stringify({
            version: 'expert_talk_result/v1',
            answer: 'Use the verified result.',
            notes: {
              consensus: ['Both experts agree.'],
              divergence: [],
              uncertainty: [],
              attribution: [],
            },
          })
        : input.includes('REVIEW OF')
          ? '## Agreement\nVerified.\n\n## Rejection and missing points\nNone.\n\n## Revised position\nUse the verified result.'
          : '## Position\nUse the verified result.\n\n## Case\nEvidence supports it.\n\n## Decision criteria\nPrefer verified behavior.\n\n## Risks and uncertainty\nNone material.\n\n## Recommended answer\nUse the verified result.';
      return {
        id: `answer-${String(callId)}`,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed' as const,
        rawFinishReason: 'stop',
      };
    });
    const { service, started } = await startDiscussion(
      ctx,
      'Recover after a late synthesis tool call.',
    );

    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    }, { timeout: 5_000 });

    expect(service.getRun(started.runId)).toMatchObject({
      status: 'COMPLETED',
      artifacts: {
        peerOpening: { status: 'completed', requestCount: 4, toolCallCount: 2 },
      },
    });
    expect(peerSynthesisRequests).toBeGreaterThanOrEqual(2);
  });

  it('uses the remaining stage attempt budget when a final response is empty', async () => {
    let callId = 0;
    let peerEmptyResponses = 0;
    ctx = createDiscussionAgent(async (chat, _systemPrompt, tools, history) => {
      callId += 1;
      const input = history
        .flatMap((message) => message.content)
        .map((part) => part.type === 'text' ? part.text : '')
        .join('\n');
      if (tools.length > 0) {
        return {
          id: `research-${String(callId)}`,
          message: {
            role: 'assistant' as const,
            content: [],
            toolCalls: [{
              type: 'function' as const,
              id: `read-${String(callId)}`,
              name: 'Read',
              arguments: JSON.stringify({ path: 'package.json', n_lines: 1 }),
            }],
          },
          usage: emptyUsage(),
          finishReason: 'tool_calls' as const,
          rawFinishReason: 'tool_calls',
        };
      }
      if (
        chat.modelName === 'peer-model'
        && input.includes('EXPERT TALK OPENING CONTRACT')
        && peerEmptyResponses < 2
      ) {
        peerEmptyResponses += 1;
        throw new APIEmptyResponseError('thinking-only response', {
          finishReason: 'completed',
          rawFinishReason: 'end_turn',
        });
      }
      const text = input.includes('EXPERT TALK FUSION CONTRACT')
        ? JSON.stringify({
            version: 'expert_talk_result/v1',
            answer: 'Use the verified result.',
            notes: {
              consensus: ['Both experts agree.'],
              divergence: [],
              uncertainty: [],
              attribution: [],
            },
          })
        : input.includes('REVIEW OF')
          ? '## Agreement\nVerified.\n\n## Rejection and missing points\nNone.\n\n## Revised position\nUse the verified result.'
          : '## Position\nUse the verified result.\n\n## Case\nEvidence supports it.\n\n## Decision criteria\nPrefer verified behavior.\n\n## Risks and uncertainty\nNone material.\n\n## Recommended answer\nUse the verified result.';
      return {
        id: `answer-${String(callId)}`,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed' as const,
        rawFinishReason: 'stop',
      };
    });
    const { service, started } = await startDiscussion(ctx, 'Recover an empty final response.');

    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    }, { timeout: 5_000 });

    expect(peerEmptyResponses).toBe(2);
    expect(service.getRun(started.runId).status).toBe('COMPLETED');
  });

  it('lets the other opening finish when one provider fails', async () => {
    const leadStarted = deferred();
    const releaseLead = deferred();
    ctx = createDiscussionAgent(async (chat) => {
      if (chat.modelName === 'peer-model') {
        throw new APIEmptyResponseError('filtered response', { finishReason: 'filtered' });
      }
      leadStarted.resolve();
      await releaseLead.promise;
      return {
        id: 'lead-answer',
        message: {
          role: 'assistant' as const,
          content: [{
            type: 'text' as const,
            text: '## Position\nUse the verified result.\n\n## Case\nEvidence supports it.\n\n## Decision criteria\nPrefer verified behavior.\n\n## Risks and uncertainty\nNone material.\n\n## Recommended answer\nUse the verified result.',
          }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed' as const,
        rawFinishReason: 'stop',
      };
    });
    const { service, started } = await startDiscussion(ctx, 'Preserve the successful opening.');
    await leadStarted.promise;
    releaseLead.resolve();

    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    }, { timeout: 5_000 });

    expect(service.getRun(started.runId)).toMatchObject({
      status: 'FAILED_OPENING',
      artifacts: {
        leadOpening: { status: 'completed' },
        peerOpening: { status: 'failed' },
      },
    });
  });

  it('fails the stage when unparsed DSML markup leaks into text', async () => {
    ctx = createDiscussionAgent(async (chat) => {
      if (chat.modelName === 'peer-model') {
        return {
          id: 'peer-leaked-dsml',
          message: {
            role: 'assistant' as const,
            content: [{
              type: 'text' as const,
              text: '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="Read">\n<｜DSML｜parameter name="filePath" string="true">foo.ts</｜DSML｜parameter>\n</｜DSML｜invoke>\n</｜DSML｜tool_calls>',
            }],
            toolCalls: [],
          },
          usage: emptyUsage(),
          finishReason: 'completed' as const,
          rawFinishReason: 'stop',
        };
      }
      return {
        id: 'lead-answer',
        message: {
          role: 'assistant' as const,
          content: [{
            type: 'text' as const,
            text: '## Position\nUse the verified result.\n\n## Case\nEvidence supports it.\n\n## Decision criteria\nPrefer verified behavior.\n\n## Risks and uncertainty\nNone material.\n\n## Recommended answer\nUse the verified result.',
          }],
          toolCalls: [],
        },
        usage: emptyUsage(),
        finishReason: 'completed' as const,
        rawFinishReason: 'stop',
      };
    });
    const { service, started } = await startDiscussion(ctx, 'Reject leaked DSML markup.');

    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    }, { timeout: 5_000 });

    expect(service.getRun(started.runId)).toMatchObject({
      status: 'FAILED_OPENING',
      artifacts: {
        leadOpening: { status: 'completed' },
        peerOpening: {
          status: 'failed',
        },
      },
    });
  });

  it('keeps a contract-complete opening when the final response reaches its request budget', async () => {
    let callId = 0;
    ctx = createDiscussionAgent(async (_chat, _systemPrompt, tools, history) => {
      callId += 1;
      const input = history
        .flatMap((message) => message.content)
        .map((part) => part.type === 'text' ? part.text : '')
        .join('\n');
      if (tools.length > 0) {
        return {
          id: `research-${String(callId)}`,
          message: {
            role: 'assistant' as const,
            content: [],
            toolCalls: [{
              type: 'function' as const,
              id: `read-${String(callId)}`,
              name: 'Read',
              arguments: JSON.stringify({ path: 'package.json', n_lines: 1 }),
            }],
          },
          usage: emptyUsage(),
          finishReason: 'tool_calls' as const,
          rawFinishReason: 'tool_calls',
        };
      }
      const opening = '## Position\nUse the verified result.\n\n## Case\nEvidence supports it.\n\n## Decision criteria\nPrefer verified behavior.\n\n## Risks and uncertainty\nNone material.\n\n## Recommended answer\nUse the verified result.';
      const text = input.includes('EXPERT TALK FUSION CONTRACT')
        ? JSON.stringify({
            version: 'expert_talk_result/v1',
            answer: 'Use the verified result.',
            notes: {
              consensus: ['Both experts agree.'],
              divergence: [],
              uncertainty: [],
              attribution: [],
            },
          })
        : input.includes('REVIEW OF')
          ? '## Agreement\nVerified.\n\n## Rejection and missing points\nNone.\n\n## Revised position\nUse the verified result.'
          : opening;
      return {
        id: `answer-${String(callId)}`,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text }],
          toolCalls: input.includes('EXPERT TALK OPENING CONTRACT')
            ? [{
                type: 'function' as const,
                id: `late-read-${String(callId)}`,
                name: 'Read',
                arguments: JSON.stringify({ path: 'package.json', n_lines: 1 }),
              }]
            : [],
        },
        usage: emptyUsage(),
        finishReason: input.includes('EXPERT TALK OPENING CONTRACT')
          ? 'tool_calls' as const
          : 'completed' as const,
        rawFinishReason: input.includes('EXPERT TALK OPENING CONTRACT') ? 'tool_calls' : 'stop',
      };
    });
    const { service, started } = await startDiscussion(ctx, 'Keep a complete bounded opening.');

    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    }, { timeout: 5_000 });

    expect(service.getRun(started.runId)).toMatchObject({
      status: 'COMPLETED',
      artifacts: {
        leadOpening: { status: 'completed', partial: true },
        peerOpening: { status: 'completed', partial: true },
      },
    });
  });

  it('does not return from cancellation while late execution can overwrite terminal state', async () => {
    ctx = createDiscussionAgent(successfulGenerator());
    const agents = ctx.get(IAgentLifecycleService);
    const cleanupStarted = deferred();
    const cleanupFinished = deferred();
    const releaseCleanup = deferred();
    const originalRemove = agents.remove.bind(agents);
    let cleanupCount = 0;
    vi.spyOn(agents, 'remove').mockImplementation(async (agent) => {
      if (agent.agentId.startsWith('expert-talk-')) {
        cleanupStarted.resolve();
        await releaseCleanup.promise;
        cleanupCount += 1;
      }
      await originalRemove(agent);
      if (cleanupCount === 3) cleanupFinished.resolve();
    });
    const cancelledTranscript = deferred();
    const main = agents.handleOf(MAIN_AGENT_ID)!;
    const dispatcher = main.accessor.get(IEventDispatcher);
    const originalDispatch = dispatcher.dispatch.bind(dispatcher);
    let lateCompletionProjected = false;
    vi.spyOn(dispatcher, 'dispatch').mockImplementation(async (event) => {
      if (event instanceof TurnEnded && event.reason === 'completed') {
        lateCompletionProjected = true;
        return;
      }
      await originalDispatch(event);
    });
    const endedSubscription = main.accessor.get(IEventBus).subscribe(TurnEnded, (event) => {
      if (event.reason === 'cancelled') cancelledTranscript.resolve();
    });
    const { service, started } = await startDiscussion(ctx, 'Keep cancellation terminal.');
    let cancelPromise: ReturnType<typeof service.cancel> | undefined;
    let cancelSettled = false;
    const changeSubscription = service.onDidChange(({ status }) => {
      const run = status.activeRun;
      if (
        run?.runId === started.runId
        && run.status === 'FUSING'
        && run.artifacts.fusion?.status === 'completed'
        && cancelPromise === undefined
      ) {
        cancelPromise = service.cancel(started.runId);
        void cancelPromise.then(() => {
          cancelSettled = true;
        });
      }
    });

    await cleanupStarted.promise;
    await Promise.resolve();
    await Promise.resolve();
    const returnedBeforeCleanup = cancelSettled;
    releaseCleanup.resolve();
    await cleanupFinished.promise;
    await cancelledTranscript.promise;
    await Promise.resolve();
    await Promise.resolve();
    const cancelled = await cancelPromise!;
    changeSubscription.dispose();
    endedSubscription.dispose();

    expect(returnedBeforeCleanup).toBe(false);
    expect(lateCompletionProjected).toBe(false);
    expect(cancelled.status).toBe('CANCELLED');
    expect(service.getRun(started.runId).status).toBe('CANCELLED');
  });

  it('keeps a completed result when transcript projection fails', async () => {
    ctx = createDiscussionAgent(successfulGenerator());
    const agents = ctx.get(IAgentLifecycleService);
    const dispatcher = agents.handleOf(MAIN_AGENT_ID)!.accessor.get(IEventDispatcher);
    const originalDispatch = dispatcher.dispatch.bind(dispatcher);
    const unexpected: unknown[] = [];
    setUnexpectedErrorHandler((error) => unexpected.push(error));
    vi.spyOn(dispatcher, 'dispatch').mockImplementation(async (event) => {
      if (event instanceof TurnEnded && event.reason === 'completed') {
        throw new Error('transcript projection failed');
      }
      await originalDispatch(event);
    });
    const { service, started } = await startDiscussion(ctx, 'Keep the completed result.');

    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    });

    expect(service.getRun(started.runId)).toMatchObject({
      status: 'COMPLETED',
      result: { version: 'expert_talk_result/v1' },
    });
    expect(
      unexpected,
      unexpected.map((error) => error instanceof Error ? error.message : String(error)).join('\n'),
    ).toHaveLength(1);
  });

  it('records cleanup failures without rejecting the background run', async () => {
    ctx = createDiscussionAgent(successfulGenerator());
    const agents = ctx.get(IAgentLifecycleService);
    vi.spyOn(agents, 'remove').mockImplementation(async (agent) => {
      if (agent.agentId.startsWith('expert-talk-')) throw new Error('cleanup failed');
    });
    const { service, started } = await startDiscussion(ctx, 'Keep cleanup best effort.');

    await vi.waitFor(() => {
      expect(service.getRun(started.runId)).toMatchObject({
        status: 'COMPLETED',
        result: { version: 'expert_talk_result/v1' },
      });
      expect(service.getRun(started.runId).orphanedParticipantIds?.length).toBe(3);
    });
  });

  it('removes every created participant when peer construction is incomplete', async () => {
    ctx = createDiscussionAgent(successfulGenerator());
    const agents = ctx.get(IAgentLifecycleService);
    const originalHandleOf = agents.handleOf.bind(agents);
    vi.spyOn(agents, 'handleOf').mockImplementation((agentId) =>
      agentId.includes('-peer-') ? undefined : originalHandleOf(agentId));
    const { service, started } = await startDiscussion(ctx, 'Clean partial construction.');

    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    });
    await vi.waitFor(() => {
      expect(agents.list({ prefix: 'expert-talk-' })).toHaveLength(0);
    });

    expect(service.getRun(started.runId).status).toBe('FAILED_OPENING');
  });

  it('retains only the newest runs and their retry inputs', async () => {
    ctx = createDiscussionAgent(successfulGenerator());
    const service = ctx.get(ISessionExpertTalkService);
    await service.ready;
    await service.configure({
      fusionLeadModelId: 'lead-model',
      peerModelId: 'peer-model',
    });
    const initialArm = service.arm('test-client');
    const initial = await service.start({
      armId: initialArm.armId,
      clientId: 'test-client',
      prompt: 'Create a retained run template.',
    });
    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(initial.runId).status)).toBe(true);
    }, { timeout: 5_000 });

    const states = ctx.get(ISessionStateService);
    const templateState = states.get(expertTalkStateKey);
    const templateRun = templateState.runs[0]!;
    const templateInput = templateState.inputs?.[templateRun.runId];
    if (templateInput === undefined) throw new Error('Discussion input fixture was not persisted');
    const seededRuns = Array.from({ length: 100 }, (_, index) => ({
      ...templateRun,
      runId: `seeded-run-${String(index)}`,
      promptId: `seeded-prompt-${String(index)}`,
      turnId: index + 1,
    }));
    const seededInputs = Object.fromEntries(seededRuns.map((run) => [run.runId, templateInput]));
    states.set(expertTalkStateKey, {
      ...templateState,
      runs: seededRuns,
      inputs: seededInputs,
    });

    const arm = service.arm('test-client');
    const started = await service.start({
      armId: arm.armId,
      clientId: 'test-client',
      prompt: 'Retain the newest run.',
    });
    await vi.waitFor(() => {
      expect(TERMINAL_STATUSES.has(service.getRun(started.runId).status)).toBe(true);
    }, { timeout: 5_000 });

    const page = service.listRuns({ limit: 100 });
    const persisted = states.get(expertTalkStateKey);
    const expectedIds = [...seededRuns.slice(1).map((run) => run.runId), started.runId];

    expect(page.items.map((run) => run.runId).toReversed()).toEqual(expectedIds);
    expect(persisted.runs.map((run) => run.runId)).toEqual(expectedIds);
    expect(Object.keys(persisted.inputs ?? {})).toEqual(expectedIds);
  });
});
