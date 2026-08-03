import {
  Container,
  ProcessTerminal,
  TUI,
} from '@earendil-works/pi-tui';

import { FooterComponent } from './components/chrome/footer';
import { GutterContainer } from './components/chrome/gutter-container';
import type { ActivityLoader } from './components/chrome/activity-loader';
import { TodoPanelComponent } from './components/chrome/todo-panel';
import { TranscriptViewport } from './components/chrome/transcript-viewport';
import { ViewportLayoutRoot } from './components/chrome/viewport-layout';
import type { SessionRow } from './components/dialogs/session-picker';
import { CustomEditor } from './components/editor/custom-editor';
import { createFooterState, type FooterState } from './runtime/footer/footer-model';
import type { TuiLayout } from './config';
import { CHROME_GUTTER } from './constant/rendering';
import type { TasksBrowserState } from './controllers/tasks-browser';
import { currentTheme, type Theme } from './theme';
import { createTerminalState, type TerminalState } from './utils/terminal-state';
import {
  INITIAL_LIVE_PANE,
  type AppState,
  type PythinkerTUIOptions,
  type LivePaneState,
  type QueuedMessage,
  type TranscriptEntry,
  type TUIStartupState,
} from './types';

export interface TUIState {
  ui: TUI;
  terminal: ProcessTerminal;
  layout: TuiLayout;
  copyFullResponse: boolean;
  transcriptContainer: Container;
  transcriptViewport: TranscriptViewport;
  layoutRoot: ViewportLayoutRoot;
  footerWrap: GutterContainer;
  activityContainer: Container;
  todoPanelContainer: Container;
  todoPanel: TodoPanelComponent;
  queueContainer: Container;
  btwPanelContainer: Container;
  mcpStatusContainer: Container;
  editorContainer: Container;
  footer: FooterComponent;
  footerState: FooterState;
  editor: CustomEditor;
  theme: Theme;
  appState: AppState;
  startupState: TUIStartupState;
  livePane: LivePaneState;
  transcriptEntries: TranscriptEntry[];
  terminalState: TerminalState;
  activitySpinner: { instance: ActivityLoader } | null;
  toolOutputExpanded: boolean;
  sessions: SessionRow[];
  loadingSessions: boolean;
  sessionsScope: 'cwd' | 'all';
  activeDialog: 'session-picker' | 'help' | null;
  tasksBrowser: TasksBrowserState | undefined;
  externalEditorRunning: boolean;
  queuedMessages: QueuedMessage[];
  dynamicWorkflowModeEntry: 'manual' | 'task' | undefined;
}

export function createTUIState(options: PythinkerTUIOptions): TUIState {
  const initialAppState = options.initialAppState;
  const theme = currentTheme;

  const terminal = new ProcessTerminal();
  const ui = new TUI(terminal);

  const transcriptContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const activityContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const todoPanelContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const todoPanel = new TodoPanelComponent();
  const queueContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const btwPanelContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const mcpStatusContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const editorContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const editor = new CustomEditor(ui);
  const footer = new FooterComponent({ ...initialAppState }, () => {
    ui.requestRender();
  });

  const layout = options.layout;
  const transcriptViewport = new TranscriptViewport(transcriptContainer);
  const footerWrap = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  footerWrap.addChild(footer);
  const layoutRoot = new ViewportLayoutRoot(
    terminal,
    transcriptViewport,
    [
      activityContainer,
      todoPanelContainer,
      queueContainer,
      btwPanelContainer,
      mcpStatusContainer,
      editorContainer,
    ],
    footerWrap,
  );

  return {
    ui,
    terminal,
    layout,
    copyFullResponse: options.copyFullResponse ?? false,
    transcriptContainer,
    transcriptViewport,
    layoutRoot,
    footerWrap,
    activityContainer,
    todoPanelContainer,
    todoPanel,
    queueContainer,
    btwPanelContainer,
    mcpStatusContainer,
    editorContainer,
    editor,
    footer,
    footerState: createFooterState(),
    theme,
    appState: { ...initialAppState },
    startupState: 'pending',
    livePane: { ...INITIAL_LIVE_PANE },
    transcriptEntries: [],
    terminalState: createTerminalState(),
    activitySpinner: null,
    toolOutputExpanded: false,
    sessions: [],
    loadingSessions: false,
    sessionsScope: 'cwd',
    activeDialog: null,
    tasksBrowser: undefined,
    externalEditorRunning: false,
    queuedMessages: [],
    dynamicWorkflowModeEntry: undefined,
  };
}
