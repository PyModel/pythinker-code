import { ApiKeyInputDialogComponent } from '../components/dialogs/api-key-input-dialog';
import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/pythinker-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export async function handleAddDirCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const path = args.trim();
  if (path.length === 0) {
    showDirectoryInput(host);
    return;
  }
  showDirectoryScopePicker(host, path);
}

export function showDirectoryInput(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new ApiKeyInputDialogComponent(
      'working directory',
      ['Enter a directory to add to the current workspace.'],
      (result) => {
        host.restoreEditor();
        if (result.kind === 'ok') showDirectoryScopePicker(host, result.value);
      },
      {
        title: 'Add working directory',
        secret: false,
        emptyMessage: 'Directory path cannot be empty.',
      },
    ),
  );
}

function showDirectoryScopePicker(host: SlashCommandHost, path: string): void {
  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Add working directory?',
      notice: path,
      options: [
        {
          value: 'session',
          label: 'Yes, for this session',
          description: 'Allow file tools to use this directory in the active session.',
        },
        {
          value: 'remember',
          label: 'Yes, and remember this directory',
          description: 'Also save it to user configuration for future sessions.',
        },
        { value: 'cancel', label: 'No' },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        if (value === 'cancel') {
          host.showNotice(`Did not add ${path} as a working directory.`);
          return;
        }
        void addDirectory(host, path, value === 'remember');
      },
      onCancel: () => {
        host.restoreEditor();
        host.showNotice(`Did not add ${path} as a working directory.`);
      },
    }),
  );
}

async function addDirectory(
  host: SlashCommandHost,
  path: string,
  remember: boolean,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  let directory: string;
  try {
    directory = (await session.addWorkspaceDirectory(path)).path;
  } catch (error) {
    host.showError(`Failed to add working directory: ${formatErrorMessage(error)}`);
    return;
  }

  if (!remember) {
    host.track('workspace_directory_added', { remembered: false });
    host.showNotice(
      `Added ${directory} as a working directory for this session`,
      '/permissions to manage',
    );
    return;
  }

  try {
    const config = await host.harness.getConfig({ reload: true });
    await host.harness.setConfig({
      additionalDirs: [...new Set([...(config.additionalDirs ?? []), directory])],
    });
    host.track('workspace_directory_added', { remembered: true });
    host.showNotice(
      `Added ${directory} as a working directory and saved to user settings`,
      '/permissions to manage',
    );
  } catch (error) {
    host.showNotice(
      `Added ${directory} as a working directory for this session`,
      `Failed to save user settings: ${formatErrorMessage(error)}`,
    );
  }
}
