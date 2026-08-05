import { Container } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';

import { MCP_STATUS_TRANSIENT_DURATION_MS } from '#/tui/constant/pythinker-tui';
import { FooterComponent, footerStatusFromAppState } from '#/tui/components/chrome/footer';
import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import {
  createFooterState,
  reduceFooterState,
  selectFooterViewModel,
  type FooterEvent,
} from '#/tui/runtime/footer/footer-model';
import { SessionEventHandler } from '#/tui/controllers/session-event-handler';
import { getBuiltInPalette } from '#/tui/theme';
import type { AppState } from '#/tui/types';
import { readGoalQueue, removeGoalQueueItem, restoreGoalQueueItem } from '#/tui/goal-queue-store';
import {
  buildMcpStartupStatusLine,
  type McpServerStatusSnapshot,
} from '#/tui/utils/mcp-server-status';

vi.mock('#/tui/goal-queue-store', () => ({
  readGoalQueue: vi.fn(async () => ({
    goals: [{ id: 'q1', objective: 'Ship queued goal', createdAt: '', updatedAt: '' }],
  })),
  removeGoalQueueItem: vi.fn(async () => ({ goals: [] })),
  restoreGoalQueueItem: vi.fn(async () => ({
    goals: [{ id: 'q1', objective: 'Ship queued goal', createdAt: '', updatedAt: '' }],
  })),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function fakeGoalSnapshot(objective: string, status: 'active' | 'blocked' | 'paused' | 'complete') {
  return {
    goalId: 'g1',
    objective,
    status,
    turnsUsed: 1,
    tokensUsed: 10,
    wallClockMs: 100,
    budget: {
      tokenBudget: null,
      turnBudget: 20,
      wallClockBudgetMs: null,
      remainingTokens: null,
      remainingTurns: 19,
      remainingWallClockMs: null,
      tokenBudgetReached: false,
      turnBudgetReached: false,
      wallClockBudgetReached: false,
      overBudget: false,
    },
  };
}

function makeHost(options: { createGoalRejects?: boolean } = {}) {
  const session = {
    id: 's1',
    listMcpServers: vi.fn(async () => []),
    createGoal: vi.fn(async () => {
      if (options.createGoalRejects === true) throw new Error('create failed');
      return fakeGoalSnapshot('Ship queued goal', 'active');
    }),
    cancelGoal: vi.fn(async () => fakeGoalSnapshot('Ship queued goal', 'active')),
  };
  const host = {
    state: {
      appState: {
        sessionId: 's1',
        streamingPhase: 'waiting',
        model: 'pythinker-model',
        permissionMode: 'auto',
      },
      queuedMessages: [],
      theme: { palette: getBuiltInPalette('dark') },
      toolOutputExpanded: false,
      todoPanel: { getTodos: vi.fn(() => []) },
      footer: { setTokenSpeed: vi.fn() },
      transcriptContainer: { addChild: vi.fn() },
      mcpStatusContainer: new Container(),
      ui: { requestRender: vi.fn() },
    },
    session,
    aborted: false,
    sessionEventUnsubscribe: undefined,
    streamingUI: {
      setTurnId: vi.fn(),
      setStep: vi.fn(),
      flushNow: vi.fn(),
      resetToolUi: vi.fn(),
      finalizeLiveTextBuffers: vi.fn(),
      finalizeTurn: vi.fn(),
      hasThinkingDraft: vi.fn(() => false),
      flushThinkingToTranscript: vi.fn(),
      appendThinkingDelta: vi.fn(),
      appendAssistantDelta: vi.fn(),
      getTurnContext: vi.fn(() => ({ turnId: undefined, step: 0 })),
      registerToolCall: vi.fn(),
      completeToolResult: vi.fn(() => undefined),
      accumulateToolCallDelta: vi.fn(),
      getStreamingToolCallPreview: vi.fn(() => undefined),
      scheduleFlush: vi.fn(),
    },
    requireSession: vi.fn(() => session),
    setAppState: vi.fn(),
    dispatchFooter: vi.fn(),
    patchLivePane: vi.fn(),
    resetLivePane: vi.fn(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    updateActivityPane: vi.fn(),
    track: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    sendNormalUserInput: vi.fn(),
    refreshSkillCommands: vi.fn(async () => {}),
    sendQueuedMessage: vi.fn(),
    shiftQueuedMessage: vi.fn(),
    btwPanelController: { routeEvent: vi.fn(() => false) },
    tasksBrowserController: {},
  };
  host.setAppState.mockImplementation((patch: Record<string, unknown>) => {
    Object.assign(host.state.appState, patch);
  });
  host.streamingUI.finalizeTurn.mockImplementation(() => {
    host.setAppState({ streamingPhase: 'idle' });
  });
  return { host: host as any, session };
}

function makeTokenSpeedHost() {
  const { host } = makeHost();
  const appState = {
    ...host.state.appState,
    workDir: '/tmp',
    planMode: false,
    dynamicWorkflowMode: false,
    thinkingLevel: 'medium',
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isReplaying: false,
    streamingStartTime: 0,
    theme: 'dark',
    version: 'test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    statusLine: DEFAULT_STATUS_LINE_CONFIG,
    availableModels: {},
    availableProviders: {},
    sessionTitle: null,
    mcpServersSummary: null,
  } as AppState;
  const footer = new FooterComponent(appState);
  host.state.appState = appState;
  host.state.footer = footer;
  let footerState = createFooterState(footerStatusFromAppState(appState, footer.getGitStatus()));
  host.dispatchFooter.mockImplementation((event: FooterEvent) => {
    footerState = reduceFooterState(footerState, event);
    footer.setViewModel(
      selectFooterViewModel(
        footerState,
        Date.now(),
        DEFAULT_STATUS_LINE_CONFIG,
      ),
    );
  });
  return { host, footer };
}

function renderFooter(footer: FooterComponent): string {
  return footer.render(160)[0]?.replaceAll(/\u001B\[[0-9;]*m/g, '') ?? '';
}

function sendQueuedViaHost(host: ReturnType<typeof makeHost>['host'], session: unknown) {
  return (item: unknown) => {
    host.sendQueuedMessage(session as never, item as never);
  };
}

function completionEvent() {
  return {
    type: 'goal.updated',
    sessionId: 's1',
    agentId: 'main',
    snapshot: fakeGoalSnapshot('Current goal', 'complete'),
    change: {
      kind: 'completion',
      status: 'complete',
      stats: { turnsUsed: 1, tokensUsed: 10, wallClockMs: 100 },
    },
  } as const;
}

function clearedEvent() {
  return {
    type: 'goal.updated',
    sessionId: 's1',
    agentId: 'main',
    snapshot: null,
  } as const;
}

function turnEndedEvent() {
  return {
    type: 'turn.ended',
    sessionId: 's1',
    agentId: 'main',
    turnId: 1,
    reason: 'completed',
  } as const;
}

function modelBlockedEvent() {
  return {
    type: 'goal.updated',
    sessionId: 's1',
    agentId: 'main',
    snapshot: fakeGoalSnapshot('Blocked goal', 'blocked'),
    change: { kind: 'lifecycle', status: 'blocked' },
  } as const;
}

function addedTranscriptText(host: ReturnType<typeof makeHost>['host']): string {
  const component = host.state.transcriptContainer.addChild.mock.calls.at(-1)?.[0];
  return component.render(80).join('\n').replaceAll(/\[[0-9;]*m/g, '');
}

function renderContainer(container: Container): string {
  return container.render(120).join('\n').replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('SessionEventHandler Dynamic Workflow routing', () => {
  it('specializes only the exact DynamicWorkflow tool name', () => {
    const { host } = makeHost();
    const handler = new SessionEventHandler(host);
    const start = vi
      .spyOn(handler.subAgentEventHandler, 'handleDynamicWorkflowToolCallStarted')
      .mockImplementation(() => {});

    handler.handleEvent(
      {
        type: 'tool.call.started',
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        toolCallId: 'call_dynamic_workflow',
        name: 'DynamicWorkflow',
        args: { items: ['a', 'b'] },
      } as never,
      vi.fn(),
    );
    handler.handleEvent(
      {
        type: 'tool.call.started',
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        toolCallId: 'call_removed_swarm',
        name: 'AgentSwarm',
        args: { items: ['a', 'b'] },
      } as never,
      vi.fn(),
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('call_dynamic_workflow', { items: ['a', 'b'] });
    expect(host.streamingUI.registerToolCall).toHaveBeenCalledTimes(2);
  });

  it('specializes only matching DynamicWorkflow results', () => {
    const { host } = makeHost();
    const handler = new SessionEventHandler(host);
    const result = vi
      .spyOn(handler.subAgentEventHandler, 'handleDynamicWorkflowToolResult')
      .mockImplementation(() => {});
    host.streamingUI.completeToolResult
      .mockReturnValueOnce({ name: 'DynamicWorkflow' })
      .mockReturnValueOnce({ name: 'AgentSwarm' });

    handler.handleEvent(
      {
        type: 'tool.result',
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        toolCallId: 'call_dynamic_workflow',
        output: 'dynamic result',
      } as never,
      vi.fn(),
    );
    handler.handleEvent(
      {
        type: 'tool.result',
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        toolCallId: 'call_removed_swarm',
        output: 'legacy result',
      } as never,
      vi.fn(),
    );

    expect(result).toHaveBeenCalledTimes(1);
    expect(result).toHaveBeenCalledWith(
      'call_dynamic_workflow',
      expect.objectContaining({ output: 'dynamic result' }),
      false,
    );
  });

  it('ignores a retired Dynamic Workflow result before mutating streaming state', () => {
    const { host } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(
      {
        type: 'tool.call.started',
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        toolCallId: 'call_retired_workflow',
        name: 'DynamicWorkflow',
        args: { items: ['a'] },
      } as never,
      vi.fn(),
    );
    handler.clearDynamicWorkflowMissionControls();

    const result = vi.spyOn(handler.subAgentEventHandler, 'handleDynamicWorkflowToolResult');
    host.streamingUI.setTurnId.mockClear();
    host.streamingUI.flushNow.mockClear();
    host.streamingUI.completeToolResult.mockClear();
    host.patchLivePane.mockClear();

    handler.handleEvent(
      {
        type: 'tool.result',
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        toolCallId: 'call_retired_workflow',
        output: 'late result',
      } as never,
      vi.fn(),
    );

    expect(host.streamingUI.setTurnId).not.toHaveBeenCalled();
    expect(host.streamingUI.flushNow).not.toHaveBeenCalled();
    expect(host.streamingUI.completeToolResult).not.toHaveBeenCalled();
    expect(host.patchLivePane).not.toHaveBeenCalled();
    expect(result).not.toHaveBeenCalled();
  });
});

describe('SessionEventHandler token speed', () => {
  it('projects spend into the footer and retains pricing for /cost', () => {
    const { host, footer } = makeTokenSpeedHost();
    const handler = new SessionEventHandler(host);
    try {
      handler.handleEvent(
        {
          type: 'agent.status.updated',
          sessionId: 's1',
          agentId: 'main',
          modelCostRates: { input: 3, output: 15 },
          usage: { totalCostUsd: 0.125 },
        },
        vi.fn(),
      );

      expect(renderFooter(footer)).not.toContain('in $3/M out $15/M');
      expect(renderFooter(footer)).toContain('$0.13');
      expect(renderFooter(footer)).not.toContain('spent');
      expect(host.state.appState.modelCostRates).toEqual({ input: 3, output: 15 });
      expect(host.state.appState.totalCostUsd).toBe(0.125);

      handler.handleEvent(
        {
          type: 'agent.status.updated',
          sessionId: 's1',
          agentId: 'main',
          model: 'unpriced-model',
          usage: { totalCostUsd: 0.125 },
        },
        vi.fn(),
      );

      expect(host.state.appState.modelCostRates).toBeUndefined();
      expect(host.state.appState.totalCostUsd).toBe(0.125);
      handler.resetRuntimeState();
      expect(host.state.appState.modelCostRates).toBeUndefined();
      expect(host.state.appState.totalCostUsd).toBeUndefined();
    } finally {
      footer.dispose();
    }
  });

  it.each([
    {
      name: 'assistant text',
      event: (delta: string) => ({
        type: 'assistant.delta' as const,
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        delta,
      }),
    },
    {
      name: 'thinking text',
      event: (delta: string) => ({
        type: 'thinking.delta' as const,
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        delta,
      }),
    },
    {
      name: 'tool-call arguments',
      event: (argumentsPart: string) => ({
        type: 'tool.call.delta' as const,
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        toolCallId: 'call-1',
        name: 'Read',
        argumentsPart,
      }),
    },
  ])('updates a live estimate from $name and replaces it with exact usage', ({ event }) => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { host, footer } = makeTokenSpeedHost();
    const handler = new SessionEventHandler(host);
    try {
      handler.handleEvent(
        {
          type: 'turn.step.started',
          sessionId: 's1',
          agentId: 'main',
          turnId: 1,
          step: 1,
        },
        vi.fn(),
      );

      vi.setSystemTime(2_000);
      handler.handleEvent(event('abcd'), vi.fn());
      vi.setSystemTime(3_000);
      handler.handleEvent(event('x'.repeat(400)), vi.fn());

      expect(renderFooter(footer)).toContain('~100.0 t/s');

      handler.handleEvent(
        {
          type: 'turn.step.completed',
          sessionId: 's1',
          agentId: 'main',
          turnId: 1,
          step: 1,
          usage: {
            inputOther: 0,
            inputCacheRead: 0,
            inputCacheCreation: 0,
            output: 43,
          },
          llmStreamDurationMs: 1_000,
        },
        vi.fn(),
      );
      expect(renderFooter(footer)).toContain('42.0 t/s');
      expect(renderFooter(footer)).not.toContain('~42.0 t/s');
    } finally {
      footer.dispose();
    }
  });

  it('keeps concurrent agent stream estimates separate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { host, footer } = makeTokenSpeedHost();
    const handler = new SessionEventHandler(host);
    const event = (agentId: string, delta: string) => ({
      type: 'assistant.delta' as const,
      sessionId: 's1',
      agentId,
      turnId: 1,
      delta,
    });
    try {
      handler.handleEvent(event('agent-a', 'abcd'), vi.fn());
      vi.setSystemTime(500);
      handler.handleEvent(event('agent-b', 'abcd'), vi.fn());
      vi.setSystemTime(1_000);
      handler.handleEvent(event('agent-a', 'x'.repeat(400)), vi.fn());
      expect(renderFooter(footer)).toContain('~100.0 t/s');

      vi.setSystemTime(1_500);
      handler.handleEvent(event('agent-b', 'x'.repeat(200)), vi.fn());
      expect(renderFooter(footer)).toContain('~50.0 t/s');
    } finally {
      footer.dispose();
    }
  });

  it('uses the latest valid main or child completed stream', () => {
    const { host, footer } = makeTokenSpeedHost();
    const handler = new SessionEventHandler(host);
    try {
      handler.handleEvent(
        {
          type: 'turn.step.completed',
          sessionId: 's1',
          agentId: 'main',
          turnId: 1,
          step: 1,
          usage: {
            inputOther: 10,
            inputCacheRead: 0,
            inputCacheCreation: 0,
            output: 43,
          },
          llmStreamDurationMs: 1_000,
        },
        vi.fn(),
      );
      expect(renderFooter(footer)).toContain('42.0 t/s');

      handler.handleEvent(
        {
          type: 'turn.step.completed',
          sessionId: 's1',
          agentId: 'agent-1',
          turnId: 1,
          step: 1,
          usage: {
            inputOther: 10,
            inputCacheRead: 0,
            inputCacheCreation: 0,
            output: 101,
          },
          llmStreamDurationMs: 2_000,
        },
        vi.fn(),
      );
      expect(renderFooter(footer)).toContain('50.0 t/s');
    } finally {
      footer.dispose();
    }
  });

  it.each([
    ['missing usage', undefined, 1_000],
    ['one output token', {
      inputOther: 0,
      inputCacheRead: 0,
      inputCacheCreation: 0,
      output: 1,
    }, 1_000],
    ['zero duration', {
      inputOther: 0,
      inputCacheRead: 0,
      inputCacheCreation: 0,
      output: 10,
    }, 0],
    ['non-finite output', {
      inputOther: 0,
      inputCacheRead: 0,
      inputCacheCreation: 0,
      output: Number.NaN,
    }, 1_000],
    ['non-finite duration', {
      inputOther: 0,
      inputCacheRead: 0,
      inputCacheCreation: 0,
      output: 10,
    }, Number.NaN],
  ] as const)('ignores %s', (_label, usage, llmStreamDurationMs) => {
    const { host, footer } = makeTokenSpeedHost();
    const handler = new SessionEventHandler(host);
    try {
      handler.handleEvent(
        {
          type: 'turn.step.completed',
          sessionId: 's1',
          agentId: 'main',
          turnId: 1,
          step: 1,
          usage: {
            inputOther: 0,
            inputCacheRead: 0,
            inputCacheCreation: 0,
            output: 43,
          },
          llmStreamDurationMs: 1_000,
        },
        vi.fn(),
      );
      expect(renderFooter(footer)).toContain('42.0 t/s');

      handler.handleEvent(
        {
          type: 'turn.step.completed',
          sessionId: 's1',
          agentId: 'main',
          turnId: 1,
          step: 2,
          usage,
          llmStreamDurationMs,
        },
        vi.fn(),
      );
      expect(renderFooter(footer)).toContain('42.0 t/s');
    } finally {
      footer.dispose();
    }
  });

  it('clears completed throughput when the turn ends', () => {
    const { host, footer } = makeTokenSpeedHost();
    const handler = new SessionEventHandler(host);
    try {
      handler.handleEvent(
        {
          type: 'turn.step.completed',
          sessionId: 's1',
          agentId: 'main',
          turnId: 1,
          step: 1,
          usage: {
            inputOther: 0,
            inputCacheRead: 0,
            inputCacheCreation: 0,
            output: 43,
          },
          llmStreamDurationMs: 1_000,
        },
        vi.fn(),
      );
      expect(renderFooter(footer)).toContain('42.0 t/s');

      handler.handleEvent(turnEndedEvent(), vi.fn());

      expect(renderFooter(footer)).not.toContain('t/s');
    } finally {
      footer.dispose();
    }
  });

  it('ignores replayed completion metrics and clears on runtime reset', () => {
    const { host, footer } = makeTokenSpeedHost();
    const handler = new SessionEventHandler(host);
    try {
      handler.handleEvent(
        {
          type: 'turn.step.completed',
          sessionId: 's1',
          agentId: 'main',
          turnId: 1,
          step: 1,
          usage: {
            inputOther: 0,
            inputCacheRead: 0,
            inputCacheCreation: 0,
            output: 11,
          },
          llmStreamDurationMs: 1_000,
        },
        vi.fn(),
      );
      expect(renderFooter(footer)).toContain('10.0 t/s');

      host.state.appState.isReplaying = true;
      handler.handleEvent(
        {
          type: 'turn.step.completed',
          sessionId: 's1',
          agentId: 'main',
          turnId: 1,
          step: 2,
          usage: {
            inputOther: 0,
            inputCacheRead: 0,
            inputCacheCreation: 0,
            output: 101,
          },
          llmStreamDurationMs: 1_000,
        },
        vi.fn(),
      );
      expect(renderFooter(footer)).toContain('10.0 t/s');

      handler.resetRuntimeState();
      expect(renderFooter(footer)).not.toContain('t/s');
    } finally {
      footer.dispose();
    }
  });
});

describe('SessionEventHandler goal queue promotion', () => {
  beforeEach(() => {
    vi.mocked(readGoalQueue).mockClear();
    vi.mocked(removeGoalQueueItem).mockClear();
    vi.mocked(restoreGoalQueueItem).mockClear();
  });

  it('starts the next queued goal after the completion turn ends', async () => {
    const { host, session } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(completionEvent(), vi.fn());
    expect(session.createGoal).not.toHaveBeenCalled();
    handler.handleEvent(clearedEvent(), vi.fn());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();

    handler.handleEvent(turnEndedEvent(), sendQueuedViaHost(host, session));

    await vi.waitFor(() => {
      expect(session.createGoal).toHaveBeenCalledWith({
        objective: 'Ship queued goal',
        replace: false,
      });
    });
    expect(removeGoalQueueItem).toHaveBeenCalledWith(session, { goalId: 'q1' });
    expect(host.sendQueuedMessage).toHaveBeenCalledWith(session, {
      text: 'Ship queued goal',
    });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.track).toHaveBeenCalledWith('goal_create', { replace: false });
  });

  it('waits for queued user input to drain before promoting the next queued goal', async () => {
    const { host, session } = makeHost();
    host.state.queuedMessages = [{ text: 'queued user turn' }];
    host.setAppState.mockImplementation((patch: Record<string, unknown>) => {
      Object.assign(host.state.appState, patch);
    });
    host.shiftQueuedMessage.mockImplementation(() => host.state.queuedMessages.shift());
    host.streamingUI.finalizeTurn.mockImplementation((sendQueued: (item: unknown) => void) => {
      const next = host.shiftQueuedMessage();
      if (next !== undefined) {
        host.setAppState({ streamingPhase: 'idle' });
        setTimeout(() => {
          sendQueued(next);
        }, 0);
        return;
      }
      host.setAppState({ streamingPhase: 'idle' });
    });
    host.sendQueuedMessage.mockImplementation((_session: unknown, item: { text: string }) => {
      if (item.text === 'queued user turn') {
        host.setAppState({ streamingPhase: 'waiting' });
      }
    });
    const handler = new SessionEventHandler(host);
    const sendQueued = sendQueuedViaHost(host, session);

    handler.handleEvent(completionEvent(), sendQueued);
    handler.handleEvent(clearedEvent(), sendQueued);
    handler.handleEvent(turnEndedEvent(), sendQueued);

    await vi.waitFor(() => {
      expect(host.sendQueuedMessage).toHaveBeenCalledWith(session, { text: 'queued user turn' });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.createGoal).not.toHaveBeenCalled();

    handler.handleEvent(turnEndedEvent(), sendQueued);

    await vi.waitFor(() => {
      expect(session.createGoal).toHaveBeenCalledWith({
        objective: 'Ship queued goal',
        replace: false,
      });
    });
    expect(host.sendQueuedMessage).toHaveBeenLastCalledWith(session, { text: 'Ship queued goal' });
  });

  it('leaves the queued goal in place when the next goal cannot start', async () => {
    const { host, session } = makeHost({ createGoalRejects: true });
    const handler = new SessionEventHandler(host);

    handler.handleEvent(completionEvent(), vi.fn());
    handler.handleEvent(clearedEvent(), vi.fn());
    handler.handleEvent(turnEndedEvent(), vi.fn());

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('create failed'));
    });
    expect(removeGoalQueueItem).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.sendQueuedMessage).not.toHaveBeenCalled();
    expect(session.createGoal).toHaveBeenCalledOnce();
  });

  it('retries the queued goal on a later idle event after startup fails', async () => {
    const { host, session } = makeHost();
    session.createGoal.mockRejectedValueOnce(new Error('create failed'));
    const handler = new SessionEventHandler(host);
    const sendQueued = sendQueuedViaHost(host, session);

    handler.handleEvent(completionEvent(), sendQueued);
    handler.handleEvent(clearedEvent(), sendQueued);
    handler.handleEvent(turnEndedEvent(), sendQueued);

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('create failed'));
    });
    expect(removeGoalQueueItem).not.toHaveBeenCalled();
    expect(host.sendQueuedMessage).not.toHaveBeenCalled();

    handler.handleEvent(turnEndedEvent(), sendQueued);

    await vi.waitFor(() => {
      expect(session.createGoal).toHaveBeenCalledTimes(2);
    });
    expect(removeGoalQueueItem).toHaveBeenCalledWith(session, { goalId: 'q1' });
    expect(host.sendQueuedMessage).toHaveBeenCalledWith(session, { text: 'Ship queued goal' });
  });

  it('does not send the queued objective when removal fails after goal creation', async () => {
    vi.mocked(removeGoalQueueItem).mockRejectedValueOnce(new Error('remove failed'));
    const { host, session } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(completionEvent(), vi.fn());
    handler.handleEvent(clearedEvent(), vi.fn());
    handler.handleEvent(turnEndedEvent(), vi.fn());

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('could not be removed'));
    });
    expect(session.createGoal).toHaveBeenCalledWith({
      objective: 'Ship queued goal',
      replace: false,
    });
    expect(session.cancelGoal).toHaveBeenCalledOnce();
    expect(restoreGoalQueueItem).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.sendQueuedMessage).not.toHaveBeenCalled();
  });

  it('restores the queued goal and cancels the started goal when the session changes before send', async () => {
    const { host, session } = makeHost();
    vi.mocked(removeGoalQueueItem).mockImplementationOnce(async () => {
      host.session = undefined;
      return { goals: [] };
    });
    const handler = new SessionEventHandler(host);

    handler.handleEvent(completionEvent(), vi.fn());
    handler.handleEvent(clearedEvent(), vi.fn());
    handler.handleEvent(turnEndedEvent(), sendQueuedViaHost(host, session));

    await vi.waitFor(() => {
      expect(restoreGoalQueueItem).toHaveBeenCalledWith(session, {
        id: 'q1',
        objective: 'Ship queued goal',
        createdAt: '',
        updatedAt: '',
      });
    });
    expect(session.cancelGoal).toHaveBeenCalledOnce();
    expect(host.sendQueuedMessage).not.toHaveBeenCalled();
  });

  it('restores and cancels when the host becomes busy before sending the promoted goal', async () => {
    const { host, session } = makeHost();
    vi.mocked(removeGoalQueueItem).mockImplementationOnce(async () => {
      host.setAppState({ streamingPhase: 'waiting' });
      return { goals: [] };
    });
    const handler = new SessionEventHandler(host);

    handler.handleEvent(completionEvent(), vi.fn());
    handler.handleEvent(clearedEvent(), vi.fn());
    handler.handleEvent(turnEndedEvent(), sendQueuedViaHost(host, session));

    await vi.waitFor(() => {
      expect(restoreGoalQueueItem).toHaveBeenCalledWith(session, {
        id: 'q1',
        objective: 'Ship queued goal',
        createdAt: '',
        updatedAt: '',
      });
    });
    expect(session.cancelGoal).toHaveBeenCalledOnce();
    expect(host.sendQueuedMessage).not.toHaveBeenCalled();
  });

  it('shows a notice when a blocked goal has queued goals', async () => {
    const { host, session } = makeHost();
    const handler = new SessionEventHandler(host);
    const event = {
      type: 'goal.updated',
      sessionId: 's1',
      agentId: 'main',
      snapshot: fakeGoalSnapshot('Blocked goal', 'blocked'),
      change: { kind: 'lifecycle', status: 'blocked', reason: 'waiting for access' },
    } as const;

    handler.handleEvent(event, vi.fn());

    await vi.waitFor(() => {
      expect(host.showNotice).toHaveBeenCalledWith(
        'Goal blocked.',
        'The next queued goal will start only after this goal is complete.',
      );
    });
    expect(session.createGoal).not.toHaveBeenCalled();
  });

  it('does not render a duplicate marker for a model-reported blocked goal', () => {
    const { host } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(modelBlockedEvent(), vi.fn());

    expect(host.state.transcriptContainer.addChild).not.toHaveBeenCalled();
  });

  it('renders a blocked fallback when the model does not explain the blocked goal', () => {
    const { host } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(modelBlockedEvent(), vi.fn());
    handler.handleEvent(turnEndedEvent(), vi.fn());

    expect(addedTranscriptText(host)).toBe('  ◦ Goal blocked');
  });

  it('does not render a blocked fallback after the model explains the blocked goal', () => {
    const { host } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(modelBlockedEvent(), vi.fn());
    handler.handleEvent(
      {
        type: 'assistant.delta',
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        delta: 'I am blocked because I need credentials.',
      },
      vi.fn(),
    );
    handler.handleEvent(turnEndedEvent(), vi.fn());

    expect(host.state.transcriptContainer.addChild).not.toHaveBeenCalled();
  });

  it('does not render a blocked fallback after earlier assistant text in the same turn', () => {
    const { host } = makeHost();
    const handler = new SessionEventHandler(host);

    handler.handleEvent(
      {
        type: 'assistant.delta',
        sessionId: 's1',
        agentId: 'main',
        turnId: 1,
        delta: 'I am blocked because I need credentials.',
      },
      vi.fn(),
    );
    handler.handleEvent(modelBlockedEvent(), vi.fn());
    handler.handleEvent(turnEndedEvent(), vi.fn());

    expect(host.state.transcriptContainer.addChild).not.toHaveBeenCalled();
  });

  it('does not promote on paused or cancelled updates', async () => {
    const { host, session } = makeHost();
    const handler = new SessionEventHandler(host);
    const paused = {
      type: 'goal.updated',
      sessionId: 's1',
      agentId: 'main',
      snapshot: fakeGoalSnapshot('Paused goal', 'paused'),
      change: { kind: 'lifecycle', status: 'paused' },
    } as const;

    handler.handleEvent(paused, vi.fn());
    handler.handleEvent(clearedEvent(), vi.fn());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    expect(host.sendQueuedMessage).not.toHaveBeenCalled();
  });
});

describe('SessionEventHandler MCP startup status', () => {
  it('builds aggregate startup copy for loading, success, issues, and empty states', () => {
    expect(
      buildMcpStartupStatusLine([
        { name: 'ready', transport: 'stdio', status: 'connected', toolCount: 2 },
        { name: 'loading-a', transport: 'stdio', status: 'pending', toolCount: 0 },
        { name: 'loading-b', transport: 'http', status: 'pending', toolCount: 0 },
        { name: 'disabled', transport: 'stdio', status: 'disabled', toolCount: 0 },
      ]),
    ).toEqual({
      label: 'MCP servers · 1/3 connected · 2 loading…',
      color: 'primary',
      loading: true,
      transient: false,
    });
    expect(
      buildMcpStartupStatusLine([
        { name: 'a', transport: 'stdio', status: 'connected', toolCount: 2 },
        { name: 'b', transport: 'http', status: 'connected', toolCount: 1 },
      ]),
    ).toEqual({
      label: 'MCP servers · 2/2 connected · 3 tools',
      color: 'success',
      loading: false,
      transient: true,
    });
    expect(
      buildMcpStartupStatusLine([
        { name: 'a', transport: 'stdio', status: 'connected', toolCount: 2 },
        { name: 'b', transport: 'http', status: 'failed', toolCount: 0 },
        { name: 'c', transport: 'http', status: 'needs-auth', toolCount: 0 },
      ]),
    ).toEqual({
      label: 'MCP servers · 1/3 connected · 1 failed · 1 needs auth · /mcp for details',
      color: 'error',
      loading: false,
      transient: false,
    });
    expect(buildMcpStartupStatusLine([])).toBeNull();
    expect(
      buildMcpStartupStatusLine([
        { name: 'disabled', transport: 'stdio', status: 'disabled', toolCount: 0 },
      ]),
    ).toBeNull();
  });

  it('updates one aggregate MCP startup row in place', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PYTHINKER_NO_ANIMATION', '');
    vi.stubEnv('CI', '');
    vi.stubEnv('NO_COLOR', '');
    const { host, session } = makeHost();
    const container = new Container();
    host.state.mcpStatusContainer = container;
    session.listMcpServers = vi.fn(async () => [
      { name: 'ready', transport: 'stdio', status: 'connected', toolCount: 2 },
      { name: 'second', transport: 'stdio', status: 'pending', toolCount: 0 },
      { name: 'third', transport: 'http', status: 'pending', toolCount: 0 },
      { name: 'fourth', transport: 'http', status: 'pending', toolCount: 0 },
    ]) as never;
    const handler = new SessionEventHandler(host);

    await handler.syncMcpServerStatusSnapshot(session as never);
    expect(renderContainer(container)).toContain(
      'MCP servers · 1/4 connected · 3 loading…',
    );

    handler.handleEvent({
      type: 'mcp.server.status',
      sessionId: 's1',
      agentId: 'main',
      server: {
        name: 'second',
        transport: 'stdio',
        status: 'connected',
        toolCount: 1,
      },
    } as never, () => {});

    const output = renderContainer(container);
    expect(output).toContain('MCP servers · 2/4 connected · 2 loading…');
    expect(occurrences(output, 'MCP servers')).toBe(1);
    expect(output).not.toContain('"second"');
    expect(host.state.transcriptContainer.addChild).not.toHaveBeenCalled();
    handler.disposeMcpServerStatusRows();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires a healthy aggregate row but keeps issue summaries', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PYTHINKER_NO_ANIMATION', '');
    vi.stubEnv('CI', '');
    vi.stubEnv('NO_COLOR', '');
    const healthy = makeHost();
    const healthyContainer = new Container();
    healthy.host.state.mcpStatusContainer = healthyContainer;
    healthy.session.listMcpServers = vi.fn(async () => [
      { name: 'first', transport: 'stdio', status: 'connected', toolCount: 2 },
      { name: 'second', transport: 'http', status: 'connected', toolCount: 1 },
    ]) as never;
    const healthyHandler = new SessionEventHandler(healthy.host);

    await healthyHandler.syncMcpServerStatusSnapshot(healthy.session as never);
    expect(renderContainer(healthyContainer)).toContain(
      '✓ MCP servers · 2/2 connected · 3 tools',
    );
    vi.advanceTimersByTime(MCP_STATUS_TRANSIENT_DURATION_MS);
    expect(renderContainer(healthyContainer)).not.toContain('MCP servers');

    const issues = makeHost();
    const issueContainer = new Container();
    issues.host.state.mcpStatusContainer = issueContainer;
    issues.session.listMcpServers = vi.fn(async () => [
      { name: 'ready', transport: 'stdio', status: 'connected', toolCount: 2 },
      { name: 'failed', transport: 'http', status: 'failed', toolCount: 0 },
      { name: 'auth', transport: 'http', status: 'needs-auth', toolCount: 0 },
      { name: 'disabled', transport: 'stdio', status: 'disabled', toolCount: 0 },
    ]) as never;
    const issueHandler = new SessionEventHandler(issues.host);

    await issueHandler.syncMcpServerStatusSnapshot(issues.session as never);
    vi.advanceTimersByTime(MCP_STATUS_TRANSIENT_DURATION_MS * 2);
    expect(renderContainer(issueContainer)).toContain(
      '✗ MCP servers · 1/3 connected · 1 failed · 1 needs auth · /mcp for details',
    );
    issueHandler.disposeMcpServerStatusRows();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a live MCP event newer than an in-flight snapshot', async () => {
    vi.useFakeTimers();
    const { host, session } = makeHost();
    const container = new Container();
    host.state.mcpStatusContainer = container;
    let resolveSnapshot: (servers: McpServerStatusSnapshot[]) => void = () => {};
    session.listMcpServers = vi.fn(() => new Promise((resolve) => {
      resolveSnapshot = resolve;
    })) as never;
    const handler = new SessionEventHandler(host);

    const syncing = handler.syncMcpServerStatusSnapshot(session as never);
    handler.handleEvent({
      type: 'mcp.server.status',
      sessionId: 's1',
      agentId: 'main',
      server: {
        name: 'live',
        transport: 'stdio',
        status: 'connected',
        toolCount: 2,
      },
    } as never, () => {});
    resolveSnapshot([
      {
        name: 'live',
        transport: 'stdio',
        status: 'failed',
        toolCount: 0,
        error: 'stale failure',
      },
      { name: 'other', transport: 'http', status: 'pending', toolCount: 0 },
    ]);
    await syncing;

    const output = renderContainer(container);
    expect(output).toContain('MCP servers · 1/2 connected · 1 loading…');
    expect(output).not.toContain('stale failure');
    handler.disposeMcpServerStatusRows();
  });

  it('ignores an older same-session snapshot after reset and a newer sync', async () => {
    vi.useFakeTimers();
    const { host, session } = makeHost();
    const container = new Container();
    host.state.mcpStatusContainer = container;
    let resolveOldSnapshot: (servers: McpServerStatusSnapshot[]) => void = () => {};
    session.listMcpServers = vi.fn(() => new Promise((resolve) => {
      resolveOldSnapshot = resolve;
    })) as never;
    const handler = new SessionEventHandler(host);

    const oldSync = handler.syncMcpServerStatusSnapshot(session as never);
    handler.resetRuntimeState();
    session.listMcpServers = vi.fn(async () => []) as never;
    await handler.syncMcpServerStatusSnapshot(session as never);
    expect(renderContainer(container)).not.toContain('MCP servers');
    expect(host.state.appState.mcpServersSummary).toBeNull();
    expect(host.refreshSkillCommands).toHaveBeenCalledOnce();

    resolveOldSnapshot([
      { name: 'stale', transport: 'http', status: 'failed', toolCount: 0 },
    ]);
    await oldSync;

    expect(renderContainer(container)).not.toContain('MCP servers');
    expect(host.state.appState.mcpServersSummary).toBeNull();
    expect(host.refreshSkillCommands).toHaveBeenCalledOnce();
  });
});

describe('SessionEventHandler hook status', () => {
  it('shows configured hook status only while the hook is running', () => {
    const { host } = makeHost();
    const transcriptContainer = new Container();
    host.state.transcriptContainer = transcriptContainer as never;
    const handler = new SessionEventHandler(host);
    const event = {
      type: 'hook.status',
      sessionId: 's1',
      agentId: 'main',
      statusId: 'hook-1',
      hookEvent: 'Stop',
      content: 'Checking the result',
    } as const;

    handler.handleEvent({ ...event, active: true } as never, () => {});
    expect(transcriptContainer.render(120).join('\n')).toContain('Checking the result');

    handler.handleEvent({ ...event, active: false } as never, () => {});
    expect(transcriptContainer.render(120).join('\n')).not.toContain('Checking the result');
  });
});
