import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  deleteAllKittyImages,
  type Component,
  type Focusable,
  getCapabilities,
  Spacer,
} from '@earendil-works/pi-tui';
import type {
  ApprovalRequest,
  ApprovalResponse,
  BackgroundTaskInfo,
  CreateSessionOptions,
  PythinkerHarness,
  PermissionMode,
  PromptPart,
  Session,
} from '@pymodel/pythinker-code-sdk';
import type { MigrationPlan } from '@pymodel/migration-legacy';
import { resolve } from 'pathe';

import type { CLIOptions } from '#/cli/options';
import { readUpdateCache } from '#/cli/update/cache';
import { readUpdateInstallState } from '#/cli/update/install-state';
import { detectInstallSource } from '#/cli/update/source';
import type { InstallSource } from '#/cli/update/types';
import { MigrationScreenComponent, type MigrationScreenResult } from '#/migration/index';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';
import {
  appendInputHistory,
  loadInputHistory,
  selectRecentInputHistory,
} from '#/utils/history/input-history';
import { openUrl } from '#/utils/open-url';
import { getInputHistoryFile } from '#/utils/paths';
import { detectFdPath, ensureFdPath } from '#/utils/process/fd-detect';
import { quoteShellArg } from '#/utils/shell-quote';

import { BannerProvider } from './banner/banner-provider';
import { readBannerDisplayState, writeBannerDisplayState } from './banner/state';
import {
  BUILTIN_SLASH_COMMANDS,
  buildSkillSlashCommands,
  sortSlashCommands,
  type PythinkerSlashCommand,
  type SkillListSession,
  type SkillSlashCommands,
} from './commands';
import {
  isExperimentalFlagEnabled,
  onExperimentalFeaturesChanged,
  setExperimentalFeatures,
} from './commands/experimental-flags';
import {
  isDynamicWorkflowDisabled,
  setDynamicWorkflowDisabled,
  setWorkflowSizeGuideline,
} from './commands/workflow-availability';
import * as slashCommands from './commands/dispatch';
import { BannerComponent } from './components/chrome/banner';
import { ActivityLoader } from './components/chrome/activity-loader';
import { WelcomeComponent } from './components/chrome/welcome';
import {
  ApprovalPanelComponent,
  type ApprovalPanelResponse,
} from './components/dialogs/approval-panel';
import {
  ApprovalPreviewViewer,
  type ApprovalPreviewBlock,
} from './components/dialogs/approval-preview';
import { CompactionComponent } from './components/dialogs/compaction';
import { ChoicePickerComponent } from './components/dialogs/choice-picker';
import {
  HelpPanelComponent,
  type KeyboardShortcut,
} from './components/dialogs/help-panel';
import { QuestionDialogComponent } from './components/dialogs/question-dialog';
import { SessionPickerComponent, type SessionRow } from './components/dialogs/session-picker';
import {
  FileMentionProvider,
  type SlashAutocompleteCommand,
} from './components/editor/file-mention-provider';
import { findSlashAutocompleteContext } from './components/editor/slash-autocomplete-context';
import { AssistantMessageComponent } from './components/messages/assistant-message';
import { BackgroundAgentStatusComponent } from './components/messages/background-agent-status';
import { CronMessageComponent } from './components/messages/cron-message';
import { buildGoalMarker } from './components/messages/goal-markers';
import {
  GoalCompletionMessageComponent,
  GoalSetMessageComponent,
} from './components/messages/goal-panel';
import { SkillActivationComponent } from './components/messages/skill-activation';
import {
  NoticeMessageComponent,
  StatusMessageComponent,
} from './components/messages/status-message';
import { ThinkingComponent } from './components/messages/thinking';
import { ToolCallComponent } from './components/messages/tool-call';
import { UserMessageComponent } from './components/messages/user-message';
import { ActivityPaneComponent, type ActivityPaneMode } from './components/panes/activity-pane';
import { QueuePaneComponent } from './components/panes/queue-pane';
import type { TuiConfig } from './config';
import {
  LLM_NOT_SET_MESSAGE,
  MAIN_AGENT_ID,
  NO_ACTIVE_SESSION_MESSAGE,
  PRODUCT_NAME,
} from './constant/pythinker-tui';
import { MAX_TERMINAL_TITLE_LENGTH } from './constant/terminal';
import { AuthFlowController } from './controllers/auth-flow';
import { BtwPanelController } from './controllers/btw-panel';
import { EditorKeyboardController } from './controllers/editor-keyboard';
import {
  footerStatusFromAppState,
  type FooterActionId,
} from '#/tui/components/chrome/footer';
import { MouseController } from './controllers/mouse-controller';
import { SessionEventHandler } from './controllers/session-event-handler';
import { SessionReplayRenderer } from './controllers/session-replay';
import { StreamingUIController } from './controllers/streaming-ui';
import { TasksBrowserController } from './controllers/tasks-browser';
import { installRainbowColors } from './easter-eggs/rainbow-colors';
import {
  defaultKeybindings,
  editorShortcutHelp,
  isKeybindingAware,
  loadKeybindings,
  watchKeybindings,
} from './keybindings';
import { adaptPanelResponse } from './reverse-rpc/approval/adapter';
import { ApprovalController } from './reverse-rpc/approval/controller';
import { createApprovalRequestHandler } from './reverse-rpc/approval/handler';
import { registerReverseRPCHandlers } from './reverse-rpc/index';
import { QuestionController } from './reverse-rpc/question/controller';
import { createQuestionAskHandler } from './reverse-rpc/question/handler';
import type { ApprovalPanelData, QuestionPanelData } from './reverse-rpc/types';
import type { TuiPresentation } from './runtime/contracts';
import {
  foldFooterEvents,
  selectFooterViewModel,
  selectStatusBarExtras,
  selectStatusItemParts,
  type FooterActivity,
  type FooterEvent,
  type FooterGoal,
  type FooterUpdate,
} from './runtime/footer/footer-model';
import { footerUpdateFromState } from './runtime/footer/update-status';
import { LegacyPiPresentation } from './runtime/legacy-pi-presentation';
import { currentTheme, getColorPalette, getBuiltInPalette, isBuiltInTheme } from './theme';
import type { ColorToken, ResolvedTheme, ThemeName } from './theme';
import { createTUIState, type TUIState } from './tui-state';
import {
  INITIAL_LIVE_PANE,
  type AppState,
  type PythinkerTUIOptions,
  type LivePaneState,
  type LoginProgressSpinnerHandle,
  type QueuedMessage,
  type TranscriptEntry,
} from './types';
import { isExpandable } from './utils/component-capabilities';
import { isDeadTerminalError } from './utils/dead-terminal';
import { formatErrorMessage } from './utils/event-payload';
import { ImageAttachmentStore, type ImageAttachment } from './utils/image-attachment-store';
import { extractMediaAttachments } from './utils/image-placeholder';
import { REPLAY_TURN_LIMIT } from './utils/message-replay';
import { hasPatchChanges } from './utils/object-patch';
import { sessionRowsForPicker } from './utils/session-picker-rows';
import { combineStartupNotice, isOAuthLoginRequiredError } from './utils/startup';
import { installTerminalFocusTracking } from './utils/terminal-focus';
import { notifyTerminalOnce } from './utils/terminal-notification';
import { waitForTerminalSize } from './utils/terminal-size';
import { installTerminalThemeTracking } from './utils/terminal-theme';
import { detectTmuxKeyboardWarning } from './utils/tmux-keyboard';
import { markTranscriptComponent } from './utils/transcript-component-metadata';
import { nextTranscriptId } from './utils/transcript-id';

export type { TUIState } from './tui-state';
export { createTUIState } from './tui-state';
export type {
  PythinkerTUIOptions,
  LoginProgressSpinnerHandle,
  TUIStartupOptions,
  TUIStartupState,
} from './types';

export interface PythinkerTUIStartupInput {
  readonly cliOptions: CLIOptions;
  readonly tuiConfig: TuiConfig;
  readonly version: string;
  readonly workDir: string;
  readonly startupNotice?: string;
  readonly migrationPlan?: MigrationPlan | null;
  /** When true, run only the migration screen, then exit (the `pythinker migrate` command). */
  readonly migrateOnly?: boolean;
}

type EffectiveActivityPaneMode = ActivityPaneMode | 'idle' | 'session';

/** Poll cadence for the update cache and install state files. */
const UPDATE_STATUS_POLL_INTERVAL_MS = 2_000;

function footerUpdateEquals(a: FooterUpdate, b: FooterUpdate): boolean {
  return a.version === b.version && a.state === b.state && a.percent === b.percent;
}

function createInitialAppState(input: PythinkerTUIStartupInput): AppState {
  const startupPermission: PermissionMode = input.cliOptions.auto
    ? 'auto'
    : input.cliOptions.yolo
      ? 'yolo'
      : 'manual';
  return {
    model: '',
    workDir: input.workDir,
    sessionId: '',
    permissionMode: startupPermission,
    planMode: input.cliOptions.plan,
    dynamicWorkflowMode: false,
    fastMode: false,
    fastModeSupported: false,
    thinkingLevel: 'off',
    contextUsage: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isCompacting: false,
    isReplaying: false,
    streamingPhase: 'idle',
    streamingStartTime: 0,
    theme: input.tuiConfig.theme,
    version: input.version,
    editorCommand: input.tuiConfig.editorCommand,
    notifications: input.tuiConfig.notifications,
    upgrade: input.tuiConfig.upgrade,
    statusLine: input.tuiConfig.statusLine,
    availableModels: {},
    availableProviders: {},
    sessionTitle: null,
    goal: null,
    mcpServersSummary: null,
    banner: undefined,
  };
}

interface SendMessageOptions {
  readonly parts?: readonly PromptPart[];
  readonly imageAttachmentIds?: readonly number[];
  readonly hasMedia?: boolean;
}

export class PythinkerTUI {
  readonly harness: PythinkerHarness;
  readonly options: PythinkerTUIOptions;
  session: Session | undefined;
  state: TUIState;
  readonly presentation: TuiPresentation;
  private readonly approvalController = new ApprovalController();
  private readonly questionController = new QuestionController();
  private readonly reverseRpcDisposers: Array<() => void> = [];
  private skillCommands: readonly PythinkerSlashCommand[] = [];
  readonly skillCommandMap = new Map<string, string>();
  /** Bumped per refresh so a slow one cannot apply over a newer one. */
  private skillCommandRefresh = 0;
  /** The session whose skills the commands on screen were built from. */
  private skillCommandSession: SkillListSession | undefined;
  private readonly imageStore = new ImageAttachmentStore();
  private fdPath: string | null = detectFdPath();
  private fdDownloadStarted = false;
  sessionEventUnsubscribe: (() => void) | undefined;
  cancelInFlight: (() => void) | undefined;
  deferUserMessages = false;
  aborted = false;
  private terminalFocusTrackingDispose: (() => void) | undefined;
  private terminalThemeTrackingDispose: (() => void) | undefined;
  private uninstallRainbowColors: () => void;
  private signalCleanupHandlers: Array<() => void> = [];
  private isShuttingDown = false;
  private readonly migrationPlan: MigrationPlan | null;
  private readonly migrateOnly: boolean;
  private startupNotice: string | undefined;
  private keyboardShortcuts: readonly KeyboardShortcut[] = [];
  private keybindings = defaultKeybindings();
  private hasInstalledKeybindings = false;
  private mountedEditorReplacement: (Component & Focusable) | undefined;
  private lastActivityMode: string | undefined;
  private lastHistoryContent: string | undefined;
  private footerGoalSnapshotKey: string | null = null;
  private footerGoalObservedAtMs = Date.now();
  readonly streamingUI: StreamingUIController;
  readonly authFlow: AuthFlowController;
  readonly btwPanelController: BtwPanelController;
  readonly sessionEventHandler: SessionEventHandler;
  readonly sessionReplay: SessionReplayRenderer;
  readonly tasksBrowserController: TasksBrowserController;
  readonly editorKeyboard: EditorKeyboardController;
  readonly mouseController: MouseController;

  // The currently-mounted approval panel, if any. Kept so the full-screen
  // preview viewer can restore focus to the exact same instance (and its
  // selection / feedback state) when it closes.
  private activeApprovalPanel: ApprovalPanelComponent | undefined;
  // Active full-screen approval preview. While set, the root UI's normal
  // children are stashed in `savedChildren`; closing restores them.
  private approvalPreview:
    | {
        component: ApprovalPreviewViewer;
        savedChildren: readonly Component[];
        panel: ApprovalPanelComponent;
      }
    | undefined;
  private stopKeybindingsWatcher: (() => void) | undefined;
  private updateStatusSource: InstallSource | null = null;
  private updateStatusTimer: ReturnType<typeof setInterval> | undefined;
  private lastDispatchedUpdate: FooterUpdate = {
    version: null,
    state: null,
    percent: null,
  };

  public onExit?: (exitCode?: number) => Promise<void>;

  /** URL opened in the browser just before exit (e.g. by `/web`); printed by onExit. */
  public exitOpenUrl: string | undefined;

  track(event: string, properties?: Parameters<PythinkerHarness['track']>[1]): void {
    this.harness.track(event, properties);
  }

  constructor(
    harness: PythinkerHarness,
    startupInput: PythinkerTUIStartupInput,
    presentation?: TuiPresentation,
  ) {
    this.harness = harness;
    const tuiOptions: PythinkerTUIOptions = {
      initialAppState: createInitialAppState(startupInput),
      startup: {
        sessionFlag: startupInput.cliOptions.session,
        continueLast: startupInput.cliOptions.continue,
        yolo: startupInput.cliOptions.yolo,
        auto: startupInput.cliOptions.auto,
        init: startupInput.cliOptions.init,
        maintenance: startupInput.cliOptions.maintenance,
        plan: startupInput.cliOptions.plan,
        model: startupInput.cliOptions.model,
        additionalDirs: startupInput.cliOptions.additionalDirs ?? [],
        startupNotice: startupInput.startupNotice,
      },
      layout: startupInput.tuiConfig.layout,
      copyFullResponse: startupInput.tuiConfig.copyFullResponse,
    };
    this.options = tuiOptions;
    this.migrationPlan = startupInput.migrationPlan ?? null;
    this.migrateOnly = startupInput.migrateOnly ?? false;
    this.startupNotice = startupInput.startupNotice;
    this.state = createTUIState(tuiOptions);
    const keybindingWarnings = this.reloadKeybindings();
    if (keybindingWarnings.length > 0) {
      this.startupNotice = combineStartupNotice(
        this.startupNotice,
        `Keybindings: ${keybindingWarnings.join(' ')}`,
      );
    }
    onExperimentalFeaturesChanged(() => {
      this.state.editor.setVimMode(isExperimentalFlagEnabled('vim_mode'));
    });
    this.presentation = presentation ?? new LegacyPiPresentation(this.state);
    this.state.footer.setRefreshHandler(() => this.refreshFooter());
    this.syncFooterState();
    this.uninstallRainbowColors = installRainbowColors(() => {
      this.state.ui.requestRender();
    });

    this.reverseRpcDisposers.push(
      ...registerReverseRPCHandlers(this.approvalController, this.questionController, {
        showApprovalPanel: (payload) => {
          this.showApprovalPanel(payload);
        },
        hideApprovalPanel: () => {
          this.hideApprovalPanel();
        },
        showQuestionDialog: (payload) => {
          this.showQuestionDialog(payload);
        },
        hideQuestionDialog: () => {
          this.hideQuestionDialog();
        },
      }),
    );
    this.streamingUI = new StreamingUIController(this);
    this.authFlow = new AuthFlowController(this);
    this.btwPanelController = new BtwPanelController(this);
    this.sessionEventHandler = new SessionEventHandler(this);
    this.sessionReplay = new SessionReplayRenderer(this);
    this.tasksBrowserController = new TasksBrowserController(this);
    this.editorKeyboard = new EditorKeyboardController(this, this.imageStore);
    this.editorKeyboard.setKeybindings(this.keybindings);
    this.editorKeyboard.install();
    this.mouseController = new MouseController(this);
    this.buildLayout();
  }

  // =========================================================================
  // Autocomplete & Skill Commands
  // =========================================================================

  private getSlashCommands(): readonly PythinkerSlashCommand[] {
    const builtins = sortSlashCommands(BUILTIN_SLASH_COMMANDS).filter(
      (command) =>
        command.hidden !== true &&
        (command.name !== 'workflow' || !isDynamicWorkflowDisabled()) &&
        isExperimentalFlagEnabled(command.experimentalFlag),
    );
    return [...builtins, ...this.skillCommands];
  }

  private setupAutocomplete(): void {
    const slashCommands: SlashAutocompleteCommand[] = this.getSlashCommands().map((cmd) => {
      const completer = cmd.completeArgs;
      return {
        name: cmd.name,
        aliases: cmd.aliases,
        description: cmd.description,
        ...(cmd.argumentHint !== undefined ? { argumentHint: cmd.argumentHint } : {}),
        ...(completer !== undefined
          ? { getArgumentCompletions: (prefix: string) => completer(prefix) }
          : {}),
      };
    });
    const provider = new FileMentionProvider(
      slashCommands,
      this.state.appState.workDir,
      this.fdPath,
    );
    this.state.editor.setAutocompleteProvider(provider);
  }

  /**
   * The one way to refresh the slash-command set. Every caller that can change
   * it — session switch, login/logout, experimental flags, `/reload`, saving a
   * workflow — goes through here, so autocomplete and `skillCommandMap` are
   * never rebuilt from a skill list that has moved on.
   */
  async refreshSkillCommands(session?: SkillListSession): Promise<void> {
    const refresh = (this.skillCommandRefresh += 1);
    if (session === undefined) {
      this.skillCommandSession = undefined;
      this.skillCommands = [];
      this.skillCommandMap.clear();
      this.setupAutocomplete();
      return;
    }

    let built: SkillSlashCommands | undefined;
    try {
      built = buildSkillSlashCommands(await session.listSkills());
    } catch {
      // What to do about a failure depends on which session the commands on
      // screen came from, and that is only decided after the await below.
    }

    // A refresh that started later has already applied. Several callers start
    // this without awaiting it, so a slow list for the session the user just
    // left would otherwise land on top of the one they switched to.
    if (refresh !== this.skillCommandRefresh) return;

    if (built === undefined && this.skillCommandSession === session) {
      // A transient failure for the session already on screen: its commands are
      // still the right ones, so keep them. The builtin command set may still
      // have changed, so the autocomplete provider is rebuilt either way.
      this.setupAutocomplete();
      return;
    }

    // Either it listed, or it failed for a session whose skills were never on
    // screen — keeping another session's commands would be worse than none.
    this.skillCommandSession = built === undefined ? undefined : session;
    this.skillCommands = built?.commands ?? [];
    this.skillCommandMap.clear();
    for (const [commandName, skillName] of built?.commandMap ?? []) {
      this.skillCommandMap.set(commandName, skillName);
    }
    this.setupAutocomplete();
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async start(): Promise<void> {
    // Signal handlers must be installed before raw mode to avoid EIO loops.
    this.registerSignalHandlers();
    // Outer try rolls back signal listeners on startup failure.
    try {
      if (this.migrationPlan !== null) {
        // Migration needs the event loop running first (pi-tui component).
        this.startEventLoop();
        try {
          const migrationResult = await this.runMigrationScreen(this.migrationPlan);
          if (this.migrateOnly) {
            const failed = migrationResult.decision === 'now' && migrationResult.migrated === false;
            this.mouseController.stop();
            this.disposeTerminalTracking();
            this.presentation.stop();
            await this.onExit?.(failed ? 1 : 0);
            return;
          }
          const shouldReplayHistory = await this.initMainTui();
          this.startBackgroundFdAutocomplete();
          await this.finishStartup(shouldReplayHistory);
          this.startKeybindingsWatcher();
        } catch (error) {
          this.mouseController.stop();
          this.disposeTerminalTracking();
          this.presentation.stop();
          throw error;
        }
        return;
      }

      // Start the loop before mounting anything: pi-tui paints on invalidate
      // even before ui.start(), so mounting first anchors early frames to the
      // shell cursor and startEventLoop's scroll-to-home would push the live
      // frame's top rows into scrollback for good. Same order as the
      // migration branch above.
      this.startEventLoop();
      try {
        const shouldReplayHistory = await this.initMainTui();
        this.startBackgroundFdAutocomplete();
        await this.finishStartup(shouldReplayHistory);
        this.startKeybindingsWatcher();
      } catch (error) {
        this.mouseController.stop();
        this.disposeTerminalTracking();
        this.presentation.stop();
        throw error;
      }
    } catch (error) {
      this.unregisterSignalHandlers();
      throw error;
    }
  }

  private async loadBanner(): Promise<void> {
    const provider = new BannerProvider(this.state.appState.version);
    const displayState = await readBannerDisplayState();
    const now = new Date();
    const banner = await provider.load(fetch, {
      state: displayState,
      now,
    });
    this.state.appState.banner = banner;
    if (banner === null) return;

    this.renderBanner();
    this.state.ui.requestRender();

    if (banner.display === 'always') return;
    try {
      await writeBannerDisplayState({
        version: 1,
        shown: {
          ...displayState.shown,
          [banner.key]: { lastShownAt: now.toISOString() },
        },
      });
    } catch {
      // Best-effort: banner display state should never block startup.
    }
  }

  private renderBanner(): void {
    if (this.state.appState.banner === null || this.state.appState.banner === undefined) {
      return;
    }
    if (this.state.transcriptContainer.children.some((child) => child instanceof BannerComponent)) {
      return;
    }
    const welcomeIndex = this.state.transcriptContainer.children.findIndex(
      (child) => child instanceof WelcomeComponent,
    );
    const banner = new BannerComponent(this.state.appState.banner);
    if (welcomeIndex >= 0) {
      this.state.transcriptContainer.addTranscriptChildAt(welcomeIndex + 1, banner, {
        role: 'ephemeral',
        edgeBlankPolicy: 'preserve',
      });
    } else {
      this.state.transcriptContainer.addTranscriptChildAt(0, banner, {
        role: 'ephemeral',
        edgeBlankPolicy: 'preserve',
      });
    }
    this.state.transcriptContainer.invalidate();
  }

  private async initMainTui(): Promise<boolean> {
    const shouldReplayHistory = await this.init();

    // Mount only after init() succeeds; see mountFooter().
    this.mountFooter();
    this.renderWelcome();
    void this.loadBanner();
    this.setupAutocomplete();
    void this.loadPersistedInputHistory();
    this.state.editorContainer.clear();
    this.state.editorContainer.addChild(this.state.editor);
    this.presentation.focusComposer();
    return shouldReplayHistory;
  }

  private startEventLoop(): void {
    const start = (): void => {
      // The fixed layout emits exactly `terminal.rows` lines per frame, and
      // pi-tui's first render assumes a clean screen. Any shell output already
      // on screen would scroll the frame's top rows (panel border included)
      // out of view for good, so scroll the history up first and start at home.
      if (this.state.layout === 'fixed') {
        const rows = this.state.terminal.rows;
        this.presentation.writeTerminalControl('\n'.repeat(Math.max(1, rows)) + '\u001B[H');
      }
      this.presentation.start(() => {
        this.refreshFooter();
        this.state.ui.requestRender();
      });
      this.terminalFocusTrackingDispose = installTerminalFocusTracking(this.state);
      this.refreshTerminalThemeTracking();
      if (this.state.layout === 'fixed') {
        this.mouseController.start();
      }
    };

    if (typeof process.stdout.columns === 'number' && process.stdout.columns > 0) {
      start();
      return;
    }
    void waitForTerminalSize(process.stdout).then(start);
  }

  private startBackgroundFdAutocomplete(): void {
    if (this.fdPath !== null || this.fdDownloadStarted) return;
    this.fdDownloadStarted = true;

    void ensureFdPath()
      .then((fdPath) => {
        if (fdPath === null) return;
        this.fdPath = fdPath;
        this.setupAutocomplete();
      })
      .catch(() => {
        // Best-effort background bootstrap: autocomplete keeps using the filesystem fallback.
      });
  }

  // Update availability + install progress poll. The install source is
  // resolved once — it cannot change mid-session and detecting it repeatedly
  // costs a subprocess. Both state files are read off the render path, and a
  // quiet session repaints only when the computed update changes.
  private startUpdateStatusPolling(): void {
    void (async () => {
      let source: InstallSource = 'unsupported';
      try {
        source = await detectInstallSource();
      } catch {
        // Detection failure means the update flow treats this install as unsupported.
      }
      this.updateStatusSource = source;
      if (this.isShuttingDown) return;
      await this.pollUpdateStatus();
      if (this.isShuttingDown) return;
      this.updateStatusTimer = setInterval(() => {
        void this.pollUpdateStatus();
      }, UPDATE_STATUS_POLL_INTERVAL_MS);
      // A cosmetic poll must never be the reason the process refuses to exit.
      this.updateStatusTimer.unref();
    })();
  }

  private async pollUpdateStatus(): Promise<void> {
    if (this.isShuttingDown || this.updateStatusSource === null) return;
    try {
      const [cache, installState] = await Promise.all([
        readUpdateCache(),
        readUpdateInstallState(),
      ]);
      const update = footerUpdateFromState(
        this.state.appState.version,
        this.updateStatusSource,
        cache,
        installState,
      );
      if (footerUpdateEquals(this.lastDispatchedUpdate, update)) return;
      this.lastDispatchedUpdate = update;
      this.dispatchFooter({ type: 'update.updated', update });
    } catch {
      // An unreadable update state file means "no update to show", never a crash.
    }
  }

  private stopUpdateStatusPolling(): void {
    if (this.updateStatusTimer === undefined) return;
    clearInterval(this.updateStatusTimer);
    this.updateStatusTimer = undefined;
  }

  private async refreshProviderModelsInBackground(): Promise<void> {
    try {
      const result = await this.authFlow.refreshProviderModels();
      for (const c of result.changed) {
        if (c.added <= 0) continue;
        this.showStatus(`${c.providerName} · +${String(c.added)} model${c.added > 1 ? 's' : ''}.`);
      }
      for (const f of result.failed) {
        this.showStatus(`Skipped refreshing ${f.provider}: ${f.reason}`, 'warning');
      }
    } catch {
      // Best-effort: startup must not crash on background refresh failures.
    }
  }

  private async finishStartup(shouldReplayHistory: boolean): Promise<void> {
    this.startUpdateStatusPolling();
    if (this.startupNotice !== undefined) {
      this.showStatus(this.startupNotice);
      this.startupNotice = undefined;
    }
    void this.showTmuxKeyboardWarningIfNeeded();
    if (this.state.startupState === 'picker') {
      void this.bootstrapFromPicker();
      return;
    }
    if (shouldReplayHistory) {
      await this.sessionReplay.hydrateFromReplay(this.requireSession());
      this.applyStartupPermissionAndPlanToAppState();
    }
    if (this.session !== undefined) {
      this.sessionEventHandler.startSubscription();
    }
    void this.fetchSessions();
    if (this.session !== undefined) {
      this.updateTerminalTitle();
    }
    void this.refreshSkillCommands(this.session);
  }

  private async showTmuxKeyboardWarningIfNeeded(): Promise<void> {
    const warning = await detectTmuxKeyboardWarning();
    if (warning === undefined || this.aborted) return;
    this.showStatus(warning, 'warning');
  }

  private async init(): Promise<boolean> {
    setExperimentalFeatures(await this.harness.getExperimentalFeatures());
    const pythinkerConfig = await this.harness.getConfig();
    setDynamicWorkflowDisabled(pythinkerConfig.disableWorkflows);
    setWorkflowSizeGuideline(pythinkerConfig.workflowSizeGuideline);
    await this.authFlow.refreshAvailableModels();
    void this.refreshProviderModelsInBackground();

    const { startup } = this.options;
    const { workDir } = this.state.appState;
    let session: Session | undefined;
    let shouldReplayHistory = false;
    const isResumeStartup = startup.sessionFlag !== undefined || startup.continueLast;
    const createSessionOptions: CreateSessionOptions = {
      workDir,
      model: startup.model,
      permission: startup.auto ? 'auto' : startup.yolo ? 'yolo' : undefined,
      setupTrigger: startup.init ? 'init' : startup.maintenance ? 'maintenance' : undefined,
      planMode: startup.plan ? true : undefined,
    };

    try {
      if (isResumeStartup) {
        if (startup.sessionFlag === '') {
          this.state.startupState = 'picker';
          return false;
        }

        if (startup.sessionFlag !== undefined) {
          const sessions = await this.harness.listSessions({
            sessionId: startup.sessionFlag,
            workDir,
          });
          const target = sessions[0];
          if (target === undefined) {
            throw new Error(`Session "${startup.sessionFlag}" not found.`);
          }
          if (resolve(target.workDir) !== resolve(workDir)) {
            this.presentation.stop();
            process.stderr.write(
              `${currentTheme.fg(
                'warning',
                `Session "${startup.sessionFlag}" was created under a different directory.\n` +
                  `  cd "${target.workDir}" && pythinker -r ${startup.sessionFlag}`,
              )}\n\n`,
            );
            throw new Error(
              `Session "${startup.sessionFlag}" was created under a different directory.`,
            );
          }
          session = await this.harness.resumeSession({
            id: startup.sessionFlag,
            setupTrigger: startup.init ? 'init' : startup.maintenance ? 'maintenance' : undefined,
            replayTurnLimit: REPLAY_TURN_LIMIT,
          });
          shouldReplayHistory = true;
        } else {
          const sessions = await this.harness.listSessions({ workDir });
          const target = sessions[0];
          if (target !== undefined) {
            session = await this.harness.resumeSession({
              id: target.id,
              setupTrigger: startup.init ? 'init' : startup.maintenance ? 'maintenance' : undefined,
              replayTurnLimit: REPLAY_TURN_LIMIT,
            });
            shouldReplayHistory = true;
          } else {
            session = await this.harness.createSession(createSessionOptions);
            this.startupNotice = combineStartupNotice(
              this.startupNotice,
              `No sessions to continue under "${workDir}"; starting a fresh session.`,
            );
          }
        }
      } else {
        session = await this.harness.createSession(createSessionOptions);
      }
      if (session !== undefined && shouldReplayHistory) {
        await this.applyStartupModesToResumedSession(session);
        if (startup.model !== undefined) {
          await session.setModel(startup.model);
        }
      }
    } catch (error) {
      if (!isOAuthLoginRequiredError(error)) throw error;
      this.authFlow.enterLoginRequiredStartupState();
      return false;
    }

    if (session === undefined) {
      throw new Error('Startup session was not initialized.');
    }
    for (const directory of startup.additionalDirs ?? []) {
      try {
        await session.addWorkspaceDirectory(directory);
      } catch (error) {
        this.startupNotice = combineStartupNotice(
          this.startupNotice,
          `Could not add working directory "${directory}": ${formatErrorMessage(error)}`,
        );
      }
    }
    await this.setSession(session);
    await this.syncRuntimeState(session);
    this.applyStartupPermissionAndPlanToAppState();
    this.state.startupState = 'ready';
    return shouldReplayHistory;
  }

  async stop(exitCode?: number): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.unregisterSignalHandlers();
    this.mouseController.stop();
    this.aborted = true;
    this.streamingUI.discardPending();
    this.editorKeyboard.clearPendingExit();
    this.stopKeybindingsWatcher?.();
    this.stopKeybindingsWatcher = undefined;
    this.stopUpdateStatusPolling();
    for (const dispose of this.reverseRpcDisposers) {
      dispose();
    }
    this.reverseRpcDisposers.length = 0;
    this.disposeTerminalTracking();
    await this.closeSession('shutting down');
    await this.harness.close();
    this.sessionEventHandler.disposeMcpServerStatusRows();
    this.uninstallRainbowColors();
    await this.presentation.drainInput();
    this.presentation.stop();
    if (this.onExit) {
      await this.onExit(exitCode);
    }
  }

  // SIGHUP / dead-terminal EIO → emergencyTerminalExit (no cleanup, avoids
  // EIO write-loop that can pin a CPU core). SIGTERM → normal stop().
  private registerSignalHandlers(): void {
    this.unregisterSignalHandlers();

    const signals: NodeJS.Signals[] = ['SIGTERM'];
    if (process.platform !== 'win32') {
      signals.push('SIGHUP');
    }

    for (const signal of signals) {
      const handler = (): void => {
        if (signal === 'SIGHUP') {
          this.emergencyTerminalExit();
          return;
        }
        // Registering a SIGTERM listener disables Node's default exit(143),
        // so we must reinstate it after stop() or on failure.
        this.stop(143).then(
          () => {
            process.exit(143);
          },
          () => {
            this.emergencyTerminalExit(143);
          },
        );
      };
      process.prependListener(signal, handler);
      this.signalCleanupHandlers.push(() => {
        process.off(signal, handler);
      });
    }

    const terminalErrorHandler = (error: Error): void => {
      if (isDeadTerminalError(error)) {
        this.emergencyTerminalExit();
      }
    };
    process.stdout.on('error', terminalErrorHandler);
    process.stderr.on('error', terminalErrorHandler);
    this.signalCleanupHandlers.push(() => {
      process.stdout.off('error', terminalErrorHandler);
    }, () => {
      process.stderr.off('error', terminalErrorHandler);
    });
  }

  private unregisterSignalHandlers(): void {
    const handlers = this.signalCleanupHandlers;
    this.signalCleanupHandlers = [];
    for (const cleanup of handlers) cleanup();
  }

  // Exit codes follow POSIX 128+signum: 129 = SIGHUP, 143 = SIGTERM.
  private emergencyTerminalExit(exitCode = 129): never {
    this.isShuttingDown = true;
    this.unregisterSignalHandlers();
    this.mouseController.stop();
    process.exit(exitCode);
  }

  private disposeTerminalTracking(): void {
    this.stopTerminalThemeTracking();
    this.terminalFocusTrackingDispose?.();
    this.terminalFocusTrackingDispose = undefined;
  }

  private buildLayout(): void {
    const { ui } = this.state;
    ui.clear();
    if (this.state.layout === 'fixed') {
      // Full-height root: transcript viewport + chrome + footer fill the
      // screen; the editor stays pinned to the bottom (mountFooter toggles
      // the footer slot once init succeeds).
      ui.addChild(this.state.layoutRoot);
      return;
    }
    ui.addChild(this.state.transcriptContainer);
    ui.addChild(this.state.activityContainer);
    ui.addChild(this.state.todoPanelContainer);
    ui.addChild(this.state.queueContainer);
    ui.addChild(this.state.btwPanelContainer);
    ui.addChild(this.state.mcpStatusContainer);
    ui.addChild(this.state.editorContainer);
    ui.addChild(this.state.statusBarContainer);
    // Footer is mounted later (mountFooter), not here.
  }

  // Footer is the only chrome with content before a session is ready, so
  // mounting it at construction lets a stray pre-start render leak it to the
  // terminal — e.g. above the error when resuming a missing session. Mount it
  // only once init() succeeds. FooterComponent isn't a Container, so wrap it to
  // pick up the same outer gutter as the panels above.
  private mountFooter(): void {
    this.state.statusBarContainer.clear();
    this.state.statusBarContainer.addChild(this.state.statusBar);
    if (this.state.layout === 'fixed') {
      this.state.layoutRoot.setFooterMounted(true);
      return;
    }
    this.state.ui.addChild(this.state.footerWrap);
  }

  // =========================================================================
  // Input Dispatch
  // =========================================================================

  handleUserInput(text: string): void {
    if (text.trim().length === 0) return;
    if (this.state.appState.isReplaying) {
      this.showError('Cannot send input while session history is replaying.');
      return;
    }
    void this.persistInputHistory(text);
    slashCommands.dispatchInput(this, text);
  }

  sendNormalUserInput(text: string): void {
    if (this.btwPanelController.sendUserInput(text)) return;
    if (this.state.appState.model.trim().length === 0) {
      this.showError(LLM_NOT_SET_MESSAGE);
      return;
    }
    const extraction = extractMediaAttachments(text, this.imageStore);
    if (!this.validateMediaCapabilities(extraction)) return;
    const session = this.session;
    if (session === undefined) {
      this.showError(LLM_NOT_SET_MESSAGE);
      return;
    }
    if (extraction.hasMedia) {
      this.sendMessage(session, text, {
        hasMedia: true,
        parts: extraction.parts,
        imageAttachmentIds: extraction.imageAttachmentIds,
      });
    } else {
      this.sendMessage(session, text);
    }
    this.updateQueueDisplay();
    this.state.ui.requestRender();
  }

  private validateMediaCapabilities(
    extraction: ReturnType<typeof extractMediaAttachments>,
  ): boolean {
    if (!extraction.hasMedia) return true;
    if (
      extraction.imageAttachmentIds.length > 0 &&
      !this.supportsCurrentModelCapability('image_in')
    ) {
      this.showError('Current model does not support image input.');
      return false;
    }
    if (
      extraction.videoAttachmentIds.length > 0 &&
      !this.supportsCurrentModelCapability('video_in')
    ) {
      this.showError('Current model does not support video input.');
      return false;
    }
    return true;
  }

  private supportsCurrentModelCapability(capability: string): boolean {
    const capabilities =
      this.state.appState.availableModels[this.state.appState.model]?.capabilities;
    if (capabilities === undefined) return true;
    return capabilities.includes(capability);
  }

  private async loadPersistedInputHistory(): Promise<void> {
    try {
      const file = getInputHistoryFile(this.state.appState.workDir);
      const entries = await loadInputHistory(file);
      for (const entry of entries) {
        this.presentation.addComposerHistory(entry.content);
      }
      this.lastHistoryContent = entries.at(-1)?.content;
    } catch {
      // best-effort
    }
  }

  private async persistInputHistory(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed === this.lastHistoryContent) return;
    this.presentation.addComposerHistory(trimmed);
    try {
      const file = getInputHistoryFile(this.state.appState.workDir);
      const written = await appendInputHistory(file, trimmed, this.lastHistoryContent);
      if (written) this.lastHistoryContent = trimmed;
    } catch {
      this.lastHistoryContent = trimmed;
    }
  }

  recallLastQueued(): string | undefined {
    if (this.state.queuedMessages.length === 0) return undefined;
    const last = this.state.queuedMessages.at(-1)!;
    this.state.queuedMessages = this.state.queuedMessages.slice(0, -1);
    return last.text;
  }

  // =========================================================================
  // Session Requests / Queues
  // =========================================================================

  private enqueueMessage(text: string, options?: SendMessageOptions): void {
    this.state.queuedMessages.push({
      text,
      agentId: this.harness.interactiveAgentId,
      parts: options?.parts,
      imageAttachmentIds:
        options?.imageAttachmentIds !== undefined && options.imageAttachmentIds.length > 0
          ? options.imageAttachmentIds
          : undefined,
    });
    this.track('input_queue');
  }

  beginSessionRequest(): void {
    this.streamingUI.setTurnId(undefined);
    this.streamingUI.resetLiveText();
    this.streamingUI.resetToolUi();
    this.streamingUI.resetToolCallState();

    this.patchLivePane({
      mode: 'waiting',
      pendingApproval: null,
      pendingQuestion: null,
    });
    this.setAppState({
      streamingPhase: 'waiting',
      streamingStartTime: Date.now(),
    });
  }

  failSessionRequest(message: string): void {
    this.setAppState({ streamingPhase: 'idle' });
    this.resetLivePane();
    this.showError(message);
  }

  sendQueuedMessage(session: Session, item: QueuedMessage): void {
    this.harness.withInteractiveAgent(item.agentId ?? MAIN_AGENT_ID, () => {
      this.sendMessageInternal(session, item.text, {
        parts: item.parts,
        imageAttachmentIds: item.imageAttachmentIds,
      });
    });
  }

  requestQueuedGoalPromotion(): void {
    this.sessionEventHandler.requestQueuedGoalPromotion();
  }

  /** Retires all live Dynamic Workflow mission controls (undo / turn cleanup). */
  clearDynamicWorkflowMissionControls(): void {
    this.sessionEventHandler.clearDynamicWorkflowMissionControls();
  }

  private sendMessageInternal(session: Session, input: string, options?: SendMessageOptions): void {
    const imageAttachmentIds =
      options?.imageAttachmentIds !== undefined && options.imageAttachmentIds.length > 0
        ? options.imageAttachmentIds
        : undefined;
    this.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'user',
      turnId: undefined,
      renderMode: 'plain',
      content: input,
      imageAttachmentIds,
    });

    this.beginSessionRequest();

    const sdkInput = options?.parts ?? input;
    void session.prompt(sdkInput).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.failSessionRequest(`Failed to send: ${message}`);
    });
  }

  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void {
    this.beginSessionRequest();
    void session
      .activateSkill(skillName, skillArgs)
      .then((result) => {
        if (result.execution === 'fork') {
          this.streamingUI.finalizeTurn((item) => this.sendQueuedMessage(session, item));
        }
      })
      .catch((error: unknown) => {
        const message = formatErrorMessage(error);
        this.failSessionRequest(`Skill "${skillName}" failed: ${message}`);
      });
  }

  private sendMessage(session: Session, input: string, options?: SendMessageOptions): void {
    if (
      this.deferUserMessages ||
      this.state.appState.streamingPhase !== 'idle' ||
      this.state.appState.isCompacting
    ) {
      this.enqueueMessage(input, options);
      return;
    }
    this.sendMessageInternal(session, input, options);
  }

  steerMessage(session: Session, input: string[]): void {
    if (this.deferUserMessages || this.state.appState.isCompacting) {
      for (const part of input) {
        this.enqueueMessage(part);
      }
      return;
    }
    if (this.state.appState.streamingPhase === 'idle') {
      for (const part of input) {
        this.sendMessageInternal(session, part);
      }
      return;
    }

    for (const part of input) {
      this.appendTranscriptEntry({
        id: nextTranscriptId(),
        kind: 'user',
        turnId: this.streamingUI.getTurnContext().turnId,
        renderMode: 'plain',
        content: part,
      });
    }

    void session.steer(input.join('\n\n')).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.showError(`Failed to steer: ${message}`);
    });
  }

  // =========================================================================
  // State & Accessors
  // =========================================================================

  setStartupReady(): void {
    this.state.startupState = 'ready';
  }

  clearQueuedMessages(): void {
    this.state.queuedMessages = [];
  }

  shiftQueuedMessage(): QueuedMessage | undefined {
    if (this.state.queuedMessages.length === 0) return undefined;
    const [first, ...rest] = this.state.queuedMessages;
    this.state.queuedMessages = rest;
    return first;
  }

  pushTranscriptEntry(entry: TranscriptEntry): void {
    this.state.transcriptEntries.push(entry);
  }

  setExternalEditorRunning(running: boolean): void {
    this.state.externalEditorRunning = running;
  }

  reloadKeybindings(): readonly string[] {
    const loaded = loadKeybindings(this.harness.homeDir);
    if (loaded.valid || !this.hasInstalledKeybindings) {
      this.keybindings = loaded.bindings;
      this.hasInstalledKeybindings = true;
      for (const component of [
        this.state.editor,
        this.state.footer,
        this.mountedEditorReplacement,
      ]) {
        if (isKeybindingAware(component)) component.setKeybindings(this.keybindings);
      }
      this.editorKeyboard?.setKeybindings(this.keybindings);
      this.keyboardShortcuts = editorShortcutHelp(this.keybindings);
    }
    return loaded.warnings;
  }

  private startKeybindingsWatcher(): void {
    this.stopKeybindingsWatcher ??= watchKeybindings(this.harness.homeDir, () => {
      const warnings = this.reloadKeybindings();
      if (warnings.length === 0) return;
      this.showStatus(`Keybindings reloaded with warnings: ${warnings.join(' ')}`, 'warning');
    });
  }

  setTasksBrowser(value: TUIState['tasksBrowser']): void {
    this.state.tasksBrowser = value;
  }

  openFooterAction(id: FooterActionId): void {
    if (id === 'goal') {
      this.handleUserInput('/goal status');
      return;
    }
    void this.tasksBrowserController.show();
  }

  canFocusFooter(): boolean {
    return (
      this.state.footer.actionItems().length > 0 &&
      !this.state.editor.isShowingAutocomplete() &&
      this.mountedEditorReplacement === undefined &&
      this.state.tasksBrowser === undefined &&
      this.state.btwPanelContainer.children.length === 0 &&
      !this.state.appState.isCompacting &&
      !this.state.ui.hasOverlay()
    );
  }

  appendStartupNotice(extra: string): void {
    this.startupNotice = combineStartupNotice(this.startupNotice, extra);
  }

  get backgroundTasks(): ReadonlyMap<string, BackgroundTaskInfo> {
    return this.sessionEventHandler.backgroundTasks;
  }

  getCurrentSessionId(): string {
    return this.state.appState.sessionId;
  }

  hasSessionContent(): boolean {
    return this.state.transcriptEntries.length > 0;
  }

  setExitOpenUrl(url: string): void {
    this.exitOpenUrl = url;
  }

  async getStartupMcpMs(): Promise<number> {
    const session = this.session;
    if (session === undefined) return 0;
    try {
      const metrics = await session.getMcpStartupMetrics();
      return metrics.durationMs;
    } catch {
      return 0;
    }
  }

  setAppState(patch: Partial<AppState>): void {
    if (!hasPatchChanges(this.state.appState, patch)) return;
    const busyChanged = 'streamingPhase' in patch || 'isCompacting' in patch;
    Object.assign(this.state.appState, patch);
    if ('planMode' in patch || 'permissionMode' in patch) this.updateEditorBorderHighlight();
    this.state.footer.syncAppState(this.state.appState);
    this.syncFooterState();
    this.updateActivityPane();
    if (busyChanged) {
      this.updateQueueDisplay();
      this.sessionEventHandler.retryQueuedGoalPromotion();
    }
    if (patch.streamingPhase === 'idle') {
      this.presentation.notifyIdle();
    } else {
      this.state.ui.requestRender();
    }
  }

  dispatchFooter(event: FooterEvent): void {
    this.dispatchFooterEvents([event]);
  }

  private syncFooterState(): void {
    this.dispatchFooterEvents([
      {
        type: 'status.updated',
        changes: footerStatusFromAppState(
          this.state.appState,
          this.state.footer.getGitStatus(),
        ),
      },
      { type: 'goal.updated', goal: this.footerGoal() },
    ]);
  }

  private refreshFooter(): void {
    this.dispatchFooterEvents([
      {
        type: 'status.updated',
        changes: footerStatusFromAppState(
          this.state.appState,
          this.state.footer.getGitStatus(),
        ),
      },
    ]);
  }

  private dispatchFooterEvents(events: readonly FooterEvent[]): void {
    for (const event of events) {
      if (event.type === 'background-counts.updated') {
        this.state.footer.syncActionCounts(event.counts);
      }
    }
    this.state.footerState = foldFooterEvents(this.state.footerState, events);
    this.presentation.updateFooter(
      selectFooterViewModel(
        this.state.footerState,
        Date.now(),
        this.state.appState.statusLine,
      ),
    );
    const statusParts = selectStatusItemParts(
      this.state.footerState,
      Date.now(),
      this.state.appState.statusLine,
    );
    this.state.statusBar.update({
      ...this.state.footerState.status,
      extras: selectStatusBarExtras(
        this.state.footerState,
        Date.now(),
        this.state.appState.statusLine,
      ),
      updateExtra: statusParts.update ?? undefined,
      sessionKey:
        this.state.appState.sessionTitle?.trim() ||
        this.state.appState.sessionId ||
        this.state.appState.workDir,
      statusLine: this.state.appState.statusLine,
    });
  }

  private footerGoal(): FooterGoal | null {
    const goal = this.state.appState.goal;
    if (goal === null || goal === undefined) {
      this.footerGoalSnapshotKey = null;
      return null;
    }
    const snapshotKey = [
      goal.goalId,
      goal.status,
      String(goal.turnsUsed),
      String(goal.tokensUsed),
      String(goal.wallClockMs),
      String(goal.budget.turnBudget),
    ].join('\u0000');
    if (snapshotKey !== this.footerGoalSnapshotKey) {
      this.footerGoalSnapshotKey = snapshotKey;
      this.footerGoalObservedAtMs = Date.now();
    }
    return {
      status: goal.status,
      turnsUsed: goal.turnsUsed,
      turnBudget: goal.budget.turnBudget,
      wallClockMs: goal.wallClockMs,
      observedAtMs: this.footerGoalObservedAtMs,
    };
  }

  patchLivePane(patch: Partial<LivePaneState>): void {
    if (!hasPatchChanges(this.state.livePane, patch)) return;
    Object.assign(this.state.livePane, patch);
    this.updateActivityPane();
    this.state.ui.requestRender();
  }

  resetLivePane(): void {
    this.state.livePane = { ...INITIAL_LIVE_PANE };
    this.updateActivityPane();
    this.state.ui.requestRender();
  }

  // =========================================================================
  // Session Runtime
  // =========================================================================

  requireSession(): Session {
    if (this.session === undefined) {
      throw new Error(NO_ACTIVE_SESSION_MESSAGE);
    }
    return this.session;
  }

  private async createSessionFromCurrentState(): Promise<Session> {
    const model = this.state.appState.model.trim();
    if (model.length === 0) {
      throw new Error(LLM_NOT_SET_MESSAGE);
    }
    return this.harness.createSession({
      workDir: this.state.appState.workDir,
      model,
      thinking:
        this.session === undefined ? undefined : this.state.appState.thinkingLevel,
      permission: this.state.appState.permissionMode,
      planMode: this.state.appState.planMode ? true : undefined,
    });
  }

  async setSession(session: Session): Promise<void> {
    const previous = this.unloadCurrentSession('switching session');
    await previous?.close();
    this.session = session;
    this.harness.setTelemetryContext({ sessionId: session.id });
    this.registerSessionHandlers(session);
  }

  async syncRuntimeState(session: Session = this.requireSession()): Promise<void> {
    const [status, goalResult] = await Promise.all([session.getStatus(), session.getGoal()]);
    this.setAppState({
      sessionId: session.id,
      model: status.model ?? '',
      modelCostRates: status.modelCostRates,
      totalCostUsd: status.usage?.totalCostUsd,
      thinkingLevel: status.thinkingLevel,
      permissionMode: status.permission,
      planMode: status.planMode,
      dynamicWorkflowMode: status.dynamicWorkflowMode ?? false,
      fastMode: status.fastMode ?? false,
      fastModeSupported: status.fastModeSupported ?? false,
      contextTokens: status.contextTokens,
      maxContextTokens: status.maxContextTokens,
      contextUsage: status.contextUsage,
      sessionTitle: session.summary?.title ?? null,
      goal: goalResult.goal,
    });
  }

  // Apply --auto/--yolo/--plan startup flags to a resumed session. The resumed
  // session may already be in plan mode from its persisted records, and
  // re-entering plan mode throws, so only enable it when it is not active yet.
  // setPermission is idempotent and needs no such guard.
  private async applyStartupModesToResumedSession(session: Session): Promise<void> {
    const { startup } = this.options;
    if (startup.auto) {
      await session.setPermission('auto');
    } else if (startup.yolo) {
      await session.setPermission('yolo');
    }
    if (startup.plan) {
      const status = await session.getStatus();
      if (!status.planMode) {
        await session.setPlanMode(true);
      }
    }
  }

  // Re-apply startup flags that the user explicitly passed on the command line.
  // syncRuntimeState and session-replay hydration can both read stale persisted
  // values, so this guarantees the footer reflects the CLI intent.
  private applyStartupPermissionAndPlanToAppState(): void {
    const { startup } = this.options;
    if (startup.auto) {
      this.setAppState({ permissionMode: 'auto' });
    } else if (startup.yolo) {
      this.setAppState({ permissionMode: 'yolo' });
    }
    if (startup.plan) {
      this.setAppState({ planMode: true });
    }
  }

  // Plan mode is set by createSession — do not re-enter it here.
  private async activateRuntime(): Promise<void> {
    const session = this.requireSession();
    await session.setPermission(this.state.appState.permissionMode);
    await this.syncRuntimeState(session);
  }

  async closeSession(reason: string): Promise<void> {
    const previous = this.unloadCurrentSession(reason);
    await previous?.close();
  }

  private unloadCurrentSession(reason: string): Session | undefined {
    const previous = this.session;
    this.sessionEventUnsubscribe?.();
    this.sessionEventUnsubscribe = undefined;
    this.clearReverseRpcPanels();
    previous?.setApprovalHandler(undefined);
    previous?.setQuestionHandler(undefined);
    this.approvalController.cancelAll(reason);
    this.questionController.cancelAll(reason);
    this.session = undefined;
    this.state.dynamicWorkflowModeEntry = undefined;
    this.harness.setTelemetryContext({ sessionId: null });
    this.setAppState({ goal: null });
    return previous;
  }

  private clearReverseRpcPanels(): void {
    for (const dispose of this.reverseRpcDisposers) {
      dispose();
    }
  }

  private registerSessionHandlers(session: Session): void {
    session.setApprovalHandler(
      createApprovalRequestHandler(this.approvalController, (request, response) => {
        this.appendApprovalTranscriptEntry(request, response);
      }),
    );
    session.setQuestionHandler(createQuestionAskHandler(this.questionController, openUrl));
  }

  async fetchSessions(scope: 'cwd' | 'all' = this.state.sessionsScope): Promise<void> {
    this.state.loadingSessions = true;
    this.state.sessionsScope = scope;
    try {
      const sessions =
        scope === 'all'
          ? await this.harness.listSessions({})
          : await this.harness.listSessions({ workDir: this.state.appState.workDir });
      this.state.sessions = sessionRowsForPicker(
        sessions,
        this.state.appState.sessionId,
        this.hasSessionContent(),
      );
    } catch {
      /* silently ignore */
    } finally {
      this.state.loadingSessions = false;
    }
  }

  updateTerminalTitle(): void {
    const trimmed = this.state.appState.sessionTitle?.trim() ?? '';
    const label = trimmed.length > 0 ? trimmed.slice(0, MAX_TERMINAL_TITLE_LENGTH) : PRODUCT_NAME;
    this.presentation.setTerminalTitle(label);
  }

  resetSessionRuntime(): void {
    this.aborted = false;
    this.streamingUI.discardPending();
    this.state.queuedMessages = [];
    this.state.dynamicWorkflowModeEntry = undefined;
    this.streamingUI.resetToolCallState();
    this.streamingUI.resetToolUi();
    this.sessionEventHandler.resetRuntimeState();
    this.tasksBrowserController.close();
    this.btwPanelController.clear();
    this.dispatchFooter({
      type: 'background-counts.updated',
      counts: { bashTasks: 0, agentTasks: 0 },
    });
    this.streamingUI.setTodoList([]);
    this.streamingUI.setTurnId(undefined);
    this.setAppState({ mcpServersSummary: null });
    this.streamingUI.setStep(0);
    this.streamingUI.resetLiveText();
    this.updateQueueDisplay();
  }

  private async showResumeOtherWorkDirHint(session: SessionRow): Promise<void> {
    this.hideSessionPicker();
    const command = `cd ${quoteShellArg(session.work_dir)} && pythinker --resume ${quoteShellArg(session.id)}`;
    const message = `Current session is in a different working directory.\n  To resume, run: ${command}`;
    try {
      await copyTextToClipboard(command);
      this.showStatus(`${message}\n  Command copied to clipboard`, 'warning');
    } catch {
      this.showStatus(`${message}\n  Failed to copy command to clipboard`, 'warning');
    }
  }

  private async resumeSession(targetSessionId: string): Promise<boolean> {
    if (targetSessionId === this.state.appState.sessionId) {
      this.showStatus('Already on this session.');
      return true;
    }
    if (this.state.appState.streamingPhase !== 'idle') {
      this.showError('Cannot switch sessions while streaming — press Esc or Ctrl-C first.');
      return false;
    }
    if (this.state.appState.isReplaying) {
      this.showError('Cannot switch sessions while history is replaying.');
      return false;
    }

    let session: Session;
    try {
      session = await this.harness.resumeSession({
        id: targetSessionId,
        replayTurnLimit: REPLAY_TURN_LIMIT,
      });
    } catch (error) {
      const msg = formatErrorMessage(error);
      this.showError(`Failed to resume session ${targetSessionId}: ${msg}`);
      return false;
    }

    await this.switchToSession(session, `Resumed session (${session.id}).`);
    return true;
  }

  async switchToSession(session: Session, statusMessage: string): Promise<void> {
    this.resetSessionRuntime();
    await this.setSession(session);
    await this.syncRuntimeState(session);
    this.updateTerminalTitle();
    try {
      await this.refreshSkillCommands(this.session);
    } catch {
      /* keep the switched session usable even if dynamic skills fail */
    }
    this.clearTranscriptAndRedraw();
    try {
      await this.sessionReplay.hydrateFromReplay(session);
    } catch (error) {
      const msg = formatErrorMessage(error);
      this.showError(`Failed to replay session history: ${msg}`);
    } finally {
      this.sessionEventHandler.startSubscription();
    }
    this.showStatus(statusMessage);
  }

  async reloadCurrentSessionView(session: Session, statusMessage: string): Promise<void> {
    this.sessionEventUnsubscribe?.();
    this.sessionEventUnsubscribe = undefined;
    this.clearReverseRpcPanels();
    session.setApprovalHandler(undefined);
    session.setQuestionHandler(undefined);
    this.approvalController.cancelAll('reloading session');
    this.questionController.cancelAll('reloading session');

    this.resetSessionRuntime();
    this.session = session;
    this.harness.setTelemetryContext({ sessionId: session.id });
    this.registerSessionHandlers(session);
    await this.syncRuntimeState(session);
    this.updateTerminalTitle();
    try {
      await this.refreshSkillCommands(session);
    } catch {
      /* keep the reloaded session usable even if dynamic skills fail */
    }
    this.sessionEventHandler.startSubscription();
    this.showStatus(statusMessage);
  }

  async createNewSession(): Promise<void> {
    if (this.state.appState.isReplaying) {
      this.showError('Cannot start a new session while history is replaying.');
      return;
    }

    let session: Session;
    try {
      session = await this.createSessionFromCurrentState();
    } catch (error) {
      const msg = formatErrorMessage(error);
      this.showError(`Failed to start a new session: ${msg}`);
      return;
    }

    this.resetSessionRuntime();
    await this.setSession(session);
    this.setAppState({ sessionId: session.id });
    try {
      await this.activateRuntime();
      await this.syncRuntimeState(session);
    } catch (error) {
      this.sessionEventHandler.startSubscription();
      const msg = formatErrorMessage(error);
      this.showError(`Post-create setup failed: ${msg}`);
      return;
    }
    try {
      await this.refreshSkillCommands(this.session);
    } catch {
      /* keep the new session usable even if dynamic skills fail */
    }
    this.sessionEventHandler.startSubscription();
    this.clearTranscriptAndRedraw();
    this.showStatus(`Started a new session (${session.id}).`);
    void this.showConfigWarningsIfAny();
  }

  /** Surface config.toml load warnings (degraded or kept-previous config) in the status bar. */
  private async showConfigWarningsIfAny(): Promise<void> {
    try {
      const { warnings } = await this.harness.getConfigDiagnostics();
      for (const warning of warnings) {
        this.showStatus(warning, 'warning');
      }
    } catch {
      /* diagnostics are best-effort */
    }
  }

  // =========================================================================
  // Transcript Rendering
  // =========================================================================

  private createTranscriptComponent(entry: TranscriptEntry): Component | null {
    if (entry.compactionData !== undefined) {
      const data = entry.compactionData;
      const block = new CompactionComponent(this.state.ui, data.instruction);
      if (data.result === 'cancelled') {
        block.markCanceled();
      } else {
        block.markDone(data.tokensBefore, data.tokensAfter);
      }
      return block;
    }

    switch (entry.kind) {
      case 'user': {
        const images = entry.imageAttachmentIds
          ?.map((id) => this.imageStore.get(id))
          .filter((a): a is ImageAttachment => a?.kind === 'image');
        return new UserMessageComponent(entry.content, images);
      }
      case 'skill_activation':
        return new SkillActivationComponent(
          entry.skillName ?? entry.content,
          entry.skillArgs,
          entry.skillTrigger,
        );
      case 'cron':
        return new CronMessageComponent(entry.content, entry.cronData ?? {});
      case 'goal':
        if (entry.goalData?.kind === 'created') {
          return new GoalSetMessageComponent();
        }
        if (entry.goalData?.kind === 'lifecycle') {
          return buildGoalMarker(entry.goalData.change, this.state.toolOutputExpanded);
        }
        return null;
      case 'assistant': {
        if (entry.content.trimStart().startsWith('✓ Goal complete')) {
          return new GoalCompletionMessageComponent(entry.content);
        }
        const component = new AssistantMessageComponent();
        component.updateContent(entry.content);
        return component;
      }
      case 'thinking': {
        const thinking = new ThinkingComponent(entry.content, true);
        if (this.state.toolOutputExpanded) thinking.setExpanded(true);
        return thinking;
      }
      case 'tool_call':
        if (entry.toolCallData) {
          const tc = new ToolCallComponent(
            entry.toolCallData,
            entry.toolCallData.result,
            this.state.ui,
            this.state.appState.workDir,
          );
          if (this.state.toolOutputExpanded) tc.setExpanded(true);
          return tc;
        }
        if (entry.backgroundAgentStatus !== undefined) {
          return new BackgroundAgentStatusComponent(entry.backgroundAgentStatus);
        }
        return entry.renderMode === 'notice'
          ? new NoticeMessageComponent(entry.content, entry.detail)
          : new StatusMessageComponent(entry.content, entry.color);
      case 'status':
        if (entry.backgroundAgentStatus !== undefined) {
          return new BackgroundAgentStatusComponent(entry.backgroundAgentStatus);
        }
        return entry.renderMode === 'notice'
          ? new NoticeMessageComponent(entry.content, entry.detail)
          : new StatusMessageComponent(entry.content, entry.color);
      case 'welcome':
        return null;
      default:
        return null;
    }
  }

  appendTranscriptEntry(entry: TranscriptEntry): void {
    this.state.transcriptEntries.push(entry);
    const component = this.createTranscriptComponent(entry);
    if (component) {
      markTranscriptComponent(component, entry);
      this.state.transcriptContainer.addTranscriptChild(component, {
        role: 'durable',
        edgeBlankPolicy: 'trim-plain',
      });
      this.state.ui.requestRender();
    }
  }

  private appendApprovalTranscriptEntry(
    request: ApprovalRequest,
    response: ApprovalResponse,
  ): void {
    if (request.toolName === 'ExitPlanMode' || request.display.kind === 'plan_review') return;
    const parts: string[] = [];
    switch (response.decision) {
      case 'approved':
        parts.push(response.scope === 'session' ? 'Approved for session' : 'Approved');
        break;
      case 'rejected':
        parts.push('Rejected');
        break;
      case 'cancelled':
        parts.push('Cancelled');
        break;
    }
    parts.push(`: ${request.action}`);
    if (response.feedback !== undefined && response.feedback.length > 0) {
      parts.push(` — "${response.feedback}"`);
    }
    this.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'status',
      turnId: request.turnId === undefined ? undefined : String(request.turnId),
      renderMode: 'notice',
      content: parts.join(''),
    });
  }

  private renderWelcome(): void {
    if (
      this.state.transcriptContainer.children.some((child) => child instanceof WelcomeComponent)
    ) {
      return;
    }
    const welcome = new WelcomeComponent(this.state.appState, () => {
      this.state.ui.requestRender();
    });
    this.state.transcriptContainer.addTranscriptChild(welcome, {
      role: 'ephemeral',
      edgeBlankPolicy: 'preserve',
    });
  }

  private clearTerminalInlineImages(): void {
    if (getCapabilities().images !== 'kitty') return;
    this.presentation.writeTerminalControl(deleteAllKittyImages());
  }

  private clearTranscriptAndRedraw(): void {
    this.streamingUI.discardPending();
    this.state.transcriptEntries = [];
    this.streamingUI.disposeActiveCompactionBlock();
    this.streamingUI.resetLiveText();
    this.streamingUI.resetToolUi();
    this.sessionEventHandler.disposeMcpServerStatusRows();
    this.state.transcriptContainer.clear();
    this.state.transcriptViewport.scrollToBottom();
    this.state.transcriptViewport.clearSelection();
    this.btwPanelController.clear();
    this.clearTerminalInlineImages();
    this.state.todoPanel.clear();
    this.state.todoPanelContainer.clear();
    this.imageStore.clear();
    this.renderWelcome();
  }
  showStatus(message: string, color?: ColorToken): void {
    this.state.transcriptContainer.addTranscriptChild(
      new StatusMessageComponent(message, color),
      { role: 'ephemeral', edgeBlankPolicy: 'preserve' },
    );
    this.state.ui.requestRender();
  }

  showNotice(title: string, detail?: string): void {
    this.state.transcriptContainer.addTranscriptChild(
      new NoticeMessageComponent(title, detail),
      { role: 'ephemeral', edgeBlankPolicy: 'preserve' },
    );
    this.state.ui.requestRender();
  }

  showError(message: string): void {
    this.showStatus(`Error: ${message}`, 'error');
  }

  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle {
    return this.showProgressSpinner(label);
  }

  showProgressSpinner(label: string): LoginProgressSpinnerHandle {
    const tint = (s: string): string => currentTheme.fg('primary', s);
    const spinner = new ActivityLoader(this.state.ui, tint, label);
    this.state.transcriptContainer.addTranscriptChild(new Spacer(1), {
      role: 'ephemeral',
      edgeBlankPolicy: 'preserve',
    });
    this.state.transcriptContainer.addTranscriptChild(spinner, {
      role: 'ephemeral',
      edgeBlankPolicy: 'preserve',
    });
    this.state.ui.requestRender();
    return {
      stop: ({ ok, label: finalLabel }) => {
        spinner.stop();
        const tone = ok ? 'success' : 'error';
        const symbol = ok ? '✓' : '✗';
        spinner.setText(currentTheme.fg(tone, `${symbol} ${finalLabel}`));
        this.state.ui.requestRender();
      },
    };
  }


  // =========================================================================
  // Panes / Presentation State
  // =========================================================================

  updateActivityPane(): void {
    const effectiveMode = this.resolveActivityPaneMode();
    this.syncTerminalProgress(this.shouldShowTerminalProgress(effectiveMode));
    const placeSpinnerInDynamicWorkflow = this.shouldPlaceActivitySpinnerInDynamicWorkflow(effectiveMode);
    let footerActivityPhase: FooterActivity['phase'] = 'hidden';
    let footerSpinnerActive = false;
    if (!placeSpinnerInDynamicWorkflow) {
      switch (effectiveMode) {
        case 'waiting':
        case 'thinking':
        case 'composing':
        case 'tool':
          footerActivityPhase = effectiveMode;
          footerSpinnerActive = effectiveMode !== 'thinking';
          break;
        case 'hidden':
        case 'idle':
        case 'session':
          break;
      }
    }
    this.dispatchFooter({
      type: 'activity.updated',
      activity: {
        phase: footerActivityPhase,
        label: null,
        spinnerActive: footerSpinnerActive,
        spinnerFrame: '⠋',
      },
    });
    const activityModeKey = `${effectiveMode}:${placeSpinnerInDynamicWorkflow ? 'dynamic-workflow' : 'pane'}`;

    if (
      activityModeKey === this.lastActivityMode &&
      (effectiveMode === 'waiting' || effectiveMode === 'thinking' || effectiveMode === 'tool')
    ) {
      if (placeSpinnerInDynamicWorkflow) {
        this.syncDynamicWorkflowActivitySpinner(this.state.activitySpinner?.instance);
      }
      return;
    }

    this.lastActivityMode = activityModeKey;
    this.state.activityContainer.clear();

    switch (effectiveMode) {
      case 'hidden':
        this.stopActivitySpinner();
        this.syncDynamicWorkflowActivitySpinner(undefined);
        this.state.ui.requestRender();
        return;
      case 'waiting': {
        const spinner = this.ensureActivitySpinner(
          undefined,
          (s) => currentTheme.fg('primary', s),
          !placeSpinnerInDynamicWorkflow,
        );
        this.syncDynamicWorkflowActivitySpinner(placeSpinnerInDynamicWorkflow ? spinner : undefined);
        if (placeSpinnerInDynamicWorkflow) break;
        this.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'waiting',
            spinner,
          }),
        );
        break;
      }
      case 'thinking': {
        this.stopActivitySpinner();
        this.syncDynamicWorkflowActivitySpinner(undefined);
        break;
      }
      case 'composing': {
        const spinner = this.ensureActivitySpinner(undefined, (s) =>
          currentTheme.fg('primary', s),
          true,
        );
        this.syncDynamicWorkflowActivitySpinner(undefined);
        this.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'composing',
            spinner,
          }),
        );
        break;
      }
      case 'tool': {
        const spinner = this.ensureActivitySpinner(
          undefined,
          (s) => currentTheme.fg('primary', s),
          !placeSpinnerInDynamicWorkflow,
        );
        this.syncDynamicWorkflowActivitySpinner(placeSpinnerInDynamicWorkflow ? spinner : undefined);
        if (placeSpinnerInDynamicWorkflow) break;
        this.state.activityContainer.addChild(
          new ActivityPaneComponent({
            mode: 'tool',
            spinner,
          }),
        );
        break;
      }
      case 'idle':
      case 'session': {
        this.stopActivitySpinner();
        this.syncDynamicWorkflowActivitySpinner(undefined);
        break;
      }
    }
    this.state.ui.requestRender();
  }

  private resolveActivityPaneMode(): EffectiveActivityPaneMode {
    if (this.state.activeDialog === 'session-picker') return 'hidden';
    if (this.state.livePane.pendingApproval !== null) return 'hidden';
    if (this.state.appState.isCompacting) return 'hidden';
    if (this.state.livePane.pendingQuestion !== null) return 'hidden';

    const streamingPhase = this.state.appState.streamingPhase;
    if (this.state.livePane.mode === 'idle') {
      if (streamingPhase === 'thinking' || streamingPhase === 'composing') {
        return streamingPhase;
      }
    }

    return this.state.livePane.mode;
  }

  updateQueueDisplay(): void {
    this.state.queueContainer.clear();
    const queued = this.state.queuedMessages;
    if (queued.length === 0) return;

    this.state.queueContainer.addChild(
      new QueuePaneComponent({
        messages: queued,
        isCompacting: this.state.appState.isCompacting,
        isStreaming: this.state.appState.streamingPhase !== 'idle',
        canSteerImmediately: !this.deferUserMessages,
      }),
    );
  }

  toggleToolOutputExpansion(): void {
    this.state.toolOutputExpanded = !this.state.toolOutputExpanded;
    for (const container of [
      this.state.transcriptContainer,
      this.state.activityContainer,
    ]) {
      for (const child of container.children) {
        if (isExpandable(child)) {
          child.setExpanded(this.state.toolOutputExpanded);
        }
      }
    }
    this.state.ui.requestRender();
  }

  updateEditorBorderHighlight(text?: string): void {
    const { line, col } = this.state.editor.getCursor();
    const currentLine =
      this.state.editor.getLines()[line] ??
      (text ?? this.presentation.getComposerText()).split('\n')[line] ??
      '';
    const highlighted =
      this.state.appState.planMode || findSlashAutocompleteContext(currentLine, col) !== null;
    this.state.editor.borderHighlighted = highlighted;
    this.state.editor.borderColor = (s: string) => {
      if (highlighted) return currentTheme.fg('primary', s);
      return currentTheme.fg('border', s);
    };
    this.state.ui.requestRender();
  }

  async applyTheme(themeName: ThemeName, resolved?: ResolvedTheme): Promise<void> {
    const palette = await getColorPalette(themeName === 'auto' ? (resolved ?? 'dark') : themeName);
    currentTheme.setPalette(palette);
    this.setAppState({ theme: themeName });
    this.updateEditorBorderHighlight();
    // Force every historical message to re-render so Markdown/Text caches
    // (which hold old ANSI colour codes) are cleared.
    this.state.transcriptContainer.invalidate();
    this.state.ui.requestRender(true);
  }

  refreshTerminalThemeTracking(): void {
    this.stopTerminalThemeTracking();
    if (!isBuiltInTheme(this.state.appState.theme) || this.state.appState.theme !== 'auto') return;

    this.terminalThemeTrackingDispose = installTerminalThemeTracking(this.state, (resolved) => {
      void this.applyResolvedAutoTheme(resolved);
    });
  }

  private stopTerminalThemeTracking(): void {
    this.terminalThemeTrackingDispose?.();
    this.terminalThemeTrackingDispose = undefined;
  }

  private async applyResolvedAutoTheme(resolved: ResolvedTheme): Promise<void> {
    if (this.state.appState.theme !== 'auto') return;
    const palette = getBuiltInPalette(resolved);
    if (currentTheme.palette === palette) return;
    currentTheme.setPalette(palette);
    this.updateEditorBorderHighlight();
    // Repaint already-rendered transcript entries (status/markdown caches hold
    // old ANSI codes), matching applyTheme()'s behaviour.
    this.state.transcriptContainer.invalidate();
    this.state.ui.requestRender(true);
  }

  private shouldShowTerminalProgress(effectiveMode: EffectiveActivityPaneMode): boolean {
    if (this.state.appState.isCompacting) return true;
    return (
      effectiveMode === 'waiting' ||
      effectiveMode === 'thinking' ||
      effectiveMode === 'composing' ||
      effectiveMode === 'tool'
    );
  }

  private shouldPlaceActivitySpinnerInDynamicWorkflow(
    effectiveMode: EffectiveActivityPaneMode,
  ): boolean {
    return (
      this.sessionEventHandler.hasActiveDynamicWorkflowToolCall() &&
      (effectiveMode === 'waiting' || effectiveMode === 'tool')
    );
  }

  private syncDynamicWorkflowActivitySpinner(spinner: ActivityLoader | undefined): void {
    this.sessionEventHandler.syncDynamicWorkflowActivitySpinner(spinner);
  }

  private syncTerminalProgress(active: boolean): void {
    if (!this.state.terminalState.supportsProgress) return;
    if (this.state.terminalState.progressActive === active) return;
    this.presentation.setTerminalProgress(active);
    this.state.terminalState.progressActive = active;
  }

  private ensureActivitySpinner(
    label?: string,
    colorFn?: (s: string) => string,
    verbLabels = false,
  ): ActivityLoader {
    if (this.state.activitySpinner === null) {
      const instance = new ActivityLoader(this.state.ui, colorFn, label ?? '', { verbLabels });
      this.state.activitySpinner = { instance };
      return instance;
    }

    const spinner = this.state.activitySpinner.instance;
    if (verbLabels) {
      spinner.setVerbLabels(true);
    } else {
      spinner.setLabel(label ?? '');
    }
    if (colorFn !== undefined) {
      spinner.setColorFn(colorFn);
    }
    return spinner;
  }

  private stopActivitySpinner(): void {
    if (this.state.activitySpinner !== null) {
      this.state.activitySpinner.instance.stop();
      this.state.activitySpinner = null;
    }
  }

  // =========================================================================
  // Dialogs / Selectors
  // =========================================================================

  mountEditorReplacement(panel: Component & Focusable): void {
    this.state.editorContainer.clear();
    this.state.editorContainer.addChild(panel);
    this.mountedEditorReplacement = panel;
    if (isKeybindingAware(panel)) panel.setKeybindings(this.keybindings);
    this.state.ui.setFocus(panel);
    this.state.ui.requestRender();
  }

  restoreEditor(): void {
    this.state.editorContainer.clear();
    this.state.editorContainer.addChild(this.state.editor);
    this.mountedEditorReplacement = undefined;
    this.presentation.focusComposer();
    this.state.ui.requestRender();
  }

  restoreInputText(text: string): void {
    this.restoreEditor();
    this.presentation.setComposerText(text);
    this.updateEditorBorderHighlight(text);
    this.state.ui.requestRender();
  }

  showMessageActions(): void {
    slashCommands.showMessageActions(this);
  }

  async showInputHistoryPicker(): Promise<void> {
    let entries;
    try {
      entries = await loadInputHistory(getInputHistoryFile(this.state.appState.workDir));
    } catch (error) {
      this.showError(`Failed to load input history: ${formatErrorMessage(error)}`);
      return;
    }
    const history = selectRecentInputHistory(entries);
    if (history.length === 0) {
      this.showNotice('No input history');
      return;
    }
    this.mountEditorReplacement(
      new ChoicePickerComponent({
        title: 'Prompt history',
        options: history.map((content) => ({
          value: content,
          label: content.replaceAll(/\s+/gu, ' '),
        })),
        searchable: true,
        pageSize: 8,
        keybindingContext: 'HistorySearch',
        onSelect: (content) => {
          this.restoreInputText(content);
        },
        onExecute: (content) => {
          this.restoreEditor();
          this.handleUserInput(content);
        },
        onCancel: () => {
          this.restoreEditor();
        },
      }),
    );
  }

  private async runMigrationScreen(plan: MigrationPlan): Promise<MigrationScreenResult> {
    const result = await new Promise<MigrationScreenResult>((resolve) => {
      const screen = new MigrationScreenComponent({
        plan,
        sourceHome: plan.sourceHome,
        targetHome: this.harness.homeDir,
        skipDecisionStep: this.migrateOnly,
        requestRender: () => {
          this.state.ui.requestRender();
        },
        onComplete: (r) => {
          resolve(r);
        },
      });
      this.mountEditorReplacement(screen);
    });
    this.restoreEditor();
    if (result.decision === 'never') {
      // Persist the skip marker `detectPendingMigration` checks, so "Never ask
      // again" actually stops the prompt from reappearing every launch.
      try {
        writeFileSync(join(this.harness.homeDir, '.skip-migration-from-pythinker-cli'), '', 'utf-8');
      } catch {
        // Non-blocking: a failed marker write must never crash startup.
      }
    }
    return result;
  }

  showHelpPanel(): void {
    this.state.activeDialog = 'help';
    this.mountEditorReplacement(
      new HelpPanelComponent({
        commands: this.getSlashCommands(),
        shortcuts: this.keyboardShortcuts,
        onClose: () => {
          this.hideHelpPanel();
        },
      }),
    );
  }

  private hideHelpPanel(): void {
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  private sessionPickerOptions: {
    readonly applyStartupModes: boolean;
    readonly closeOnCancel: boolean;
    readonly forwardEditorExit: boolean;
  } = {
    applyStartupModes: false,
    closeOnCancel: false,
    forwardEditorExit: false,
  };
  private sessionPickerScopeRequestToken = 0;

  async showSessionPicker(): Promise<void> {
    await this.openSessionPicker({
      applyStartupModes: false,
      closeOnCancel: false,
      forwardEditorExit: false,
    });
  }

  private async bootstrapFromPicker(): Promise<void> {
    await this.openSessionPicker({
      applyStartupModes: true,
      closeOnCancel: true,
      forwardEditorExit: true,
    });
  }

  private async openSessionPicker(options: {
    readonly applyStartupModes: boolean;
    readonly closeOnCancel: boolean;
    readonly forwardEditorExit: boolean;
  }): Promise<void> {
    this.sessionPickerOptions = options;
    await this.fetchSessions('cwd');
    this.mountSessionPicker({
      applyStartupModes: options.applyStartupModes,
      onCancel: () => {
        this.hideSessionPicker();
        if (options.closeOnCancel) void this.stop();
      },
      onCtrlC: options.forwardEditorExit
        ? () => {
            this.state.editor.onCtrlC?.();
          }
        : undefined,
      onCtrlD: options.forwardEditorExit
        ? () => {
            this.state.editor.onCtrlD?.();
          }
        : undefined,
    });
  }

  private async toggleSessionPickerScope(selectedSessionId: string): Promise<void> {
    const requestToken = ++this.sessionPickerScopeRequestToken;
    const nextScope = this.state.sessionsScope === 'cwd' ? 'all' : 'cwd';
    await this.fetchSessions(nextScope);
    if (requestToken !== this.sessionPickerScopeRequestToken) return;
    if (this.state.activeDialog !== 'session-picker') return;
    this.mountSessionPicker({
      initialSelectedSessionId: selectedSessionId,
      applyStartupModes: this.sessionPickerOptions.applyStartupModes,
      onCancel: () => {
        this.hideSessionPicker();
        if (this.sessionPickerOptions.closeOnCancel) void this.stop();
      },
      onCtrlC: this.sessionPickerOptions.forwardEditorExit
        ? () => {
            this.state.editor.onCtrlC?.();
          }
        : undefined,
      onCtrlD: this.sessionPickerOptions.forwardEditorExit
        ? () => {
            this.state.editor.onCtrlD?.();
          }
        : undefined,
    });
  }

  hideSessionPicker(): void {
    this.sessionPickerScopeRequestToken += 1;
    this.editorKeyboard.clearPendingExit();
    this.state.activeDialog = null;
    this.restoreEditor();
  }

  private mountSessionPicker(options: {
    readonly onCancel: () => void;
    readonly onCtrlC?: () => void;
    readonly onCtrlD?: () => void;
    readonly initialSelectedSessionId?: string;
    // CLI mode flags (--auto/--yolo/--plan) target the session picked at
    // startup (bare --session); later /sessions switches keep the picked
    // session's own persisted modes.
    readonly applyStartupModes?: boolean;
  }): void {
    this.state.activeDialog = 'session-picker';
    this.mountEditorReplacement(
      new SessionPickerComponent({
        sessions: this.state.sessions,
        loading: this.state.loadingSessions,
        currentSessionId: this.state.appState.sessionId,
        scope: this.state.sessionsScope,
        initialSelectedSessionId: options.initialSelectedSessionId,
        pageSize: 50,
        onSelect: (session: SessionRow) => {
          void this.handleSessionPickerSelect(session, options.applyStartupModes === true).catch(
            (error) => {
              this.showError(`Failed to apply startup flags: ${formatErrorMessage(error)}`);
            },
          );
        },
        onCancel: options.onCancel,
        onCtrlC: options.onCtrlC,
        onCtrlD: options.onCtrlD,
        onToggleScope: (selectedSessionId: string) => {
          void this.toggleSessionPickerScope(selectedSessionId);
        },
      }),
    );
  }

  private async handleSessionPickerSelect(
    session: SessionRow,
    applyStartupModes: boolean,
  ): Promise<void> {
    if (resolve(session.work_dir) !== resolve(this.state.appState.workDir)) {
      await this.showResumeOtherWorkDirHint(session);
      if (applyStartupModes) await this.stop(0);
      return;
    }

    const switched = await this.resumeSession(session.id);
    if (!switched) return;
    if (applyStartupModes) {
      await this.applyStartupModesToResumedSession(this.requireSession());
      this.applyStartupPermissionAndPlanToAppState();
    }
    this.hideSessionPicker();
  }

  private showApprovalPanel(payload: ApprovalPanelData): void {
    this.patchLivePane({ pendingApproval: { data: payload } });
    notifyTerminalOnce(this.state, `approval:${payload.id}`, {
      title: 'Pythinker Code approval required',
      body: payload.tool_name,
    });
    const panel = new ApprovalPanelComponent(
      { data: payload },
      (response: ApprovalPanelResponse) => {
        this.approvalController.respond(adaptPanelResponse(response));
      },
      () => {
        this.toggleToolOutputExpansion();
      },
      (block) => {
        this.openApprovalPreview(panel, block);
      },
    );
    this.activeApprovalPanel = panel;
    this.mountEditorReplacement(panel);
  }

  private hideApprovalPanel(): void {
    // If the full-screen preview is open, fold it back first so the saved-
    // children stack stays consistent with what mountEditorReplacement set up.
    if (this.approvalPreview !== undefined) this.closeApprovalPreview();
    this.activeApprovalPanel = undefined;
    this.patchLivePane({ pendingApproval: null });
    this.restoreEditor();
  }

  // Mounts the full-screen approval preview viewer on top of the current
  // approval panel. Uses the same nested-takeover pattern as
  // openTaskOutputViewer: we snapshot the root container's children, swap
  // in the viewer, and restore on close. The approval panel instance is
  // kept around in `activeApprovalPanel` so its selection state survives.
  private openApprovalPreview(panel: ApprovalPanelComponent, block: ApprovalPreviewBlock): void {
    if (this.approvalPreview !== undefined) return;
    const savedChildren = [...this.state.ui.children];
    const viewer = new ApprovalPreviewViewer(
      {
        block,
        onClose: () => {
          this.closeApprovalPreview();
        },
      },
      this.state.terminal,
    );
    this.state.ui.clear();
    this.state.ui.addChild(viewer);
    this.state.ui.setFocus(viewer);
    this.state.ui.requestRender(true);
    this.approvalPreview = { component: viewer, savedChildren, panel };
  }

  private closeApprovalPreview(): void {
    const preview = this.approvalPreview;
    if (preview === undefined) return;
    this.approvalPreview = undefined;
    this.state.ui.clear();
    for (const child of preview.savedChildren) {
      this.state.ui.addChild(child);
    }
    this.state.ui.setFocus(preview.panel);
    this.state.ui.requestRender(true);
  }

  private showQuestionDialog(payload: QuestionPanelData): void {
    this.patchLivePane({ pendingQuestion: { data: payload } });
    notifyTerminalOnce(this.state, `question:${payload.id}`, {
      title: 'Pythinker Code needs your answer',
      body: payload.questions[0]?.question,
    });
    const dialog = new QuestionDialogComponent(
      { data: payload },
      (response) => {
        this.questionController.respond(response);
      },
      6,
      () => {
        this.toggleToolOutputExpansion();
      },
    );
    this.mountEditorReplacement(dialog);
  }

  private hideQuestionDialog(): void {
    this.patchLivePane({ pendingQuestion: null });
    this.restoreEditor();
  }
}
