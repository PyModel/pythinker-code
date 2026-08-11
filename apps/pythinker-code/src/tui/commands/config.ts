import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  ExperimentalFeatureState,
  FlagId,
  OutputStyleCatalog,
  PermissionMode,
  PythinkerConfig,
  Session,
  WorkspaceDirectory,
} from '@pythoughts/pythinker-code-sdk';
import { coerceEffortForModel, effortLevelsForModel } from '@pythoughts/pythinker-code-sdk';
import { disableTelemetry } from '@pythoughts/pythinker-telemetry';

import { ApiKeyInputDialogComponent } from '../components/dialogs/api-key-input-dialog';
import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { EditorSelectorComponent } from '../components/dialogs/editor-selector';
import { EffortSelectorComponent } from '../components/dialogs/effort-selector';
import {
  ExperimentsSelectorComponent,
  type ExperimentalFeatureDraftChange,
} from '../components/dialogs/experiments-selector';
import {
  modelDisplayName,
  modelIdentity,
  normalizeModelChoices,
  resolveNormalizedModelAlias,
} from '../components/dialogs/model-selector';
import { TabbedModelSelectorComponent } from '../components/dialogs/tabbed-model-selector';
import { PermissionSelectorComponent } from '../components/dialogs/permission-selector';
import { SettingsSelectorComponent, type SettingsSelection } from '../components/dialogs/settings-selector';
import { ThemeSelectorComponent } from '../components/dialogs/theme-selector';
import { UpdatePreferenceSelectorComponent } from '../components/dialogs/update-preference-selector';
import { saveTuiConfig } from '../config';
import { generateKeybindingsTemplate } from '../keybindings';
import type { ThemeName } from '#/tui/theme';
import { currentTheme, isBuiltInTheme, lightColors, loadCustomThemeMerged } from '#/tui/theme';
import {
  openFileInExternalEditor,
  resolveEditorCommand,
} from '#/utils/process/external-editor';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/pythinker-tui';
import { formatErrorMessage } from '../utils/event-payload';
import { showUsage } from './info';
import { setExperimentalFeatures } from './experimental-flags';
import { showDirectoryInput } from './add-dir';
import type { SlashCommandHost } from './dispatch';

const BUILT_IN_MODEL_ROLES = ['small', 'implementer', 'advisor'] as const;

// ---------------------------------------------------------------------------
// Plan / Config commands
// ---------------------------------------------------------------------------


export async function handlePlanCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  if (subcmd === 'clear') {
    await session.clearPlan();
    host.showNotice('Plan cleared');
    return;
  }

  let enabled: boolean;
  if (subcmd.length === 0) enabled = !host.state.appState.planMode;
  else if (subcmd === 'on') enabled = true;
  else if (subcmd === 'off') enabled = false;
  else {
    host.showError(`Unknown plan subcommand: ${subcmd}`);
    return;
  }

  await applyPlanMode(host, session, enabled);
}

async function applyPlanMode(host: SlashCommandHost, session: Session, enabled: boolean): Promise<void> {
  try {
    await session.setPlanMode(enabled);
    host.setAppState({ planMode: enabled });
    if (enabled) {
      const plan = await session.getPlan().catch(() => null);
      host.showNotice(
        'Plan mode: ON',
        plan?.path !== undefined ? `Plan will be created here: ${plan.path}` : undefined,
      );
      return;
    }
    host.showNotice('Plan mode: OFF');
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to set plan mode: ${msg}`);
  }
}

export async function handleYoloCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const currentMode = host.state.appState.permissionMode;

  if (subcmd === 'on') {
    if (currentMode === 'yolo') {
      host.showNotice('YOLO mode is already on');
      return;
    }
    await session.setPermission('yolo');
    host.setAppState({ permissionMode: 'yolo' });
    host.showNotice('YOLO mode: ON', 'Tool actions auto-approved; the agent may still ask you questions.');
    return;
  }

  if (subcmd === 'off') {
    if (currentMode !== 'yolo') {
      host.showNotice('YOLO mode is already off');
      return;
    }
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    host.showNotice('YOLO mode: OFF');
    return;
  }

  // toggle
  if (currentMode === 'yolo') {
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    host.showNotice('YOLO mode: OFF');
  } else {
    await session.setPermission('yolo');
    host.setAppState({ permissionMode: 'yolo' });
    host.showNotice('YOLO mode: ON', 'Tool actions auto-approved; the agent may still ask you questions.');
  }
}

export async function handleAutoCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const currentMode = host.state.appState.permissionMode;

  if (subcmd === 'on') {
    if (currentMode === 'auto') {
      host.showNotice('Auto mode is already on');
      return;
    }
    await session.setPermission('auto');
    host.setAppState({ permissionMode: 'auto' });
    host.showNotice('Auto mode: ON', 'All actions auto-approved; the agent will not ask you questions.');
    return;
  }

  if (subcmd === 'off') {
    if (currentMode !== 'auto') {
      host.showNotice('Auto mode is already off');
      return;
    }
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    host.showNotice('Auto mode: OFF');
    return;
  }

  // toggle
  if (currentMode === 'auto') {
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    host.showNotice('Auto mode: OFF');
  } else {
    await session.setPermission('auto');
    host.setAppState({ permissionMode: 'auto' });
    host.showNotice('Auto mode: ON', 'All actions auto-approved; the agent will not ask you questions.');
  }
}

export async function handleCompactCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  const customInstruction = args.trim() || undefined;
  await session.compact({ instruction: customInstruction });
}

export async function handleEditorCommand(host: SlashCommandHost, args: string): Promise<void> {
  const command = args.trim();
  if (command.length === 0) {
    showEditorPicker(host);
    return;
  }
  await applyEditorChoice(host, command);
}

export async function handleKeybindingsCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /keybindings');
    return;
  }

  const path = join(host.harness.homeDir, 'keybindings.json');
  await mkdir(host.harness.homeDir, { recursive: true });
  let created = true;
  try {
    await writeFile(path, generateKeybindingsTemplate(), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (!isFileExists(error)) throw error;
    created = false;
  }

  const command = resolveEditorCommand(host.state.appState.editorCommand);
  if (command === undefined) {
    host.reloadKeybindings?.();
    host.showNotice(
      `${created ? 'Created' : 'Keybindings file'}: ${path}`,
      'No editor configured. Set $VISUAL / $EDITOR, or run /editor <command>.',
    );
    return;
  }

  const opened = await openFileWithTuiSuspended(host, path, command);

  const warnings = host.reloadKeybindings?.() ?? [];
  if (!opened) {
    host.showError(`Editor exited before saving ${path}.`);
    return;
  }
  host.showNotice(
    `${created ? 'Created' : 'Opened'} ${path} in your editor.`,
    warnings.length === 0 ? 'Keybindings reloaded.' : warnings.join(' '),
  );
}

export async function openFileWithTuiSuspended(
  host: SlashCommandHost,
  path: string,
  command: string,
): Promise<boolean> {
  host.setExternalEditorRunning?.(true);
  host.state.ui.stop();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  try {
    return await openFileInExternalEditor(path, command);
  } finally {
    if (typeof process.stdin.pause === 'function') process.stdin.pause();
    host.state.ui.start();
    host.state.ui.setFocus(host.state.editor);
    host.state.ui.requestRender(true);
    host.setExternalEditorRunning?.(false);
  }
}

export async function handleThemeCommand(host: SlashCommandHost, args: string): Promise<void> {
  const theme = args.trim();
  if (theme.length === 0) {
    showThemePicker(host);
    return;
  }
  if (!isBuiltInTheme(theme)) {
    const custom = await loadCustomThemeMerged(theme);
    if (custom === null) {
      host.showError(`Unknown theme: ${theme}`);
      return;
    }
  }
  await applyThemeChoice(host, theme);
}

export async function handleOutputStyleCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  let catalog: OutputStyleCatalog;
  try {
    catalog = await host.harness.listOutputStyles(host.state.appState.workDir);
  } catch (error) {
    host.showError(`Failed to load output styles: ${formatErrorMessage(error)}`);
    return;
  }

  const requested = args.trim();
  if (requested.length === 0) {
    showOutputStylePicker(host, catalog);
    return;
  }
  if (!catalog.styles.some((style) => style.name === requested)) {
    host.showError(`Unknown output style: ${requested}`);
    return;
  }
  await applyOutputStyleChoice(host, catalog, requested);
}

type PermissionRule = NonNullable<
  NonNullable<PythinkerConfig['permission']>['rules']
>[number];
type PermissionRuleDecision = PermissionRule['decision'];

export async function handlePermissionsCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /permissions');
    return;
  }

  let rules: readonly PermissionRule[];
  let directories: readonly WorkspaceDirectory[];
  try {
    const config = await host.harness.getConfig({ reload: true });
    rules = config.permission?.rules ?? [];
    directories =
      host.session === undefined
        ? (config.additionalDirs ?? []).map((path) => ({ path, source: 'user' as const }))
        : await host.session.listWorkspaceDirectories();
  } catch (error) {
    host.showError(`Failed to load permissions: ${formatErrorMessage(error)}`);
    return;
  }

  const addOptions = (['allow', 'ask', 'deny'] as const).map((decision) => ({
    value: `add:${decision}`,
    label: `Add ${decision} rule`,
    description: 'Save a user-level tool permission rule.',
  }));
  const ruleOptions = rules.map((rule, index) => ({
    value: `rule:${String(index)}`,
    label: `${rule.decision} · ${rule.pattern}`,
    description: `${rule.scope}${rule.reason === undefined ? '' : ` · ${rule.reason}`}`,
    tone: rule.decision === 'deny' ? ('danger' as const) : undefined,
  }));
  const directoryOptions = directories.map((directory, index) => ({
    value: `directory:${String(index)}`,
    label: directory.path,
    description:
      directory.source === 'user'
        ? 'Working directory · saved in user settings'
        : 'Working directory · this session',
  }));

  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Manage permission rules',
      options: [
        ...addOptions,
        ...ruleOptions,
        {
          value: 'add-directory',
          label: 'Add working directory',
          description: 'Allow file tools to use another directory.',
        },
        ...directoryOptions,
      ],
      searchable: true,
      onSelect: (value) => {
        host.restoreEditor();
        if (value.startsWith('add:')) {
          showPermissionRuleInput(host, value.slice(4) as PermissionRuleDecision);
          return;
        }
        if (value === 'add-directory') {
          if (host.session === undefined) {
            host.showError(NO_ACTIVE_SESSION_MESSAGE);
          } else {
            showDirectoryInput(host);
          }
          return;
        }
        if (value.startsWith('directory:')) {
          const directory = directories[Number(value.slice(10))];
          if (directory !== undefined) {
            showWorkspaceDirectoryDeleteConfirmation(host, directory);
          }
          return;
        }
        const rule = rules[Number(value.slice(5))];
        if (rule !== undefined) showPermissionRuleDeleteConfirmation(host, rule);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

function showWorkspaceDirectoryDeleteConfirmation(
  host: SlashCommandHost,
  directory: WorkspaceDirectory,
): void {
  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Remove working directory?',
      notice: directory.path,
      currentValue: 'cancel',
      options: [
        {
          value: 'remove',
          label: 'Remove directory',
          description:
            directory.source === 'user'
              ? 'Remove it from this session and user settings.'
              : 'Remove it from this session.',
          tone: 'danger',
        },
        { value: 'cancel', label: 'Keep directory' },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        if (value === 'remove') void removeWorkspaceDirectory(host, directory);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function removeWorkspaceDirectory(
  host: SlashCommandHost,
  directory: WorkspaceDirectory,
): Promise<void> {
  try {
    await host.session?.removeWorkspaceDirectory(directory.path);
  } catch (error) {
    host.showError(`Failed to remove working directory: ${formatErrorMessage(error)}`);
    return;
  }

  if (directory.source === 'session') {
    host.showNotice(`Removed working directory ${directory.path}.`);
    return;
  }

  try {
    const config = await host.harness.getConfig({ reload: true });
    const workDir = host.state.appState.workDir;
    await host.harness.setConfig({
      additionalDirs: (config.additionalDirs ?? []).filter(
        (candidate) =>
          resolveWorkspaceConfigPath(candidate, workDir) !==
          resolveWorkspaceConfigPath(directory.path, workDir),
      ),
    });
    host.showNotice(`Removed working directory ${directory.path} from user settings.`);
  } catch (error) {
    host.showNotice(
      `Removed working directory ${directory.path} from this session.`,
      `Failed to save user settings: ${formatErrorMessage(error)}`,
    );
  }
}

function resolveWorkspaceConfigPath(input: string, workDir: string): string {
  const expanded =
    input === '~'
      ? homedir()
      : input.startsWith('~/') || input.startsWith('~\\')
        ? join(homedir(), input.slice(2))
        : input;
  return resolve(workDir, expanded);
}

export async function handleModelCommand(host: SlashCommandHost, args: string): Promise<void> {
  const requestedAlias = args.trim();
  const tokens = requestedAlias.split(/\s+/).filter(Boolean);
  const config = await host.harness.getConfig({ reload: true });
  const roles = [...new Set([...BUILT_IN_MODEL_ROLES, ...Object.keys(config.modelRoles ?? {})])]
    .filter((role) => role.length > 0 && role !== 'default');

  if (tokens.length === 1 && tokens[0] === 'roles') {
    host.showNotice(
      'Model roles',
      roles
        .map((role) => `${role}: ${config.modelRoles?.[role]?.trim() || '(not set)'}`)
        .join('\n'),
    );
    return;
  }

  const role = tokens[0];
  if (role !== undefined && roles.includes(role)) {
    if (tokens.length === 2 && (tokens[1] === 'clear' || tokens[1] === 'none')) {
      await host.harness.setConfig({ modelRoles: { [role]: '' } });
      host.showStatus(`Cleared the ${role} model role.`, 'success');
      return;
    }
    if (tokens.length === 1) {
      showModelPicker(host, config.modelRoles?.[role], undefined, { assignToRole: role });
      return;
    }
  }

  const normalized = normalizeModelChoices(host.state.appState.availableModels);
  const selectedValue =
    requestedAlias.length === 0
      ? undefined
      : resolveNormalizedModelAlias(
          normalized,
          requestedAlias,
          host.state.appState.availableModels[requestedAlias],
        );
  if (requestedAlias.length > 0 && selectedValue === undefined) {
    host.showError(`Unknown model alias: ${requestedAlias}`);
    return;
  }

  const picker = showModelPicker(host, selectedValue);
  if (picker !== undefined) {
    void refreshModelsForOpenPicker(host, picker, selectedValue);
  }
}

// ---------------------------------------------------------------------------
// Pickers & config apply
// ---------------------------------------------------------------------------

function showEditorPicker(host: SlashCommandHost): void {
  const currentValue = host.state.appState.editorCommand ?? '';
  host.mountEditorReplacement(
    new EditorSelectorComponent({
      currentValue,
      onSelect: (value) => {
        host.restoreEditor();
        void applyEditorChoice(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function refreshModelsForOpenPicker(
  host: SlashCommandHost,
  picker: TabbedModelSelectorComponent,
  selectedValue: string | undefined,
): Promise<void> {
  const availableModels = host.state.appState.availableModels;
  const normalized = normalizeModelChoices(availableModels);
  const currentModel = availableModels[host.state.appState.model];

  try {
    const result = await host.authFlow.refreshProviderModels();
    for (const f of result.failed) {
      host.showStatus(`Skipped refreshing ${f.provider}: ${f.reason}`, 'warning');
    }
  } catch (error) {
    host.showStatus(`Skipped refreshing models: ${formatErrorMessage(error)}`, 'warning');
    return;
  }

  if (host.state.editorContainer.children[0] !== picker) return;

  const liveSelectedAlias = picker.selectedAlias() ?? selectedValue;
  const selectedModel =
    liveSelectedAlias === undefined
      ? undefined
      : normalized.models[liveSelectedAlias] ?? availableModels[liveSelectedAlias];
  const activeTabId = picker.activeTabId();

  const refreshed = normalizeModelChoices(host.state.appState.availableModels);
  if (currentModel !== undefined) {
    const refreshedCurrent = resolveNormalizedModelAlias(
      refreshed,
      host.state.appState.model,
      currentModel,
    );
    if (refreshedCurrent === undefined) return;
    if (modelIdentity(refreshed.models[refreshedCurrent]) !== modelIdentity(currentModel)) {
      return;
    }
  }

  let refreshedSelected = liveSelectedAlias;
  if (selectedModel !== undefined) {
    refreshedSelected = resolveNormalizedModelAlias(
      refreshed,
      liveSelectedAlias ?? '',
      selectedModel,
    );
    if (refreshedSelected === undefined) return;
    if (modelIdentity(refreshed.models[refreshedSelected]) !== modelIdentity(selectedModel)) {
      return;
    }
  }

  showModelPicker(host, refreshedSelected, activeTabId);
}

async function applyEditorChoice(host: SlashCommandHost, value: string): Promise<void> {
  const previous = host.state.appState.editorCommand ?? '';
  if (value === previous && value.length > 0) {
    host.showStatus(`Editor unchanged: ${value.length > 0 ? value : 'auto-detect'}`);
    return;
  }

  const editorCommand = value.length > 0 ? value : null;
  try {
    await saveTuiConfig({
      theme: host.state.appState.theme,
      layout: host.state.layout,
      editorCommand,
      notifications: host.state.appState.notifications,
      upgrade: host.state.appState.upgrade,
      statusLine: host.state.appState.statusLine,
      copyFullResponse: host.state.copyFullResponse,
    });
  } catch (error) {
    host.showStatus(
      `Failed to save editor: ${formatErrorMessage(error)}`,
      'error',
    );
    return;
  }

  host.setAppState({ editorCommand });
  host.showStatus(
    value.length > 0
      ? `Editor set to "${value}".`
      : 'Editor set to auto-detect ($VISUAL / $EDITOR).',
  );
}

export function showModelPicker(
  host: SlashCommandHost,
  selectedValue?: string,
  initialTabId?: string,
  options?: { assignToRole?: string },
): TabbedModelSelectorComponent | undefined {
  const normalized = normalizeModelChoices(host.state.appState.availableModels);
  const entries = Object.entries(normalized.models);
  if (entries.length === 0) {
    host.showNotice(
      'No models configured',
      'Run /login to sign in to Pythinker, or /provider to add another provider from a model catalog.',
    );
    return undefined;
  }
  const currentValue =
    resolveNormalizedModelAlias(
      normalized,
      host.state.appState.model,
      host.state.appState.availableModels[host.state.appState.model],
    ) ?? host.state.appState.model;
  const selectedCandidate = selectedValue ?? host.state.appState.model;
  const resolvedSelectedValue =
    resolveNormalizedModelAlias(
      normalized,
      selectedCandidate,
      host.state.appState.availableModels[selectedCandidate],
    ) ?? currentValue;
  const picker = new TabbedModelSelectorComponent({
    models: normalized.models,
    currentValue,
    selectedValue: resolvedSelectedValue,
    currentEffort: host.state.appState.thinkingLevel,
    initialTabId,
    onSelect: ({ alias, effort }) => {
      host.restoreEditor();
      if (options?.assignToRole !== undefined) {
        void assignModelRole(host, options.assignToRole, alias);
        return;
      }
      void performModelSwitch(host, alias, effort);
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(picker);
  return picker;
}

async function assignModelRole(host: SlashCommandHost, role: string, alias: string): Promise<void> {
  // Model roles store aliases only; thinking effort stays with the active model.
  try {
    await host.harness.setConfig({ modelRoles: { [role]: alias } });
  } catch (error) {
    host.showError(`Failed to lock the ${role} model: ${formatErrorMessage(error)}`);
    return;
  }
  host.showStatus(`Locked ${alias} as the ${role} model.`, 'success');
}

async function performModelSwitch(host: SlashCommandHost, alias: string, effort: string): Promise<void> {
  if (host.state.appState.streamingPhase !== 'idle') {
    host.showError('Cannot switch models while streaming — press Esc or Ctrl-C first.');
    return;
  }

  effort = coerceEffortForModel(host.state.appState.availableModels[alias], effort);
  const prevModel = host.state.appState.model;
  const prevEffort = host.state.appState.thinkingLevel;
  const runtimeChanged = alias !== prevModel || effort !== prevEffort;

  const session = host.session;
  try {
    if (session === undefined && runtimeChanged) {
      await host.authFlow.activateModelAfterLogin(alias, effort);
    } else if (session !== undefined) {
      if (alias !== prevModel) {
        await session.setModel(alias);
      }
      if (effort !== prevEffort) {
        await session.setThinking(effort);
      }
    }
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to switch model: ${msg}`);
    return;
  }

  host.setAppState({ model: alias, thinkingLevel: effort });
  if (session === undefined && runtimeChanged) {
    if (alias !== prevModel) {
      host.track('model_switch', { model: alias });
    }
    if (effort !== prevEffort) {
      host.track('thinking_toggle', { enabled: effort !== 'off', effort });
    }
  }

  let persisted = false;
  try {
    persisted = await persistModelSelection(host, alias, effort);
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Switched to ${alias}, but failed to save default: ${msg}`);
    return;
  }

  const status = runtimeChanged
    ? `Switched to ${alias} with thinking ${effort}.`
    : persisted
      ? `Saved ${alias} with thinking ${effort} as default.`
      : `Already using ${alias} with thinking ${effort}.`;
  host.showStatus(status, 'success');
}

async function persistModelSelection(host: SlashCommandHost, alias: string, effort: string): Promise<boolean> {
  const defaultThinking = effort !== 'off';
  const config = await host.harness.getConfig({ reload: true });
  if (
    config.defaultModel === alias &&
    config.defaultThinking === defaultThinking &&
    config.thinking?.effort === effort
  ) {
    return false;
  }
  await host.harness.setConfig({
    defaultModel: alias,
    defaultThinking,
    thinking: { effort },
  });
  return true;
}

// ---------------------------------------------------------------------------
// /effort — thinking effort for the current model
// ---------------------------------------------------------------------------

export async function handleEffortCommand(host: SlashCommandHost, args: string): Promise<void> {
  const modelAlias = host.state.appState.model;
  if (modelAlias.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }
  const model = host.state.appState.availableModels[modelAlias];
  const levels = effortLevelsForModel(model);

  const requested = args.trim().toLowerCase();
  if (requested.length > 0) {
    if (!levels.includes(requested)) {
      host.showError(
        `Unknown thinking effort "${requested}" for ${modelAlias}. Valid levels: ${levels.join(', ')}.`,
      );
      return;
    }
    await applyEffortSelection(host, requested);
    return;
  }

  if (levels.length <= 1) {
    host.showStatus(`${modelAlias} does not offer selectable thinking effort levels.`);
    return;
  }

  host.mountEditorReplacement(
    new EffortSelectorComponent({
      levels,
      currentValue: coerceEffortForModel(model, host.state.appState.thinkingLevel),
      modelName: modelDisplayName(modelAlias, model),
      onSelect: (effort) => {
        host.restoreEditor();
        void applyEffortSelection(host, effort);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function applyEffortSelection(host: SlashCommandHost, effort: string): Promise<void> {
  const session = host.session;
  try {
    if (session !== undefined) {
      await session.setThinking(effort);
    }
  } catch (error) {
    host.showError(`Failed to set thinking effort: ${formatErrorMessage(error)}`);
    return;
  }

  host.setAppState({ thinkingLevel: effort });
  host.track('thinking_toggle', { enabled: effort !== 'off', effort });

  try {
    await persistModelSelection(host, host.state.appState.model, effort);
  } catch (error) {
    host.showError(`Thinking effort set to ${effort}, but failed to save default: ${formatErrorMessage(error)}`);
    return;
  }
  host.showNotice(`Thinking effort: ${effort}`);
}

function showThemePicker(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new ThemeSelectorComponent({
      currentValue: host.state.appState.theme,
      onSelect: (value) => {
        host.restoreEditor();
        void applyThemeChoice(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function applyThemeChoice(host: SlashCommandHost, theme: ThemeName): Promise<void> {
  if (theme === host.state.appState.theme) {
    if (theme === 'auto') host.refreshTerminalThemeTracking();
    host.showStatus(`Theme unchanged: "${theme}".`);
    return;
  }

  // Validate custom themes up front so a missing / malformed file reports an
  // error instead of silently persisting a name that resolves to the dark
  // fallback.
  if (!isBuiltInTheme(theme)) {
    const palette = await loadCustomThemeMerged(theme);
    if (palette === null) {
      host.showStatus(`Theme "${theme}" could not be loaded.`, 'error');
      return;
    }
  }

  try {
    await saveTuiConfig({
      theme,
      layout: host.state.layout,
      editorCommand: host.state.appState.editorCommand,
      notifications: host.state.appState.notifications,
      upgrade: host.state.appState.upgrade,
      statusLine: host.state.appState.statusLine,
      copyFullResponse: host.state.copyFullResponse,
    });
  } catch (error) {
    host.showStatus(
      `Failed to save theme: ${formatErrorMessage(error)}`,
      'error',
    );
    return;
  }

  const resolved = theme === 'auto'
    ? (currentTheme.palette === lightColors ? 'light' : 'dark')
    : undefined;
  await host.applyTheme(theme, resolved);
  host.refreshTerminalThemeTracking();
  host.track('theme_switch', { theme });
  const detail = theme === 'auto' ? ` (tracking terminal; current: ${resolved})` : '';
  host.showStatus(`Theme set to "${theme}"${detail}.`);
}

function showOutputStylePicker(host: SlashCommandHost, catalog: OutputStyleCatalog): void {
  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Select output style',
      options: catalog.styles.map((style) => ({
        value: style.name,
        label: style.name,
        description: `${style.description} (${style.source}${style.forced === true ? ', forced' : ''})`,
      })),
      currentValue: catalog.active,
      searchable: true,
      onSelect: (value) => {
        host.restoreEditor();
        void applyOutputStyleChoice(host, catalog, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function applyOutputStyleChoice(
  host: SlashCommandHost,
  catalog: OutputStyleCatalog,
  name: string,
): Promise<void> {
  try {
    await host.harness.setConfig({ outputStyle: name });
  } catch (error) {
    host.showError(`Failed to save output style: ${formatErrorMessage(error)}`);
    return;
  }

  const forced = catalog.styles.find((style) => style.active && style.forced === true);
  host.showNotice(
    `Output style saved: ${name}`,
    forced !== undefined && forced.name !== name
      ? `${forced.name} remains active while its plugin forces that style.`
      : 'Applies to new sessions.',
  );
}

export function showPermissionPicker(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new PermissionSelectorComponent({
      currentValue: host.state.appState.permissionMode,
      onSelect: (value) => {
        host.restoreEditor();
        void applyPermissionChoice(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

function showPermissionRuleInput(
  host: SlashCommandHost,
  decision: PermissionRuleDecision,
): void {
  host.mountEditorReplacement(
    new ApiKeyInputDialogComponent(
      'permission rule',
      [
        'Enter a tool name, optionally followed by a matcher.',
        'Examples: WebFetch or Bash(git *)',
      ],
      (result) => {
        host.restoreEditor();
        if (result.kind === 'ok') void addPermissionRule(host, decision, result.value);
      },
      {
        title: `Add ${decision} permission rule`,
        secret: false,
        emptyMessage: 'Permission rule cannot be empty.',
      },
    ),
  );
}

function showPermissionRuleDeleteConfirmation(
  host: SlashCommandHost,
  rule: PermissionRule,
): void {
  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Delete permission rule?',
      notice: `${rule.decision} · ${rule.pattern}`,
      currentValue: 'cancel',
      options: [
        {
          value: 'delete',
          label: 'Delete rule',
          description: 'Remove this rule from user configuration.',
          tone: 'danger',
        },
        { value: 'cancel', label: 'Keep rule' },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        if (value === 'delete') void deletePermissionRule(host, rule);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function addPermissionRule(
  host: SlashCommandHost,
  decision: PermissionRuleDecision,
  pattern: string,
): Promise<void> {
  let current: readonly PermissionRule[];
  try {
    current = (await host.harness.getConfig({ reload: true })).permission?.rules ?? [];
  } catch (error) {
    host.showError(`Failed to load permission rules: ${formatErrorMessage(error)}`);
    return;
  }
  await savePermissionRules(
    host,
    [...current, { decision, scope: 'user', pattern }],
    `Added ${decision} rule ${pattern}.`,
  );
}

async function deletePermissionRule(
  host: SlashCommandHost,
  selected: PermissionRule,
): Promise<void> {
  let current: readonly PermissionRule[];
  try {
    current = (await host.harness.getConfig({ reload: true })).permission?.rules ?? [];
  } catch (error) {
    host.showError(`Failed to load permission rules: ${formatErrorMessage(error)}`);
    return;
  }
  const index = current.findIndex((rule) => samePermissionRule(rule, selected));
  if (index < 0) {
    host.showError('Permission rule changed before it could be deleted.');
    return;
  }
  await savePermissionRules(
    host,
    current.filter((_, ruleIndex) => ruleIndex !== index),
    `Deleted ${selected.decision} rule ${selected.pattern}.`,
  );
}

async function savePermissionRules(
  host: SlashCommandHost,
  rules: readonly PermissionRule[],
  message: string,
): Promise<void> {
  try {
    await host.harness.setConfig({ permission: { rules: [...rules] } });
  } catch (error) {
    host.showError(`Failed to save permission rules: ${formatErrorMessage(error)}`);
    return;
  }

  const session = host.session;
  if (session === undefined) {
    host.showNotice(message, 'Applies to new sessions.');
    return;
  }
  try {
    await session.reloadSession();
    await host.reloadCurrentSessionView(session, message);
  } catch (error) {
    host.showError(
      `Permission rules were saved, but the active session could not reload: ${formatErrorMessage(error)}`,
    );
  }
}

function samePermissionRule(left: PermissionRule, right: PermissionRule): boolean {
  return (
    left.decision === right.decision &&
    left.scope === right.scope &&
    left.pattern === right.pattern &&
    left.reason === right.reason
  );
}

export function showUpdatePreferencePicker(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new UpdatePreferenceSelectorComponent({
      currentValue: host.state.appState.upgrade.autoInstall,
      onSelect: (value) => {
        host.restoreEditor();
        void applyUpdatePreferenceChoice(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

export function showCopyPreferencePicker(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Copy responses',
      currentValue: host.state.copyFullResponse ? 'on' : 'off',
      options: [
        {
          value: 'off',
          label: 'Choose each time',
          description: 'Offer full-response and code-block choices.',
        },
        {
          value: 'on',
          label: 'Always copy full response',
          description: 'Skip the picker when code blocks are present.',
        },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        void applyCopyPreferenceChoice(host, value === 'on');
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

export async function showExperimentsPanel(host: SlashCommandHost): Promise<void> {
  let features: readonly ExperimentalFeatureState[];
  try {
    features = await host.harness.getExperimentalFeatures();
  } catch (error) {
    host.showError(`Failed to load experimental features: ${formatErrorMessage(error)}`);
    return;
  }
  mountExperimentsPanel(host, features);
}

export async function handlePrivacySettingsCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const value = args.trim().toLowerCase();
  if (value === 'on' || value === 'off') {
    await applyPrivacyPreferenceChoice(host, value === 'on');
    return;
  }
  if (value.length > 0) {
    host.showError('Usage: /privacy-settings [on|off]');
    return;
  }

  let enabled: boolean;
  try {
    enabled = (await host.harness.getConfig({ reload: true })).telemetry !== false;
  } catch (error) {
    host.showError(`Failed to load privacy settings: ${formatErrorMessage(error)}`);
    return;
  }

  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Telemetry',
      currentValue: enabled ? 'on' : 'off',
      options: [
        {
          value: 'off',
          label: 'Disabled',
          description: 'Do not send product telemetry.',
        },
        {
          value: 'on',
          label: 'Enabled',
          description: 'Send product telemetry to help improve Pythinker Code.',
        },
      ],
      onSelect: (selection) => {
        host.restoreEditor();
        void applyPrivacyPreferenceChoice(host, selection === 'on');
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

export async function applyPrivacyPreferenceChoice(
  host: SlashCommandHost,
  enabled: boolean,
): Promise<void> {
  try {
    await host.harness.setConfig({ telemetry: enabled });
  } catch (error) {
    host.showError(`Failed to update privacy settings: ${formatErrorMessage(error)}`);
    return;
  }

  if (!enabled) {
    disableTelemetry();
    host.showNotice(
      'Telemetry disabled',
      'Applied immediately and saved for future launches.',
    );
    return;
  }
  host.showNotice(
    'Telemetry enabled',
    'Saved for future launches. Restart Pythinker Code to apply.',
  );
}

export async function applyExperimentalFeatureChanges(
  host: SlashCommandHost,
  changes: readonly ExperimentalFeatureDraftChange[],
): Promise<void> {
  if (changes.length === 0) {
    host.showStatus(
      'No experimental feature changes to apply.',
      'textMuted',
    );
    return;
  }

  const experimental: Partial<Record<FlagId, boolean>> = {};
  for (const change of changes) {
    experimental[change.id] = change.enabled;
  }

  try {
    await host.harness.setConfig({ experimental });
    const features = await host.harness.getExperimentalFeatures();
    setExperimentalFeatures(features);
    host.restoreEditor();
    if (host.session !== undefined) {
      await host.session.reloadSession();
      // After the reload, never before: a flag can gate which skills exist, so
      // rebuilding first read the registry the reload was about to replace.
      await host.refreshSkillCommands(host.session);
      await host.reloadCurrentSessionView(
        host.session,
        'Experimental features updated. Session reloaded.',
      );
    } else {
      await host.refreshSkillCommands(undefined);
      host.showStatus('Experimental features updated.', 'success');
    }
    host.track('experimental_features_apply', { changed: changes.length });
  } catch (error) {
    host.showError(`Failed to update experimental features: ${formatErrorMessage(error)}`);
  }
}

function mountExperimentsPanel(
  host: SlashCommandHost,
  features: readonly ExperimentalFeatureState[],
): void {
  host.mountEditorReplacement(
    new ExperimentsSelectorComponent({
      features,
      onApply: (changes) => {
        void applyExperimentalFeatureChanges(host, changes);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

type UpdatePreferenceHost = {
  readonly state: {
    readonly copyFullResponse: boolean;
    readonly layout: SlashCommandHost['state']['layout'];
    readonly appState: Pick<
      SlashCommandHost['state']['appState'],
      'theme' | 'editorCommand' | 'notifications' | 'upgrade' | 'statusLine'
    >;
  };
  setAppState(patch: Pick<SlashCommandHost['state']['appState'], 'upgrade'>): void;
  showStatus(msg: string, color?: string): void;
  track: SlashCommandHost['track'];
};

type CopyPreferenceHost = {
  readonly state: {
    copyFullResponse: boolean;
    readonly layout: SlashCommandHost['state']['layout'];
    readonly appState: Pick<
      SlashCommandHost['state']['appState'],
      'theme' | 'editorCommand' | 'notifications' | 'upgrade' | 'statusLine'
    >;
  };
  showStatus(msg: string, color?: string): void;
};

export async function applyCopyPreferenceChoice(
  host: CopyPreferenceHost,
  enabled: boolean,
): Promise<void> {
  if (enabled === host.state.copyFullResponse) {
    host.showStatus(`Full-response copying already ${enabled ? 'enabled' : 'disabled'}.`);
    return;
  }

  try {
    await saveTuiConfig({
      theme: host.state.appState.theme,
      layout: host.state.layout,
      editorCommand: host.state.appState.editorCommand,
      notifications: host.state.appState.notifications,
      upgrade: host.state.appState.upgrade,
      statusLine: host.state.appState.statusLine,
      copyFullResponse: enabled,
    });
  } catch (error) {
    host.showStatus(
      `Failed to save copy preference: ${formatErrorMessage(error)}`,
      'error',
    );
    return;
  }

  host.state.copyFullResponse = enabled;
  host.showStatus(`Full-response copying ${enabled ? 'enabled' : 'disabled'}.`);
}

export async function applyUpdatePreferenceChoice(
  host: UpdatePreferenceHost,
  autoInstall: boolean,
): Promise<void> {
  if (autoInstall === host.state.appState.upgrade.autoInstall) {
    host.showStatus(`Automatic updates already ${autoInstall ? 'enabled' : 'disabled'}.`);
    return;
  }

  const upgrade = { autoInstall };
  try {
    await saveTuiConfig({
      theme: host.state.appState.theme,
      layout: host.state.layout,
      editorCommand: host.state.appState.editorCommand,
      notifications: host.state.appState.notifications,
      upgrade,
      statusLine: host.state.appState.statusLine,
      copyFullResponse: host.state.copyFullResponse,
    });
  } catch (error) {
    host.showStatus(
      `Failed to save automatic update setting: ${formatErrorMessage(error)}`,
      'error',
    );
    return;
  }

  host.setAppState({ upgrade });
  host.track('upgrade_preference_changed', { auto_install: autoInstall });
  host.showStatus(`Automatic updates ${autoInstall ? 'enabled' : 'disabled'}.`);
}

async function applyPermissionChoice(host: SlashCommandHost, mode: PermissionMode): Promise<void> {
  if (mode === host.state.appState.permissionMode) {
    host.showStatus(`Permission mode unchanged: ${mode}.`);
    return;
  }

  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to set permission mode: ${msg}`);
    return;
  }

  host.setAppState({ permissionMode: mode });
  host.showNotice(`Permission mode: ${mode}`);
}

export function showSettingsSelector(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new SettingsSelectorComponent({
      onSelect: (value) => {
        handleSettingsSelection(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

function handleSettingsSelection(host: SlashCommandHost, value: SettingsSelection): void {
  host.restoreEditor();
  switch (value) {
    case 'model': showModelPicker(host); return;
    case 'output-style': void handleOutputStyleCommand(host, ''); return;
    case 'permission': showPermissionPicker(host); return;
    case 'theme': showThemePicker(host); return;
    case 'editor': showEditorPicker(host); return;
    case 'experiments': void showExperimentsPanel(host); return;
    case 'copy': showCopyPreferencePicker(host); return;
    case 'upgrade': showUpdatePreferencePicker(host); return;
    case 'usage': void showUsage(host); return;
  }
}

function isFileExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}
