import { vi } from 'vitest';

import { getBuiltInPalette } from '#/tui/theme';

type HostOverrides = {
  streamingUI?: Record<string, unknown>;
  surveyController?: Record<string, unknown>;
  state?: Record<string, unknown>;
  session?: unknown;
  [key: string]: unknown;
};

export function makeSessionEventHandlerHost(overrides: HostOverrides = {}): {
  readonly host: never;
  readonly streamingUI: never;
  readonly surveyController: never;
} {
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
    ...overrides.streamingUI,
  };

  const surveyController = {
    notifyToolCallStarted: vi.fn(),
    notifyToolCallEnded: vi.fn(),
    notifyCompactionFinished: vi.fn(),
    notifySubagentSpawned: vi.fn(),
    ...overrides.surveyController,
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
      ...overrides.state,
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

  return { host: host as never, streamingUI: streamingUI as never, surveyController: surveyController as never };
}
