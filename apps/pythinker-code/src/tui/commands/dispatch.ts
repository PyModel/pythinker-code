import type { Component, Focusable } from '@earendil-works/pi-tui';
import type { PythinkerHarness, Session } from '@pythoughts/pythinker-code-sdk';

import type { ColorToken, ThemeName } from '#/tui/theme';
import { performHeapDump } from '#/utils/heap-dump';

import { LLM_NOT_SET_MESSAGE } from '../constant/pythinker-tui';
import type { AuthFlowController } from '../controllers/auth-flow';
import type { BtwPanelController } from '../controllers/btw-panel';
import type { StreamingUIController } from '../controllers/streaming-ui';
import type { TasksBrowserController } from '../controllers/tasks-browser';
import { handleColorsCommand } from '../easter-eggs/rainbow-colors';
import type { ResolvedTheme } from '../theme/colors';
import type { TUIState } from '../tui-state';
import type {
  AppState,
  LoginProgressSpinnerHandle,
  QueuedMessage,
  TranscriptEntry,
} from '../types';
import { formatErrorMessage } from '../utils/event-payload';
import { handleAddDirCommand } from './add-dir';
import { handleAgentsCommand } from './agents';
import { handleLoginCommand, handleLogoutCommand } from './auth';
import { handleBtwCommand } from './btw';
import {
  handleAutoCommand,
  handleCompactCommand,
  handleEditorCommand,
  handleEffortCommand,
  handleKeybindingsCommand,
  handleModelCommand,
  handleOutputStyleCommand,
  handlePermissionsCommand,
  handlePlanCommand,
  handlePrivacySettingsCommand,
  handleThemeCommand,
  handleYoloCommand,
  showExperimentsPanel,
  showPermissionPicker,
  showSettingsSelector,
} from './config';
import { handleCopyCommand } from './copy';
import { handleDebugCommand } from './debug';
import { handleDiffCommand } from './diff';
import { handleFastCommand } from './fast';
import { handleGoalCommand } from './goal';
import { handleMemoryCommand } from './memory';
import {
  handleDoctorCommand,
  handleFeedbackCommand,
  handleUpdateCommand,
  handleHooksCommand,
  showMcpServers,
  showContextReport,
  showContextFiles,
  showCost,
  showReleaseNotes,
  showStatusReport,
  showTerminalSetup,
  showUsage,
} from './info';
import { parseSlashInput } from './parse';
import { handlePluginsCommand } from './plugins';
import { handleProviderCommand } from './provider';
import type { BuiltinSlashCommandName } from './registry';
import { handleReloadCommand, handleReloadTuiCommand } from './reload';
import { resolveSlashCommandInput, slashBusyMessage } from './resolve';
import { handleSkillsCommand } from './skills';
import {
  handleExportDebugZipCommand,
  handleExportMdCommand,
  handleForkCommand,
  handleInitCommand,
  handleTitleCommand,
} from './session';
import { handleDynamicWorkflowCommand } from './dynamic-workflow';
import { handleTagCommand } from './tag';
import { handleUndoCommand } from './undo';
import { handleVimCommand } from './vim';
import { handleWebCommand } from './web';

// ---------------------------------------------------------------------------
// Re-exports — keep existing consumers working
// ---------------------------------------------------------------------------

export { handleAgentsCommand } from './agents';
export { handleAddDirCommand } from './add-dir';
export { handleLoginCommand, handleLogoutCommand } from './auth';
export { handleBtwCommand } from './btw';
export {
  handleAutoCommand,
  handleCompactCommand,
  handleEditorCommand,
  handleEffortCommand,
  handleKeybindingsCommand,
  handleModelCommand,
  handleOutputStyleCommand,
  handlePermissionsCommand,
  handlePlanCommand,
  handlePrivacySettingsCommand,
  handleThemeCommand,
  handleYoloCommand,
  showModelPicker,
  showExperimentsPanel,
  showPermissionPicker,
  showSettingsSelector,
} from './config';
export { handleCopyCommand, showMessageActions } from './copy';
export { handleDebugCommand } from './debug';
export { handleDiffCommand } from './diff';
export { handleDynamicWorkflowCommand } from './dynamic-workflow';
export { handleFastCommand } from './fast';
export {
  handleDoctorCommand,
  handleFeedbackCommand,
  handleUpdateCommand,
  handleHooksCommand,
  showMcpServers,
  showContextReport,
  showContextFiles,
  showCost,
  showReleaseNotes,
  showStatusReport,
  showTerminalSetup,
  showUsage,
} from './info';
export { handlePluginsCommand } from './plugins';
export { handleReloadCommand, handleReloadTuiCommand } from './reload';
export { handleSkillsCommand } from './skills';
export { handleGoalCommand } from './goal';
export { handleMemoryCommand } from './memory';
export {
  handleExportDebugZipCommand,
  handleExportMdCommand,
  handleForkCommand,
  handleInitCommand,
  handleTitleCommand,
} from './session';
export { handleUndoCommand } from './undo';
export { handleWebCommand } from './web';

// ---------------------------------------------------------------------------
// Host interface
// ---------------------------------------------------------------------------

export interface SlashCommandHost {
  state: TUIState;
  session: Session | undefined;
  readonly harness: PythinkerHarness;
  cancelInFlight: (() => void) | undefined;
  deferUserMessages: boolean;

  setAppState(patch: Partial<AppState>): void;
  resetLivePane(): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  track(event: string, props?: Record<string, unknown>): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  restoreInputText(text: string): void;
  refreshSkillCommands(session?: Session): Promise<void>;
  reloadKeybindings?(): readonly string[];
  setExternalEditorRunning?(running: boolean): void;

  // Session
  requireSession(): Session;
  switchToSession(session: Session, message: string): Promise<void>;
  reloadCurrentSessionView(session: Session, message: string): Promise<void>;
  beginSessionRequest(): void;
  failSessionRequest(message: string): void;
  sendQueuedMessage(session: Session, item: QueuedMessage): void;
  requestQueuedGoalPromotion?(): void;
  /** Retires Dynamic Workflow mission controls, e.g. after an undo. */
  clearDynamicWorkflowMissionControls(): void;

  // UI
  showLoginProgressSpinner(label: string): LoginProgressSpinnerHandle;
  showProgressSpinner(label: string): LoginProgressSpinnerHandle;

  // Theme
  applyTheme(theme: ThemeName, resolved?: ResolvedTheme): Promise<void>;
  refreshTerminalThemeTracking(): void;

  // Dispatch
  stop(exitCode?: number): Promise<void>;
  setExitOpenUrl(url: string): void;
  showHelpPanel(): void;
  createNewSession(): Promise<void>;
  showSessionPicker(): Promise<void>;
  sendNormalUserInput(text: string): void;
  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void;
  readonly skillCommandMap: Map<string, string>;

  // Controller refs
  readonly streamingUI: StreamingUIController;
  readonly btwPanelController: BtwPanelController;
  readonly tasksBrowserController: TasksBrowserController;
  readonly authFlow: AuthFlowController;
}

// ---------------------------------------------------------------------------
// Dispatch — entry point from handleUserInput
// ---------------------------------------------------------------------------

export function dispatchInput(host: SlashCommandHost, text: string): void {
  if (parseSlashInput(text) !== null) {
    void executeSlashCommand(host, text);
    return;
  }
  host.sendNormalUserInput(text);
}

async function executeSlashCommand(host: SlashCommandHost, input: string): Promise<void> {
  const parsedCommand = parseSlashInput(input);
  const intent = resolveSlashCommandInput({
    input,
    skillCommandMap: host.skillCommandMap,
    isStreaming: host.state.appState.streamingPhase !== 'idle',
    isCompacting: host.state.appState.isCompacting,
  });

  switch (intent.kind) {
    case 'not-command':
      return;
    case 'blocked':
      host.track('input_command_invalid', { reason: 'blocked', command: intent.commandName });
      host.showError(slashBusyMessage(intent.commandName, intent.reason));
      return;
    case 'invalid':
      host.track('input_command_invalid', {
        reason: intent.reason,
        command: intent.commandName,
      });
      host.showError(`Invalid slash command: /${intent.commandName}`);
      return;
    case 'skill': {
      const session = host.session;
      if (host.state.appState.model.trim().length === 0 || session === undefined) {
        host.showError(LLM_NOT_SET_MESSAGE);
        return;
      }
      host.track('input_command', {
        command: intent.commandName,
        skill_name: intent.skillName,
      });
      host.sendSkillActivation(session, intent.skillName, intent.args);
      return;
    }
    case 'message':
      host.sendNormalUserInput(intent.input);
      return;
    case 'builtin':
      host.track('input_command', { command: intent.name });
      if (intent.name === 'new' && parsedCommand?.name === 'clear') {
        host.track('clear');
      }
      try {
        await handleBuiltInSlashCommand(host, intent.name, intent.args);
      } catch (error) {
        host.showError(formatErrorMessage(error));
      }
      return;
  }
}

async function handleBuiltInSlashCommand(
  host: SlashCommandHost,
  name: BuiltinSlashCommandName,
  args: string,
): Promise<void> {
  switch (name) {
    case 'colors':
      handleColorsCommand(host, args);
      return;
    case 'exit':
      void host.stop();
      return;
    case 'help':
      host.showHelpPanel();
      return;
    case 'version':
      host.showStatus(`Pythinker Code v${host.state.appState.version}`);
      return;
    case 'new':
      await host.createNewSession();
      host.state.ui.requestRender();
      return;
    case 'sessions':
      void host.showSessionPicker();
      return;
    case 'tasks':
      void host.tasksBrowserController.show();
      return;
    case 'mcp':
      void showMcpServers(host);
      return;
    case 'files':
      await showContextFiles(host, args);
      return;
    case 'hooks':
      await handleHooksCommand(host, args);
      return;
    case 'doctor':
      await handleDoctorCommand(host, args);
      return;
    case 'update':
      await handleUpdateCommand(host, args);
      return;
    case 'debug':
      await handleDebugCommand(host, args);
      return;
    case 'heapdump': {
      host.showStatus('Creating heap dump…');
      const result = await performHeapDump(
        host.state.appState.sessionId ?? 'pythinker-code',
        host.state.appState.version,
      );
      if (!result.success) {
        host.showError(`Failed to create heap dump: ${result.error}`);
        return;
      }
      host.showNotice('Heap dump created', `${result.heapPath}\n${result.diagPath}`);
      return;
    }
    case 'plugins':
      void handlePluginsCommand(host, args);
      return;
    case 'reload-plugins':
      await handlePluginsCommand(host, 'reload');
      return;
    case 'skills':
      await handleSkillsCommand(host, args);
      return;
    case 'agents':
      await handleAgentsCommand(host, args);
      return;
    case 'experiments':
      await showExperimentsPanel(host);
      return;
    case 'reload':
      await handleReloadCommand(host);
      return;
    case 'reload-tui':
      await handleReloadTuiCommand(host);
      return;
    case 'release-notes':
      showReleaseNotes(host);
      return;
    case 'review':
      host.sendNormalUserInput(reviewPrompt(args));
      return;
    case 'security-review':
      host.sendNormalUserInput(securityReviewPrompt());
      return;
    case 'pr-comments':
      host.sendNormalUserInput(pullRequestCommentsPrompt(args));
      return;
    case 'commit':
      host.sendNormalUserInput(commitPrompt(args));
      return;
    case 'commit-push-pr':
      host.sendNormalUserInput(commitPushPullRequestPrompt(args));
      return;
    case 'editor':
      await handleEditorCommand(host, args);
      return;
    case 'keybindings':
      await handleKeybindingsCommand(host, args);
      return;
    case 'terminal-setup':
      showTerminalSetup(host);
      return;
    case 'theme':
      await handleThemeCommand(host, args);
      return;
    case 'output-style':
      await handleOutputStyleCommand(host, args);
      return;
    case 'model':
      await handleModelCommand(host, args);
      return;
    case 'effort':
      await handleEffortCommand(host, args);
      return;
    case 'fast':
      await handleFastCommand(host, args);
      return;
    case 'provider':
      await handleProviderCommand(host);
      return;
    case 'permission':
      showPermissionPicker(host);
      return;
    case 'permissions':
      await handlePermissionsCommand(host, args);
      return;
    case 'settings':
      showSettingsSelector(host);
      return;
    case 'privacy-settings':
      await handlePrivacySettingsCommand(host, args);
      return;
    case 'usage':
      void showUsage(host);
      return;
    case 'cost':
      showCost(host);
      return;
    case 'context':
      void showContextReport(host, args);
      return;
    case 'memory':
      await handleMemoryCommand(host, args);
      return;
    case 'diff':
      await handleDiffCommand(host, args);
      return;
    case 'status':
      void showStatusReport(host);
      return;
    case 'tag':
      await handleTagCommand(host, args);
      return;
    case 'feedback':
      await handleFeedbackCommand(host);
      return;
    case 'btw':
      await handleBtwCommand(host, args);
      return;
    case 'title':
      await handleTitleCommand(host, args);
      return;
    case 'vim':
      await handleVimCommand(host);
      return;
    case 'yolo':
      await handleYoloCommand(host, args);
      return;
    case 'auto':
      await handleAutoCommand(host, args);
      return;
    case 'plan':
      await handlePlanCommand(host, args);
      return;
    case 'workflow':
      await handleDynamicWorkflowCommand(host, args);
      return;
    case 'compact':
      await handleCompactCommand(host, args);
      return;
    case 'copy':
      await handleCopyCommand(host, args);
      return;
    case 'add-dir':
      await handleAddDirCommand(host, args);
      return;
    case 'goal':
      await handleGoalCommand(host, args);
      return;
    case 'init':
      await handleInitCommand(host);
      return;
    case 'init-verifiers':
      host.sendNormalUserInput(initVerifiersPrompt());
      return;
    case 'fork':
      await handleForkCommand(host, args);
      return;
    case 'export-md':
      await handleExportMdCommand(host, args);
      return;
    case 'export-debug-zip':
      await handleExportDebugZipCommand(host);
      return;
    case 'login':
      await handleLoginCommand(host);
      return;
    case 'logout':
      await handleLogoutCommand(host);
      return;
    case 'undo':
      await handleUndoCommand(host, args);
      return;
    case 'web':
      await handleWebCommand(host);
      return;
    default:
      host.showError(`Unknown slash command: /${String(name)}`);
      return;
  }
}

function reviewPrompt(args: string): string {
  const selector = args.trim();
  const target = selector.length === 0
    ? 'a pull request. First run `gh pr list` and ask me which open pull request to review'
    : `pull request ${selector}`;
  return `Review ${target}. Use \`gh pr view\` for its metadata and \`gh pr diff\` for the complete diff. Report correctness defects, regressions, security risks, performance problems, convention violations, and missing tests with concrete file and line references. Keep the review concise and prioritize findings by severity.`;
}

function securityReviewPrompt(): string {
  return `Perform a focused security review of the pending branch changes. Do not modify the project. Inspect repository security patterns plus \`git status\`, \`git diff --name-only origin/HEAD...\`, \`git log --no-decorate origin/HEAD...\`, and the complete \`git diff origin/HEAD...\`. Report only newly introduced, concretely exploitable high or medium vulnerabilities with at least 80% confidence; exclude denial of service, resource exhaustion, rate limiting, dependency age, documentation, test-only code, and hardening suggestions without an attack path. For each finding, give severity, confidence, category, file and line, exploit scenario, and recommended fix. If no finding survives this filter, say so.`;
}

function pullRequestCommentsPrompt(args: string): string {
  const selector = args.trim();
  const target = selector.length === 0 ? 'the current pull request' : `pull request ${selector}`;
  return `Fetch and display comments for ${target}. Use \`gh pr view --json number,headRepository\` to resolve the repository and number, then query \`gh api /repos/{owner}/{repo}/issues/{number}/comments\` and \`gh api /repos/{owner}/{repo}/pulls/{number}/comments\`. Format PR-level and threaded review comments under \`## Comments\`, including author, file, line, diff hunk, and quoted body. Return only the formatted comments; if none exist, return exactly \`No comments found.\``;
}

function initVerifiersPrompt(): string {
  return `Create the smallest useful set of project skills for functional verification. First inspect this project's runnable product surfaces and existing skill conventions. Write each skill to \`.pythinker-code/skills/<verifier-name>/SKILL.md\` with a \`verifier-\` prefixed name, clear applicability, setup, exact read-only probes, environment-variable authentication, pass/fail reporting, and cleanup. Cover real user behavior such as a web UI, CLI, or API; do not duplicate unit tests, typechecks, or linters. Do not install dependencies, modify application code, embed secrets, or run destructive commands. If functional verification needs unavailable tooling or credentials, document that requirement instead of provisioning it.`;
}

function commitPrompt(args: string): string {
  const additional = args.trim();
  return `Create one git commit for the current relevant worktree changes. Inspect git status, staged and unstaged diffs, untracked files, and recent commit style before staging anything. Stage only files that belong together, exclude secrets, run proportionate verification, and write a concise Conventional Commit message focused on why the change exists. Never amend, update git config, skip hooks, use interactive git commands, or add co-author attribution. If there is nothing to commit, say so without creating an empty commit.${additional.length === 0 ? '' : ` Additional instructions: ${additional}`}`;
}

function commitPushPullRequestPrompt(args: string): string {
  const additional = args.trim();
  return `Publish the current relevant work as a pull request. Inspect the current branch, default branch, complete branch diff, commits, and repository instructions. Create a focused branch when currently on the default branch, make the required commit without amending or adding co-author attribution, push the branch, then create or update the pull request. Use a Conventional Commit title under 70 characters and fully complete the repository pull request template with the problem, implementation, edge cases, and verified test results. Never force-push, update git config, skip hooks, include secrets, or use interactive git commands. Return the pull request URL when finished.${additional.length === 0 ? '' : ` Additional instructions: ${additional}`}`;
}
