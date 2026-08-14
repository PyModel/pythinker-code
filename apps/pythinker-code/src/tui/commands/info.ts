import { join, relative } from 'node:path';

import type {
  McpServerInfo,
  PythinkerConfig,
  SessionStatus,
  SessionUsage,
} from '@pymodel/pythinker-code-sdk';

import { handleDoctor } from '#/cli/sub/doctor';
import { startManualUpdate } from '#/cli/update/preflight';
import { PYTHINKER_CODE_CHANGELOG_URL } from '#/constant/app';
import { openUrl } from '#/utils/open-url';
import { buildMcpStatusReportLines } from '../components/messages/mcp-status-panel';
import { buildStatusReportLines } from '../components/messages/status-panel';
import {
  buildContextUsageReportLines,
  buildCostReportLines,
  buildUsageReportLines,
  UsagePanelComponent,
} from '../components/messages/usage-panel';
import {
  FEEDBACK_ISSUE_URL,
} from '../constant/feedback';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export async function handleFeedbackCommand(host: SlashCommandHost): Promise<void> {
  host.showStatus(FEEDBACK_ISSUE_URL);
  openUrl(FEEDBACK_ISSUE_URL);
}

// ---------------------------------------------------------------------------
// Info commands
// ---------------------------------------------------------------------------

interface SessionUsageResult {
  readonly usage?: SessionUsage;
  readonly error?: string;
}

interface RuntimeStatusResult {
  readonly status?: SessionStatus;
  readonly error?: string;
}


export function showCost(host: SlashCommandHost): void {
  const { model, modelCostRates, totalCostUsd } = host.state.appState;
  const panel = new UsagePanelComponent(
    () => buildCostReportLines({ model, modelCostRates, totalCostUsd }),
    'primary',
    ' Cost ',
  );
  host.state.transcriptContainer.addTranscriptChild(panel, {
    role: 'ephemeral',
    edgeBlankPolicy: 'preserve',
  });
  host.state.ui.requestRender();
}

export async function showUsage(host: SlashCommandHost): Promise<void> {
  const sessionUsage = await loadSessionUsageReport(host);
  const reportArgs = {
    sessionUsage: sessionUsage.usage,
    sessionUsageError: sessionUsage.error,
    contextUsage: host.state.appState.contextUsage,
    contextTokens: host.state.appState.contextTokens,
    maxContextTokens: host.state.appState.maxContextTokens,
  };
  const panel = new UsagePanelComponent(() => buildUsageReportLines(reportArgs), 'primary');
  host.state.transcriptContainer.addTranscriptChild(panel, {
    role: 'ephemeral',
    edgeBlankPolicy: 'preserve',
  });
  host.state.ui.requestRender();
}

export function showReleaseNotes(host: SlashCommandHost): void {
  host.showNotice('Release notes', PYTHINKER_CODE_CHANGELOG_URL);
}

export function showTerminalSetup(host: SlashCommandHost): void {
  const terminal = `${process.env['TERM_PROGRAM'] ?? ''} ${process.env['TERM'] ?? ''}`.toLowerCase();
  const supportsShiftEnter = [
    'ghostty',
    'kitty',
    'wezterm',
    'iterm',
    'warp',
  ].some((name) => terminal.includes(name));
  host.showNotice(
    'Multiline input is ready',
    supportsShiftEnter
      ? 'Shift-Enter inserts a newline in this terminal. Ctrl-J is always available as a fallback.'
      : 'Ctrl-J inserts a newline. Shift-Enter also works when your terminal emits Kitty/CSI-u keyboard input.',
  );
}

export async function showContextReport(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /context');
    return;
  }
  try {
    const report = await host.requireSession().getContextUsage();
    const panel = new UsagePanelComponent(
      () => buildContextUsageReportLines(report),
      'primary',
      ' Context ',
    );
    host.state.transcriptContainer.addTranscriptChild(panel, {
      role: 'ephemeral',
      edgeBlankPolicy: 'preserve',
    });
    host.state.ui.requestRender();
  } catch (error) {
    host.showError(`Failed to load context usage: ${formatErrorMessage(error)}`);
  }
}

export async function showStatusReport(host: SlashCommandHost): Promise<void> {
  const runtimeStatus = await loadRuntimeStatusReport(host);
  const appState = host.state.appState;
  const reportArgs = {
    version: appState.version,
    model: appState.model,
    workDir: appState.workDir,
    sessionId: appState.sessionId,
    sessionTitle: appState.sessionTitle,
    thinkingLevel: appState.thinkingLevel,
    fastMode: appState.fastMode,
    fastModeSupported: appState.fastModeSupported,
    permissionMode: appState.permissionMode,
    planMode: appState.planMode,
    contextUsage: appState.contextUsage,
    contextTokens: appState.contextTokens,
    maxContextTokens: appState.maxContextTokens,
    availableModels: appState.availableModels,
    status: runtimeStatus.status,
    statusError: runtimeStatus.error,
  };
  const panel = new UsagePanelComponent(() => buildStatusReportLines(reportArgs), 'primary', ' Status ');
  host.state.transcriptContainer.addTranscriptChild(panel, {
    role: 'ephemeral',
    edgeBlankPolicy: 'preserve',
  });
  host.state.ui.requestRender();
}

export async function showMcpServers(host: SlashCommandHost): Promise<void> {
  let servers: readonly McpServerInfo[];
  try {
    servers = await host.requireSession().listMcpServers();
  } catch (error) {
    host.showError(`Failed to load MCP servers: ${formatErrorMessage(error)}`);
    return;
  }

  const title = servers.length > 0 ? ` MCP (${servers.length}) ` : ' MCP ';
  const panel = new UsagePanelComponent(
    () => buildMcpStatusReportLines({ servers }),
    'primary',
    title,
  );
  host.state.transcriptContainer.addTranscriptChild(panel, {
    role: 'ephemeral',
    edgeBlankPolicy: 'preserve',
  });
  host.state.ui.requestRender();
}

export async function showContextFiles(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /files');
    return;
  }
  try {
    const files = await host.requireSession().listContextFiles();
    if (files.length === 0) {
      host.showNotice('No files in context');
      return;
    }
    host.showNotice(
      `Files in context (${String(files.length)})`,
      files.map((file) => relative(host.state.appState.workDir, file) || '.').join('\n'),
    );
  } catch (error) {
    host.showError(`Failed to list files in context: ${formatErrorMessage(error)}`);
  }
}

export async function handleHooksCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /hooks');
    return;
  }

  let hooks: NonNullable<PythinkerConfig['hooks']>;
  try {
    hooks = (await host.harness.getConfig({ reload: true })).hooks ?? [];
  } catch (error) {
    host.showError(`Failed to load hooks: ${formatErrorMessage(error)}`);
    return;
  }
  if (hooks.length === 0) {
    host.showNotice('No hooks configured', 'Add hooks to config.toml or ask Pythinker to help.');
    return;
  }
  host.showNotice(
    `Hooks (${String(hooks.length)})`,
    hooks
      .map((hook) =>
        [
          hook.event,
          hook.matcher?.trim() || 'all',
          'command' in hook
            ? hook.command
            : hook.type === 'http'
              ? hook.url
              : hook.prompt,
          `${String(hook.timeout ?? (hook.type === 'agent' ? 60 : 30))}s`,
          hook.once === true ? 'once' : undefined,
          hook.async === true ? 'async' : undefined,
          hook.statusMessage === undefined ? undefined : `status ${hook.statusMessage}`,
          hook.if === undefined ? undefined : `if ${hook.if}`,
          'asyncRewake' in hook && hook.asyncRewake === true
            ? 'async rewake'
            : undefined,
          'shell' in hook && hook.shell === 'powershell' ? 'powershell' : undefined,
          (hook.type === 'prompt' || hook.type === 'agent') && hook.model !== undefined
            ? `model ${hook.model}`
            : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(' · '),
      )
      .join('\n'),
  );
}

/** The installer's recorded stderr tail can be ~2 KB; show one line of it. */
const UPDATE_FAILURE_REASON_MAX_CHARS = 160;

/**
 * Collapse the recorded failure reason onto one line; a long tail is cut to
 * a single sensible line and marked as truncated instead of flooding the
 * transcript with the installer's full stderr.
 */
function renderUpdateFailureReason(message: string): string | undefined {
  const singleLine = message.replaceAll(/\s+/gu, ' ').trim();
  if (singleLine.length === 0) return undefined;
  if (singleLine.length <= UPDATE_FAILURE_REASON_MAX_CHARS) return singleLine;
  return `${singleLine.slice(0, UPDATE_FAILURE_REASON_MAX_CHARS)}… (truncated)`;
}

export async function handleUpdateCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /update');
    return;
  }
  host.showStatus('Checking for updates…');
  const currentVersion = host.state.appState.version;
  const result = await startManualUpdate(currentVersion);
  switch (result.status) {
    case 'up-to-date':
      host.showNotice('Pythinker Code is up to date', `v${currentVersion}`);
      return;
    case 'started':
      host.showNotice(
        `Updating to v${result.version}`,
        result.installOnRestart
          ? 'Preparing with Homebrew in the background. Once ready, close this terminal and open a new one to install it.'
          : 'Installing in the background — close this terminal and open a new one to apply the update.',
      );
      return;
    case 'in-progress':
      // The target is present only when it is newer than the version the
      // running install is working on; everything else keeps the old wording.
      if (result.targetVersion !== undefined) {
        host.showNotice(
          `Installing v${result.installingVersion} — v${result.targetVersion} will follow`,
          `The running install of v${result.installingVersion} finishes first; ` +
            `v${result.targetVersion} installs after the next start.`,
        );
        return;
      }
      host.showNotice(
        `Update to v${result.installingVersion} already in progress`,
        result.installOnRestart
          ? result.readyToInstall
            ? 'Close this terminal and open a new one to install it.'
            : 'Close this terminal and open a new one after the current update operation finishes.'
          : 'Close this terminal and open a new one once it completes.',
      );
      return;
    case 'manual':
      host.showNotice(
        `Update available — v${result.version}`,
        `Run: ${result.command}`,
      );
      return;
    case 'failed': {
      const reason =
        result.message === undefined ? undefined : renderUpdateFailureReason(result.message);
      host.showError(
        `Update to v${result.version} failed after ${result.attempts} attempts.` +
          (reason === undefined ? '' : `\nReason: ${reason}`) +
          `\nTo update manually, run: ${result.command}`,
      );
      return;
    }
    case 'check-failed':
      host.showError(`Update check failed: ${result.message}`);
      return;
  }
}

export async function handleDoctorCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /doctor');
    return;
  }

  let report = '';
  const writer = {
    write(chunk: string): boolean {
      report += chunk;
      return true;
    },
  };
  try {
    const code = await handleDoctor(
      {
        cwd: () => host.state.appState.workDir,
        defaultConfigPath: () => host.harness.configPath,
        defaultTuiConfigPath: () => join(host.harness.homeDir, 'tui.toml'),
        stdout: writer,
        stderr: writer,
      },
      {},
    );
    const keybindingWarnings = host.reloadKeybindings?.() ?? [];
    const runtimeWarnings = await collectDoctorRuntimeWarnings(host);
    const warnings = [...keybindingWarnings, ...runtimeWarnings];
    host.showNotice(
      code !== 0
        ? 'Doctor found issues'
        : warnings.length > 0
          ? 'Doctor found warnings'
          : 'Doctor checks passed',
      [report.trim(), ...warnings].filter((line) => line.length > 0).join('\n'),
    );
  } catch (error) {
    host.showError(`Doctor failed: ${formatErrorMessage(error)}`);
  }
}

async function collectDoctorRuntimeWarnings(host: SlashCommandHost): Promise<string[]> {
  const warnings: string[] = [];
  const [config, agents] = await Promise.allSettled([
    host.harness.getConfigDiagnostics(),
    host.harness.listAgentProfiles(host.state.appState.workDir),
  ]);
  if (config.status === 'fulfilled') warnings.push(...config.value.warnings);
  else warnings.push(`Config diagnostics failed: ${formatErrorMessage(config.reason)}`);
  if (agents.status === 'fulfilled') {
    warnings.push(...agents.value.warnings.map((warning) => `${warning.path}: ${warning.error}`));
    const agentDescriptionTokens = Math.round(
      agents.value.profiles
        .filter((profile) => profile.source !== 'built-in')
        .reduce(
          (total, profile) =>
            total + `${profile.name}: ${profile.whenToUse ?? profile.description ?? ''}`.length,
          0,
        ) / 4,
    );
    if (agentDescriptionTokens > 15_000) {
      warnings.push(
        `Large agent descriptions (~${agentDescriptionTokens.toLocaleString()} tokens > 15,000).`,
      );
    }
  } else {
    warnings.push(`Agent profile diagnostics failed: ${formatErrorMessage(agents.reason)}`);
  }

  if (host.session === undefined) return warnings;
  try {
    const usage = await host.session.getContextUsage();
    const mcpTokens = usage.tools
      .filter((tool) => tool.source === 'mcp')
      .reduce((total, tool) => total + tool.tokens, 0);
    if (mcpTokens > 25_000) {
      warnings.push(`Large MCP tools context (~${mcpTokens.toLocaleString()} tokens > 25,000).`);
    }
  } catch (error) {
    warnings.push(`Context diagnostics failed: ${formatErrorMessage(error)}`);
  }
  try {
    const plugins = await host.session.listPlugins();
    for (const plugin of plugins.filter((candidate) => candidate.hasErrors)) {
      const info = await host.session.getPluginInfo(plugin.id);
      const errors = info.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      warnings.push(
        ...(errors.length === 0
          ? [`${plugin.id}: plugin state is ${plugin.state}`]
          : errors.map((diagnostic) => `${plugin.id}: ${diagnostic.message}`)),
      );
    }
  } catch (error) {
    warnings.push(`Plugin diagnostics failed: ${formatErrorMessage(error)}`);
  }
  return warnings;
}

async function loadSessionUsageReport(host: SlashCommandHost): Promise<SessionUsageResult> {
  try {
    return { usage: await host.requireSession().getUsage() };
  } catch (error) {
    return { error: formatErrorMessage(error) };
  }
}

async function loadRuntimeStatusReport(host: SlashCommandHost): Promise<RuntimeStatusResult> {
  try {
    return { status: await host.requireSession().getStatus() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

