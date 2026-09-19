import { vi } from 'vitest';

import { getBuiltInPalette } from '#/tui/theme';

export function makeSessionEventHandlerHost(overrides: Record<string, unknown> = {}) {
  const streamingUIOverride =
    overrides.streamingUI !== undefined && typeof overrides.streamingUI === 'object'
      ? (overrides.streamingUI as Record<string, unknown>)
      : undefined;
  const surveyOverride =
    overrides.surveyController !== undefined && typeof overrides.surveyController === 'object'
      ? (overrides.surveyController as Record<string, unknown>)
      : undefined;
  const stateOverride =
    overrides.state !== undefined && typeof overrides.state === 'object'
      ? (overrides.state as Record<string, unknown>)
      : undefined;

  const streamingUI = {
    setTurnId: vi.fn(),
    flushNow: vi.fn(),
    resetToolUi: vi.fn(),
    clearNotifyPanel: vi.fn(),
    markNotifyPanelEnded: vi.fn(),
    setStep: vi.fn(),
    finalizeTurn: vi.fn(),
    getTurnContext: vi.fn(() => ({ turnId: 1, step: 0 })),
    registerToolCall: vi.fn(),
    completeToolResult: vi.fn(),
    setTodoList: vi.fn(),
    ...streamingUIOverride,
  };

  const surveyController = {
    notifyToolCallStarted: vi.fn(),
    notifyToolCallEnded: vi.fn(),
    notifyCompactionFinished: vi.fn(),
    notifySubagentSpawned: vi.fn(),
    ...surveyOverride,
  };

  const rest = { ...overrides };
  delete rest.streamingUI;
  delete rest.surveyController;
  delete rest.state;

  const host = {
    state: {
      footer: { setStreamSpeed: vi.fn() },
      appState: {
        sessionId: 's1',
        streamingPhase: 'waiting',
        model: 'pythinker-model',
        permissionMode: 'auto',
      },
      queuedMessages: [],
      queuedMessageDispatchPending: false,
      theme: { palette: getBuiltInPalette('dark') },
      toolOutputExpanded: false,
      todoPanel: { getTodos: vi.fn(() => []) },
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      ...stateOverride,
    },
    session: overrides.session ?? {},
    aborted: false,
    sessionEventUnsubscribe: undefined,
    streamingUI,
    requireSession: vi.fn(() => overrides.session ?? {}),
    setAppState: vi.fn(),
    patchLivePane: vi.fn(),
    resetLivePane: vi.fn(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    updateActivityPane: vi.fn(),
    track: vi.fn(),
    recordSessionActivity: vi.fn(),
    noteStepUsage: vi.fn(),
    noteCompactionFinished: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    handleShellOutput: vi.fn(),
    handleShellStarted: vi.fn(),
    sendNormalUserInput: vi.fn(),
    updateTerminalTitle: vi.fn(),
    sendQueuedMessage: vi.fn(),
    shiftQueuedMessage: vi.fn(),
    btwPanelController: { routeEvent: vi.fn(() => false) },
    surveyController,
    tasksBrowserController: {},
    ...rest,
  };

  return { host: host as never, streamingUI, surveyController };
}
