import type { Event } from '@pymodel/pythinker-code-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentDynamicWorkflowProgressComponent } from '#/tui/components/messages/agent-dynamic-workflow-progress';
import {
  SubAgentEventHandler,
  type SubagentLifecycleEvent,
} from '#/tui/controllers/subagent-event-handler';

function makeDynamicWorkflowHandler() {
  const requestRender = vi.fn();
  const transcriptContainer = { addChild: vi.fn() };
  const dockChild = { render: vi.fn(() => ['dock line']) };
  const host = {
    state: {
      appState: { availableModels: {} },
      ui: {
        requestRender,
        terminal: { rows: 40, columns: 120 },
        children: [transcriptContainer, dockChild],
      },
      transcriptContainer,
      dockContainer: undefined,
    },
    streamingUI: {
      getToolComponent: vi.fn(() => undefined),
      getActiveToolCall: vi.fn(() => undefined),
      onToolCallStart: vi.fn(),
      getTurnContext: vi.fn(() => ({ turnId: 1, step: 0 })),
      removeToolComponentIfInactive: vi.fn(),
      finalizeLiveTextBuffers: vi.fn(),
    },
    appendTranscriptEntry: vi.fn(),
    btwPanelController: { routeEvent: vi.fn(() => false) },
    updateActivityPane: vi.fn(),
  };
  const handler = new SubAgentEventHandler(host as never, {
    backgroundTasks: new Map(),
    backgroundTaskTranscriptedTerminal: new Set(),
    backgroundTaskTerminalEntries: new Map(),
    syncBackgroundAgentBadge: vi.fn(),
  });
  return { handler, host, requestRender, transcriptContainer, dockChild };
}

function dynamicWorkflowComponentOf(transcriptContainer: { addChild: ReturnType<typeof vi.fn> }) {
  return transcriptContainer.addChild.mock.calls[0]?.[0] as AgentDynamicWorkflowProgressComponent;
}

function lifecycleEvent(
  type: 'subagent.spawned' | 'subagent.started' | 'subagent.completed' | 'subagent.cancelled',
  subagentId: string,
  parentToolCallId: string,
): SubagentLifecycleEvent {
  return {
    sessionId: 's1',
    agentId: 'main',
    type,
    subagentId,
    subagentName: 'explore',
    parentToolCallId,
    description: `task ${subagentId}`,
    runInBackground: false,
    resultSummary: type === 'subagent.completed' ? 'done' : undefined,
  } as unknown as SubagentLifecycleEvent;
}

function childEvent(type: 'assistant.delta' | 'tool.call.started', subagentId: string): Event {
  return {
    sessionId: 's1',
    agentId: subagentId,
    type,
    delta: type === 'assistant.delta' ? 'hello' : undefined,
    toolCallId: type === 'tool.call.started' ? 'tool-1' : undefined,
    name: type === 'tool.call.started' ? 'Read' : undefined,
    args: {},
  } as unknown as Event;
}

function startDynamicWorkflowWithChild(handler: SubAgentEventHandler): void {
  handler.handleAgentDynamicWorkflowToolCallStarted('tc-1', {
    description: 'Review changed files',
    items: ['src/a.ts'],
  });
  handler.handleLifecycleEvent(lifecycleEvent('subagent.spawned', 'child-1', 'tc-1'));
  handler.handleLifecycleEvent(lifecycleEvent('subagent.started', 'child-1', 'tc-1'));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SubAgentEventHandler — dynamic_workflow render batching', () => {
  it('does not request a render for each child delta routed to a dynamic_workflow', () => {
    vi.useFakeTimers();
    const { handler, requestRender } = makeDynamicWorkflowHandler();
    startDynamicWorkflowWithChild(handler);
    requestRender.mockClear();

    handler.routeChildAgentEvent(childEvent('assistant.delta', 'child-1'));
    handler.routeChildAgentEvent(childEvent('assistant.delta', 'child-1'));
    handler.routeChildAgentEvent(childEvent('tool.call.started', 'child-1'));

    expect(requestRender).not.toHaveBeenCalled();
  });

  it('still requests a render for dynamic_workflow lifecycle transitions', () => {
    vi.useFakeTimers();
    const { handler, requestRender } = makeDynamicWorkflowHandler();
    handler.handleAgentDynamicWorkflowToolCallStarted('tc-1', {
      description: 'Review changed files',
      items: ['src/a.ts'],
    });
    handler.handleLifecycleEvent(lifecycleEvent('subagent.spawned', 'child-1', 'tc-1'));
    requestRender.mockClear();

    handler.handleLifecycleEvent(lifecycleEvent('subagent.started', 'child-1', 'tc-1'));
    handler.handleLifecycleEvent(lifecycleEvent('subagent.completed', 'child-1', 'tc-1'));

    expect(requestRender).toHaveBeenCalled();
  });

  it('drives dynamic_workflow re-renders from the frame timer after deltas', () => {
    vi.useFakeTimers();
    const { handler, requestRender } = makeDynamicWorkflowHandler();
    startDynamicWorkflowWithChild(handler);
    requestRender.mockClear();

    handler.routeChildAgentEvent(childEvent('assistant.delta', 'child-1'));
    expect(requestRender).not.toHaveBeenCalled();

    vi.advanceTimersByTime(80);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });
});

describe('SubAgentEventHandler — subagent.cancelled', () => {
  it('marks a running dynamic_workflow member cancelled instead of leaving it running', () => {
    const { handler, transcriptContainer } = makeDynamicWorkflowHandler();
    startDynamicWorkflowWithChild(handler);
    const component = dynamicWorkflowComponentOf(transcriptContainer);

    handler.handleLifecycleEvent(lifecycleEvent('subagent.cancelled', 'child-1', 'tc-1'));

    const output = component.render(120).join('\n');
    expect(output).toContain('⊘');
  });

  it('keeps the batch-level cancelled label when a member cancel event follows', () => {
    const { handler, transcriptContainer } = makeDynamicWorkflowHandler();
    startDynamicWorkflowWithChild(handler);
    handler.routeChildAgentEvent(childEvent('assistant.delta', 'child-1'));

    handler.handleAgentDynamicWorkflowToolResult(
      'tc-1',
      { output: 'The user manually interrupted this subagent batch.' } as never,
      true,
    );
    handler.handleLifecycleEvent(lifecycleEvent('subagent.cancelled', 'child-1', 'tc-1'));

    const component = dynamicWorkflowComponentOf(transcriptContainer);
    const output = component.render(120).join('\n');
    expect(output).toContain('⊘');
    expect(output).toContain('hello');
  });
});

describe('SubAgentEventHandler — dynamic_workflow grid height measurement', () => {
  it('measures the rows after the transcript once per render pass', async () => {
    const { handler, transcriptContainer, dockChild } = makeDynamicWorkflowHandler();
    startDynamicWorkflowWithChild(handler);
    const component = dynamicWorkflowComponentOf(transcriptContainer);

    component.render(120);
    component.render(120);
    expect(dockChild.render).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    component.render(120);
    expect(dockChild.render).toHaveBeenCalledTimes(2);

    handler.clearAgentDynamicWorkflowProgress();
  });
});
