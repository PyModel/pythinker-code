import type {
  WorkingTreeChange,
  WorkingTreeFileDiff,
} from '@pythoughts/pythinker-code-sdk';

import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { UsagePanelComponent } from '../components/messages/usage-panel';
import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/pythinker-tui';
import { currentTheme } from '../theme';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export async function handleDiffCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  const path = args.trim();
  if (path.length > 0) {
    await showWorkingTreeFileDiff(host, path);
    return;
  }

  try {
    const changes = await session.listWorkingTreeChanges();
    if (changes.files.length === 0) {
      host.showNotice('Working tree is clean');
      return;
    }
    const stats = `+${String(changes.additions)} -${String(changes.deletions)}`;
    const notice = [
      changes.branch.length > 0 ? changes.branch : 'detached HEAD',
      `${String(changes.files.length)} file${changes.files.length === 1 ? '' : 's'}`,
      stats,
      changes.truncated ? 'first 500 shown' : '',
    ].filter(Boolean).join(' · ');
    host.mountEditorReplacement(
      new ChoicePickerComponent({
        title: 'Uncommitted changes',
        notice,
        searchable: true,
        options: changes.files.map(changeOption),
        onSelect: (value) => {
          host.restoreEditor();
          void showWorkingTreeFileDiff(host, value);
        },
        onCancel: () => {
          host.restoreEditor();
        },
      }),
    );
  } catch (error) {
    host.showError(`Failed to load working-tree changes: ${formatErrorMessage(error)}`);
  }
}

export function buildWorkingTreeDiffLines(
  file: WorkingTreeFileDiff,
): string[] {
  const lines = [currentTheme.boldFg('primary', file.path)];
  if (file.diff.length === 0) {
    lines.push(currentTheme.fg('textDim', 'No diff content'));
    return lines;
  }
  for (const line of file.diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      lines.push(currentTheme.fg('diffAdded', line));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      lines.push(currentTheme.fg('diffRemoved', line));
    } else if (line.startsWith('@@')) {
      lines.push(currentTheme.fg('diffMeta', line));
    } else {
      lines.push(currentTheme.fg('textDim', line));
    }
  }
  if (file.truncated) {
    lines.push('', currentTheme.fg('warning', 'Diff truncated at 1 MiB.'));
  }
  return lines;
}

function changeOption(change: WorkingTreeChange): {
  readonly value: string;
  readonly label: string;
  readonly description: string;
} {
  const counts =
    change.binary
      ? 'binary'
      : change.additions > 0 || change.deletions > 0
        ? `+${String(change.additions)} -${String(change.deletions)}`
        : '';
  return {
    value: change.path,
    label: change.path,
    description: [change.status, counts].filter(Boolean).join(' · '),
  };
}

async function showWorkingTreeFileDiff(
  host: SlashCommandHost,
  path: string,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  try {
    const file = await session.getWorkingTreeDiff(path);
    const panel = new UsagePanelComponent(
      () => buildWorkingTreeDiffLines(file),
      'primary',
      ' Diff ',
    );
    host.state.transcriptContainer.addChild(panel);
    host.state.ui.requestRender();
  } catch (error) {
    host.showError(`Failed to load diff for ${path}: ${formatErrorMessage(error)}`);
  }
}
