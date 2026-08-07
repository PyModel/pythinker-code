import { mkdir, writeFile } from 'node:fs/promises';

import {
  renderSavedWorkflowSkill,
  savedWorkflowSkillDir,
  savedWorkflowSkillName,
  type PermissionMode,
} from '@pythoughts/pythinker-code-sdk';
import { join } from 'pathe';

import { getDataDir } from '#/utils/paths';
import {
  DynamicWorkflowStartPermissionPromptComponent,
  type DynamicWorkflowStartPermissionChoice,
} from '../components/dialogs/dynamic-workflow-start-permission-prompt';
import {
  DynamicWorkflowModeMarkerComponent,
  type DynamicWorkflowModeMarkerState,
} from '../components/messages/dynamic-workflow-markers';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/pythinker-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';
import { isDynamicWorkflowDisabled } from './workflow-availability';

export async function handleDynamicWorkflowCommand(host: SlashCommandHost, args: string): Promise<void> {
  if (isDynamicWorkflowDisabled()) {
    host.showError('Dynamic Workflow is disabled by configuration.');
    return;
  }
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const prompt = args.trim();
  if (handleModelSubcommand(host, prompt)) return;
  if (await handleSaveSubcommand(host, prompt)) return;

  const mode = dynamicWorkflowModeSubcommand(prompt);
  if (mode !== undefined) {
    await applyDynamicWorkflowMode(host, mode, `/workflow ${prompt}`);
    return;
  }

  if (prompt.length === 0) {
    await applyDynamicWorkflowMode(host, !host.state.appState.dynamicWorkflowMode, '/workflow');
    return;
  }

  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  if (host.state.appState.permissionMode === 'manual') {
    showDynamicWorkflowStartPermissionPrompt(host, `/workflow ${prompt}`, 'Dynamic Workflow task not started.', (choice) =>
      startDynamicWorkflowWithPermission(host, prompt, choice),
    );
    return;
  }

  await startDynamicWorkflowTask(host, prompt);
}

function showDynamicWorkflowStartPermissionPrompt(
  host: SlashCommandHost,
  commandText: string,
  cancelStatus: string,
  onSelect: (choice: DynamicWorkflowStartPermissionChoice) => Promise<void>,
): void {
  const cancelStart = (): void => {
    host.restoreInputText(commandText);
    host.showStatus(cancelStatus);
  };
  host.mountEditorReplacement(
    new DynamicWorkflowStartPermissionPromptComponent({
      onSelect: (choice) => {
        host.restoreEditor();
        void onSelect(choice);
      },
      onCancel: cancelStart,
    }),
  );
}

async function startDynamicWorkflowWithPermission(
  host: SlashCommandHost,
  prompt: string,
  choice: DynamicWorkflowStartPermissionChoice,
): Promise<void> {
  if (choice === 'auto' || choice === 'yolo') {
    if (!(await setPermissionForDynamicWorkflow(host, choice))) return;
  }
  await startDynamicWorkflowTask(host, prompt);
}

async function setPermissionForDynamicWorkflow(host: SlashCommandHost, mode: PermissionMode): Promise<boolean> {
  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
    return false;
  }
  host.setAppState({ permissionMode: mode });
  return true;
}

async function startDynamicWorkflowTask(host: SlashCommandHost, prompt: string): Promise<void> {
  if (!host.state.appState.dynamicWorkflowMode && !(await setDynamicWorkflowMode(host, true, 'task'))) {
    return;
  }
  renderDynamicWorkflowModeMarker(host, 'active');
  host.sendNormalUserInput(withWorkerModelInstruction(prompt, host.state.appState.dynamicWorkflowModel));
}

/**
 * `/workflow model <alias>` is a preference, not a hard override: it reaches the
 * subagents as an instruction to set DynamicWorkflow's `model` field, so the
 * agent can still pick something else when the task plainly calls for it.
 */
function withWorkerModelInstruction(prompt: string, model: string | undefined): string {
  return model === undefined
    ? prompt
    : `${prompt}\n\nUse model "${model}" for the DynamicWorkflow subagents in this task.`;
}

/**
 * `/workflow save <name>` writes the last run back out as a skill, so a fan-out
 * that worked can be re-run by name instead of re-described.
 *
 * Returns true when the input was a `save` subcommand and has been handled.
 */
async function handleSaveSubcommand(host: SlashCommandHost, input: string): Promise<boolean> {
  const match = /^save(?:\s+(.*))?$/iu.exec(input);
  if (match === null) return false;

  const name = match[1]?.trim() ?? '';
  if (name.length === 0) {
    host.showError('Usage: /workflow save <name>');
    return true;
  }

  const args = host.state.lastDynamicWorkflowArgs;
  if (args === undefined) {
    host.showError('No Dynamic Workflow has run in this session yet.');
    return true;
  }

  const description = stringArg(args, 'description');
  if (description === undefined) {
    host.showError('The last Dynamic Workflow has no description to save.');
    return true;
  }

  try {
    const dir = savedWorkflowSkillDir({
      scope: 'project',
      name,
      projectRoot: host.state.appState.workDir,
      brandHomeDir: getDataDir(),
    });
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      renderSavedWorkflowSkill({
        name: savedWorkflowSkillName(name),
        description,
        subagentType: stringArg(args, 'subagent_type'),
        promptTemplate: stringArg(args, 'prompt_template'),
        model: stringArg(args, 'model'),
        effort: stringArg(args, 'effort'),
        outputSchema: recordArg(args, 'output_schema'),
      }),
      'utf8',
    );
    host.refreshSlashCommandAutocomplete();
    host.showStatus(`Saved /${savedWorkflowSkillName(name)} to ${dir}.`);
  } catch (error) {
    host.showError(`Failed to save workflow: ${formatErrorMessage(error)}`);
  }
  return true;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function recordArg(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Returns true when the input was a `model` subcommand and has been handled. */
function handleModelSubcommand(host: SlashCommandHost, input: string): boolean {
  const match = /^model(?:\s+(.*))?$/iu.exec(input);
  if (match === null) return false;

  const value = match[1]?.trim() ?? '';
  const current = host.state.appState.dynamicWorkflowModel;
  if (value.length === 0) {
    host.showStatus(
      current === undefined
        ? 'Dynamic Workflow subagents use this session model. Set another with /workflow model <alias>.'
        : `Dynamic Workflow subagents use ${current}. Clear it with /workflow model off.`,
    );
    return true;
  }
  if (value.toLowerCase() === 'off' || value.toLowerCase() === 'clear') {
    host.setAppState({ dynamicWorkflowModel: undefined });
    host.showStatus('Dynamic Workflow subagents now use this session model.');
    return true;
  }
  // An alias the engine cannot resolve falls back to the session model at spawn
  // time, so accepting one here would report a routing that never happens.
  const configured = host.state.appState.availableModels;
  if (Object.keys(configured).length > 0 && !Object.hasOwn(configured, value)) {
    host.showError(`Unknown model: ${value}. Run /model to see the configured aliases.`);
    return true;
  }
  host.setAppState({ dynamicWorkflowModel: value });
  host.showStatus(`Dynamic Workflow subagents will use ${value}.`);
  return true;
}

async function applyDynamicWorkflowMode(
  host: SlashCommandHost,
  enabled: boolean,
  commandText: string,
): Promise<void> {
  if (enabled && host.state.appState.dynamicWorkflowMode) {
    host.showStatus('Dynamic Workflow mode is already on.');
    return;
  }
  if (!enabled && !host.state.appState.dynamicWorkflowMode) {
    host.showStatus('Dynamic Workflow mode is already off.');
    return;
  }
  if (enabled && host.state.appState.permissionMode === 'manual') {
    showDynamicWorkflowStartPermissionPrompt(host, commandText, 'Dynamic Workflow mode not enabled.', async (choice) => {
      if ((choice === 'auto' || choice === 'yolo') && !(await setPermissionForDynamicWorkflow(host, choice))) {
        return;
      }
      if (!(await setDynamicWorkflowMode(host, true, 'manual'))) return;
      renderDynamicWorkflowModeMarker(host, 'active');
    });
    return;
  }
  if (!(await setDynamicWorkflowMode(host, enabled, 'manual'))) return;
  renderDynamicWorkflowModeMarker(host, enabled ? 'active' : 'inactive');
}

async function setDynamicWorkflowMode(
  host: SlashCommandHost,
  enabled: boolean,
  trigger: 'manual' | 'task',
): Promise<boolean> {
  try {
    await host.requireSession().setDynamicWorkflowMode(enabled, trigger);
  } catch (error) {
    host.showError(
      `Failed to ${enabled ? 'enable' : 'disable'} Dynamic Workflow mode: ${formatErrorMessage(error)}`,
    );
    return false;
  }
  host.setAppState({ dynamicWorkflowMode: enabled });
  host.state.dynamicWorkflowModeEntry = enabled ? trigger : undefined;
  return true;
}

function dynamicWorkflowModeSubcommand(input: string): boolean | undefined {
  const command = input.toLowerCase();
  if (command === 'on') return true;
  if (command === 'off') return false;
  return undefined;
}

function renderDynamicWorkflowModeMarker(host: SlashCommandHost, state: DynamicWorkflowModeMarkerState): void {
  host.state.transcriptContainer.addChild(
    new DynamicWorkflowModeMarkerComponent(state),
  );
  host.state.ui.requestRender();
}
