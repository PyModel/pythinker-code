import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { resolveEditorCommand } from '#/utils/process/external-editor';

import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { formatErrorMessage } from '../utils/event-payload';
import { openFileWithTuiSuspended } from './config';
import type { SlashCommandHost } from './dispatch';

type MemoryScope = 'user' | 'project';

export async function handleMemoryCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const scope = args.trim().toLowerCase();
  if (scope.length === 0) {
    showMemoryPicker(host);
    return;
  }
  if (scope !== 'user' && scope !== 'project') {
    host.showError('Usage: /memory [user|project]');
    return;
  }
  await openMemoryFile(host, scope);
}

export function showMemoryPicker(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Edit memory',
      options: [
        {
          value: 'user',
          label: 'User memory',
          description: `Instructions shared across projects in ${join(
            host.harness.homeDir,
            'AGENTS.md',
          )}.`,
        },
        {
          value: 'project',
          label: 'Project memory',
          description: `Instructions for this project in ${join(
            host.state.appState.workDir,
            'AGENTS.md',
          )}.`,
        },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        void openMemoryFile(host, value as MemoryScope);
      },
      onCancel: () => {
        host.restoreEditor();
        host.showNotice('Cancelled memory editing');
      },
    }),
  );
}

async function openMemoryFile(
  host: SlashCommandHost,
  scope: MemoryScope,
): Promise<void> {
  const path = join(
    scope === 'user' ? host.harness.homeDir : host.state.appState.workDir,
    'AGENTS.md',
  );
  try {
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, '', { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (!isFileExists(error)) throw error;
    }

    const command = resolveEditorCommand(host.state.appState.editorCommand);
    if (command === undefined) {
      host.showNotice(
        `Memory file: ${path}`,
        'No editor configured. Set $VISUAL / $EDITOR, or run /editor <command>.',
      );
      return;
    }
    if (!(await openFileWithTuiSuspended(host, path, command))) {
      host.showError(`Editor exited before saving ${path}.`);
      return;
    }

    try {
      await host.session?.refreshInstructions();
      host.showNotice(
        `Opened ${path} in your editor.`,
        host.session === undefined ? 'Applies to new sessions.' : 'Instructions refreshed.',
      );
    } catch (error) {
      host.showNotice(
        `Opened ${path} in your editor.`,
        `Failed to refresh instructions: ${formatErrorMessage(error)}`,
      );
    }
    host.track('memory_file_opened', { scope });
  } catch (error) {
    host.showError(`Failed to open memory file: ${formatErrorMessage(error)}`);
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
