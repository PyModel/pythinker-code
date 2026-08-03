
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_STATUS_LINE_CONFIG } from '#/tui/config';
import { createTUIState, type PythinkerTUIOptions } from '#/tui/pythinker-tui';
import { LegacyPiPresentation } from '#/tui/runtime/legacy-pi-presentation';
import type { AppState } from '#/tui/types';

function fakeInitialAppState(): AppState {
  return {
    model: 'test-model',
    workDir: '/tmp/pythinker-test',
    sessionId: 'sess-1',
    permissionMode: 'manual',
    planMode: false,
    dynamicWorkflowMode: false,
thinkingLevel: 'off',
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: 'dark',
    version: '0.0.0-test',
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    statusLine: DEFAULT_STATUS_LINE_CONFIG,
    availableModels: {},
    availableProviders: {},
    sessionTitle: null,
    mcpServersSummary: null,
  };
}

describe('createTUIState', () => {
  it('initializes all fields with sensible defaults', () => {
    const opts: PythinkerTUIOptions = {
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
      layout: 'inline',
    };
    const state = createTUIState(opts);

    // UI objects are created.
    expect(state.ui).toBeDefined();
    expect(state.terminal).toBeDefined();
    expect(state.transcriptContainer).toBeDefined();
    expect(state.transcriptViewport).toBeDefined();
    expect(state.layoutRoot).toBeDefined();
    expect(state.footerWrap).toBeDefined();
    expect(state.layout).toBe('inline');
    expect(state.activityContainer).toBeDefined();
    expect(state.todoPanelContainer).toBeDefined();
    expect(state.queueContainer).toBeDefined();
    expect(state.mcpStatusContainer).toBeDefined();
    expect(state.editorContainer).toBeDefined();
    expect(state.editor).toBeDefined();
    expect(state.footer).toBeDefined();
    expect(state.todoPanel).toBeDefined();
    expect(state.theme.palette).toBeDefined();

    // App state is cloned from initialAppState, not reused by reference.
    expect(state.appState).not.toBe(opts.initialAppState);
    expect(state.appState.model).toBe('test-model');
    expect(state.appState.sessionId).toBe('sess-1');
    expect(state.appState.statusLine).toEqual(DEFAULT_STATUS_LINE_CONFIG);
    expect(state.startupState).toBe('pending');

    // LivePane defaults.
    expect(state.livePane.mode).toBe('idle');
    expect(state.livePane.pendingApproval).toBeNull();
    expect(state.livePane.pendingQuestion).toBeNull();

    // Empty collections.
    expect(state.transcriptEntries).toHaveLength(0);
    expect(state.queuedMessages).toHaveLength(0);

    // Boolean, counter, and optional-field defaults.
    expect(state.toolOutputExpanded).toBe(false);
    expect(state.activeDialog).toBeNull();
    expect(state.externalEditorRunning).toBe(false);
    expect(state.loadingSessions).toBe(false);
    expect(state.sessionsScope).toBe('cwd');
    expect(state.activitySpinner).toBeNull();
  });

  it('starts pi-tui with its input and resize handlers through the legacy presentation', () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
      layout: 'inline',
    });
    const presentation = new LegacyPiPresentation(state);
    let resizeHandler: (() => void) | undefined;
    const terminalStart = vi
      .spyOn(state.terminal, 'start')
      .mockImplementation((_inputHandler, onResize) => {
        resizeHandler = onResize;
      });
    vi.spyOn(state.terminal, 'hideCursor').mockImplementation(() => {});
    const requestRender = vi.spyOn(state.ui, 'requestRender').mockImplementation(() => {});

    presentation.start(() => {});

    expect(terminalStart).toHaveBeenCalledOnce();
    expect(resizeHandler).toBeTypeOf('function');
    requestRender.mockClear();
    resizeHandler?.();
    expect(requestRender).toHaveBeenCalledOnce();
  });

  it('delegates terminal, composer, idle, and shutdown operations without translation', async () => {
    const state = createTUIState({
      initialAppState: fakeInitialAppState(),
      startup: {
        continueLast: false,
        yolo: false,
        auto: false,
        plan: false,
      },
      layout: 'inline',
    });
    const presentation = new LegacyPiPresentation(state);
    const stop = vi.spyOn(state.ui, 'stop').mockImplementation(() => {});
    const drainInput = vi.spyOn(state.terminal, 'drainInput').mockResolvedValue();
    const setTitle = vi.spyOn(state.terminal, 'setTitle').mockImplementation(() => {});
    const setProgress = vi.spyOn(state.terminal, 'setProgress').mockImplementation(() => {});
    const write = vi.spyOn(state.terminal, 'write').mockImplementation(() => {});
    const getText = vi.spyOn(state.editor, 'getText').mockReturnValue('draft');
    const setText = vi.spyOn(state.editor, 'setText').mockImplementation(() => {});
    const setFocus = vi.spyOn(state.ui, 'setFocus').mockImplementation(() => {});
    const addToHistory = vi.spyOn(state.editor, 'addToHistory').mockImplementation(() => {});
    const requestRender = vi.spyOn(state.ui, 'requestRender').mockImplementation(() => {});

    presentation.setTerminalTitle('Title');
    presentation.setTerminalProgress(true);
    presentation.writeTerminalControl('\u001B[2J');
    expect(presentation.getComposerText()).toBe('draft');
    presentation.setComposerText('next');
    presentation.focusComposer();
    presentation.addComposerHistory('previous');
    presentation.notifyIdle();
    await presentation.drainInput();
    presentation.stop();

    expect(setTitle).toHaveBeenCalledWith('Title');
    expect(setProgress).toHaveBeenCalledWith(true);
    expect(write).toHaveBeenCalledWith('\u001B[2J');
    expect(getText).toHaveBeenCalledOnce();
    expect(setText).toHaveBeenCalledWith('next');
    expect(setFocus).toHaveBeenCalledWith(state.editor);
    expect(addToHistory).toHaveBeenCalledWith('previous');
    expect(requestRender).toHaveBeenCalledOnce();
    expect(drainInput).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
