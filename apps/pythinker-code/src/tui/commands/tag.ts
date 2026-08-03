import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export async function handleTagCommand(host: SlashCommandHost, args: string): Promise<void> {
  const tag = normalizeTag(args);
  if (tag === undefined) {
    host.showError('Usage: /tag <name> (letters, numbers, dots, dashes, and underscores).');
    return;
  }

  try {
    const session = host.requireSession();
    const metadata = await session.getSessionMetadata();
    if (metadata.custom['tag'] !== tag) {
      await session.updateSessionMetadata({
        custom: { ...metadata.custom, tag },
      });
      host.showStatus(`Tagged session with #${tag}.`, 'success');
      return;
    }

    host.mountEditorReplacement(
      new ChoicePickerComponent({
        title: `Remove tag #${tag}?`,
        options: [
          { value: 'remove', label: 'Yes, remove tag', tone: 'danger' },
          { value: 'keep', label: 'No, keep tag' },
        ],
        onSelect: (choice) => {
          host.restoreEditor();
          if (choice !== 'remove') return;
          void removeTag(host, metadata.custom, tag);
        },
        onCancel: () => {
          host.restoreEditor();
        },
      }),
    );
  } catch (error) {
    host.showError(`Failed to update session tag: ${formatErrorMessage(error)}`);
  }
}

async function removeTag(
  host: SlashCommandHost,
  metadata: Record<string, unknown>,
  tag: string,
): Promise<void> {
  const { tag: _tag, ...custom } = metadata;
  void _tag;
  try {
    await host.requireSession().updateSessionMetadata({ custom });
    host.showStatus(`Removed tag #${tag}.`, 'success');
  } catch (error) {
    host.showError(`Failed to remove session tag: ${formatErrorMessage(error)}`);
  }
}

function normalizeTag(value: string): string | undefined {
  const tag = value.trim().replace(/^#/, '').normalize('NFKC');
  if (tag.length === 0 || tag.length > 64) return undefined;
  return /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(tag) ? tag : undefined;
}
