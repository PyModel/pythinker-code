export const LEGACY_TEST_PATHS = {
  startup: 'apps/pythinker-code/test/tui/pythinker-tui-startup.test.ts',
  messageFlow: 'apps/pythinker-code/test/tui/pythinker-tui-message-flow.test.ts',
  replay: 'apps/pythinker-code/test/tui/message-replay.test.ts',
  signals: 'apps/pythinker-code/test/tui/signal-handlers.test.ts',
} as const;

export type LegacyTestPath = (typeof LEGACY_TEST_PATHS)[keyof typeof LEGACY_TEST_PATHS];
export type TerminalSize = '80x24' | '120x40' | '200x60';
export type SupportedPlatform = 'darwin' | 'linux' | 'win32';
export type EvidenceChannel = 'unit' | 'headless-renderer' | 'pty' | 'npm' | 'native';
export type EvidenceStatus = 'verified' | 'required' | 'not-applicable';

export type VerificationMode =
  | { readonly kind: 'automated' }
  | { readonly kind: 'manual-only'; readonly justification: string };

export interface ParityCase {
  readonly id: string;
  readonly area: string;
  readonly legacyTest: LegacyTestPath;
  readonly scenarioId: string;
  readonly terminalSizes: readonly TerminalSize[];
  readonly platforms: readonly SupportedPlatform[];
  readonly requiredEvidence: readonly EvidenceChannel[];
  readonly evidenceStatus: Readonly<Record<EvidenceChannel, EvidenceStatus>>;
  readonly verification: VerificationMode;
  readonly status: 'active' | 'skip' | 'todo';
  readonly commands?: readonly string[];
  readonly sessionEvents?: readonly string[];
  readonly transcriptEntries?: readonly string[];
  readonly dialogRoutes?: readonly string[];
}

const ALL_SIZES = ['80x24', '120x40', '200x60'] as const satisfies readonly TerminalSize[];
const ALL_PLATFORMS = ['darwin', 'linux', 'win32'] as const satisfies readonly SupportedPlatform[];

const AUTOMATED_STATUS = {
  unit: 'verified',
  'headless-renderer': 'required',
  pty: 'required',
  npm: 'not-applicable',
  native: 'not-applicable',
} as const satisfies Readonly<Record<EvidenceChannel, EvidenceStatus>>;

function automatedCase(
  row: Omit<
    ParityCase,
    'terminalSizes' | 'platforms' | 'evidenceStatus' | 'verification' | 'status'
  > &
    Partial<Pick<ParityCase, 'terminalSizes' | 'platforms' | 'evidenceStatus'>>,
): ParityCase {
  return {
    terminalSizes: ALL_SIZES,
    platforms: ALL_PLATFORMS,
    evidenceStatus: AUTOMATED_STATUS,
    ...row,
    verification: { kind: 'automated' },
    status: 'active',
  };
}

const SESSION_EVENTS = [
  'turn.started',
  'turn.ended',
  'turn.step.started',
  'turn.step.interrupted',
  'turn.step.completed',
  'turn.step.retrying',
  'tool.progress',
  'assistant.delta',
  'hook.result',
  'hook.status',
  'thinking.delta',
  'tool.call.started',
  'tool.call.delta',
  'tool.result',
  'agent.status.updated',
  'session.meta.updated',
  'goal.updated',
  'skill.activated',
  'error',
  'warning',
  'workflow.warning',
  'compaction.started',
  'compaction.completed',
  'compaction.blocked',
  'compaction.cancelled',
  'subagent.spawned',
  'subagent.started',
  'subagent.suspended',
  'subagent.completed',
  'subagent.failed',
  'background.task.started',
  'background.task.terminated',
  'cron.fired',
  'mcp.server.status',
  'tool.list.updated',
] as const;

const TRANSCRIPT_ENTRY_KINDS = [
  'welcome',
  'user',
  'assistant',
  'tool_call',
  'thinking',
  'status',
  'skill_activation',
  'cron',
  'goal',
] as const;

const DIALOG_VIEW_ROUTES = [
  'ApiKeyInputDialogComponent',
  'ApprovalPanelComponent',
  'ApprovalPreviewViewer',
  'ChoicePickerComponent',
  'CompactionComponent',
  'CustomRegistryImportDialogComponent',
  'EditorSelectorComponent',
  'EffortSelectorComponent',
  'ExperimentsSelectorComponent',
  'FeedbackInputDialogComponent',
  'GoalQueueEditDialogComponent',
  'GoalQueueManagerComponent',
  'GoalStartPermissionPromptComponent',
  'HelpPanelComponent',
  'ModelSelectorComponent',
  'PermissionSelectorComponent',
  'PlatformSelectorComponent',
  'PluginMarketplaceSelectorComponent',
  'PluginMcpSelectorComponent',
  'PluginRemoveConfirmComponent',
  'PluginsOverviewSelectorComponent',
  'ProviderManagerComponent',
  'QuestionDialogComponent',
  'SessionPickerComponent',
  'SettingsSelectorComponent',
  'StartPermissionPromptComponent',
  'DynamicWorkflowStartPermissionPromptComponent',
  'TabbedModelSelectorComponent',
  'TaskOutputViewer',
  'TasksBrowserApp',
  'ThemeSelectorComponent',
  'UndoSelectorComponent',
  'UpdatePreferenceSelectorComponent',
] as const;

const COMMANDS = [
  'add-dir',
  'agents',
  'yolo',
  'auto',
  'permission',
  'permissions',
  'settings',
  'plan',
  'workflow',
  'model',
  'effort',
  'fast',
  'provider',
  'btw',
  'colors',
  'commit',
  'commit-push-pr',
  'context',
  'copy',
  'cost',
  'debug',
  'diff',
  'doctor',
  'files',
  'heapdump',
  'help',
  'hooks',
  'keybindings',
  'memory',
  'new',
  'sessions',
  'tasks',
  'mcp',
  'plugins',
  'pr-comments',
  'privacy-settings',
  'experiments',
  'reload',
  'release-notes',
  'reload-plugins',
  'reload-tui',
  'review',
  'security-review',
  'compact',
  'goal',
  'init',
  'init-verifiers',
  'fork',
  'title',
  'usage',
  'status',
  'feedback',
  'output-style',
  'skills',
  'tag',
  'terminal-setup',
  'undo',
  'update',
  'editor',
  'theme',
  'vim',
  'logout',
  'login',
  'export-md',
  'export-debug-zip',
  'web',
  'exit',
  'version',
] as const;

const commandCases: readonly ParityCase[] = COMMANDS.map((command) =>
  automatedCase({
    id: `command-${command}`,
    area: `slash command /${command}`,
    legacyTest: LEGACY_TEST_PATHS.messageFlow,
    scenarioId: `legacy.command.${command.replaceAll('-', '_')}`,
    requiredEvidence: ['unit', 'headless-renderer'],
    commands: [command],
  }),
);

export const PARITY_CASES: readonly ParityCase[] = [
  automatedCase({
    id: 'lifecycle-auth-migration-error-recovery',
    area: 'lifecycle, authentication, migration, and startup error recovery',
    legacyTest: LEGACY_TEST_PATHS.startup,
    scenarioId: 'legacy.lifecycle.startup_auth_migration_recovery',
    requiredEvidence: ['unit', 'headless-renderer', 'pty'],
  }),
  automatedCase({
    id: 'session-create-resume-fork-replay',
    area: 'session creation, resume, fork, replay, and cwd scoping',
    legacyTest: LEGACY_TEST_PATHS.replay,
    scenarioId: 'legacy.session.live_resume_fork_replay',
    requiredEvidence: ['unit', 'headless-renderer'],
  }),
  automatedCase({
    id: 'input-history-autocomplete-media-keybindings',
    area: 'input, history, autocomplete, attachments, clipboard, and keybindings',
    legacyTest: LEGACY_TEST_PATHS.messageFlow,
    scenarioId: 'legacy.input.edit_history_complete_media_keys',
    requiredEvidence: ['unit', 'headless-renderer', 'pty'],
  }),
  automatedCase({
    id: 'transcript-streaming-tools-grouping',
    area: 'transcript ordering, streaming completion, tools, and grouping',
    legacyTest: LEGACY_TEST_PATHS.messageFlow,
    scenarioId: 'legacy.transcript.stream_complete_tools_grouping',
    requiredEvidence: ['unit', 'headless-renderer'],
    sessionEvents: SESSION_EVENTS.slice(0, 23),
    transcriptEntries: TRANSCRIPT_ENTRY_KINDS,
  }),
  automatedCase({
    id: 'transcript-message-actions',
    area: 'keyboard transcript selection, copying, tool-input extraction, and prompt editing',
    legacyTest: LEGACY_TEST_PATHS.messageFlow,
    scenarioId: 'legacy.transcript.message_actions',
    requiredEvidence: ['unit', 'headless-renderer'],
  }),
  automatedCase({
    id: 'transcript-partial-compaction',
    area: 'selected-range conversation compaction and prompt restoration',
    legacyTest: LEGACY_TEST_PATHS.messageFlow,
    scenarioId: 'legacy.transcript.partial_compaction',
    requiredEvidence: ['unit', 'headless-renderer'],
  }),
  automatedCase({
    id: 'approvals-questions',
    area: 'approval choices, previews, structured questions, and focus restoration',
    legacyTest: LEGACY_TEST_PATHS.messageFlow,
    scenarioId: 'legacy.reverse_rpc.approvals_questions',
    requiredEvidence: ['unit', 'headless-renderer', 'pty'],
  }),
  automatedCase({
    id: 'dialogs-settings-routes',
    area: 'dialogs, selectors, full-screen views, providers, plugins, and settings',
    legacyTest: LEGACY_TEST_PATHS.messageFlow,
    scenarioId: 'legacy.views.dialog_settings_routes',
    requiredEvidence: ['unit', 'headless-renderer'],
    dialogRoutes: DIALOG_VIEW_ROUTES,
  }),
  automatedCase({
    id: 'goals-tasks-queue',
    area: 'goals, background tasks, upcoming goals, todo state, and input queue',
    legacyTest: LEGACY_TEST_PATHS.replay,
    scenarioId: 'legacy.work.goals_tasks_todo_queue',
    requiredEvidence: ['unit', 'headless-renderer'],
  }),
  automatedCase({
    id: 'agents-dynamic-workflow-cron-mcp-hooks',
    area: 'agents, Dynamic Workflow, cron, MCP, skills, and hooks',
    legacyTest: LEGACY_TEST_PATHS.messageFlow,
    scenarioId: 'legacy.integrations.agents_dynamic_workflow_cron_mcp_hooks',
    requiredEvidence: ['unit', 'headless-renderer'],
    sessionEvents: SESSION_EVENTS.slice(23),
  }),
  automatedCase({
    id: 'themes-media-cjk-terminal',
    area: 'themes, images, diff/code media, CJK width, resize, and terminal capabilities',
    legacyTest: LEGACY_TEST_PATHS.startup,
    scenarioId: 'legacy.terminal.theme_media_cjk_resize',
    requiredEvidence: ['unit', 'headless-renderer', 'pty'],
  }),
  automatedCase({
    id: 'shutdown-signals-terminal-restoration',
    area: 'shutdown, signals, stream errors, cleanup, and terminal restoration',
    legacyTest: LEGACY_TEST_PATHS.signals,
    scenarioId: 'legacy.shutdown.signals_restore_terminal',
    requiredEvidence: ['unit', 'pty'],
  }),
  ...commandCases,
  {
    id: 'distribution-development-npm-native-nix',
    area: 'development launch, npm package, native binary, and Nix distribution paths',
    legacyTest: LEGACY_TEST_PATHS.signals,
    scenarioId: 'legacy.distribution.dev_npm_native_nix',
    terminalSizes: ALL_SIZES,
    platforms: ALL_PLATFORMS,
    requiredEvidence: ['npm', 'native', 'pty'],
    evidenceStatus: {
      unit: 'not-applicable',
      'headless-renderer': 'not-applicable',
      pty: 'required',
      npm: 'required',
      native: 'required',
    },
    verification: {
      kind: 'manual-only',
      justification:
        'Published npm tarballs, native artifacts, and Nix builds are produced outside the unit-test sandbox and must be exercised as release artifacts.',
    },
    status: 'active',
  },
] as const;

export const PARITY_CASE_IDS = PARITY_CASES.map(({ id }) => id);
