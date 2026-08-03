import { ChoicePickerComponent } from '#/tui/components/dialogs/choice-picker';
import { handleTagCommand, type SlashCommandHost } from '#/tui/commands/index';
import { describe, expect, it, vi } from 'vitest';

describe('/tag', () => {
  it('persists a tag while preserving other custom metadata', async () => {
    const { host, session } = makeHost({ source: 'test' });

    await handleTagCommand(host, ' review ');

    expect(session.updateSessionMetadata).toHaveBeenCalledWith({
      custom: { source: 'test', tag: 'review' },
    });
    expect(host.showStatus).toHaveBeenCalledWith('Tagged session with #review.', 'success');
  });

  it('confirms before removing the current tag', async () => {
    const { host, session } = makeHost({ source: 'test', tag: 'review' });

    await handleTagCommand(host, 'review');
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0];
    expect(picker).toBeInstanceOf(ChoicePickerComponent);

    (picker as ChoicePickerComponent).handleInput('\r');
    await vi.waitFor(() => {
      expect(session.updateSessionMetadata).toHaveBeenCalledWith({
        custom: { source: 'test' },
      });
    });
    expect(host.restoreEditor).toHaveBeenCalledOnce();
    expect(host.showStatus).toHaveBeenCalledWith('Removed tag #review.', 'success');
  });
});

function makeHost(custom: Record<string, unknown>) {
  const session = {
    getSessionMetadata: vi.fn(async () => ({ custom })),
    updateSessionMetadata: vi.fn(async () => {}),
  };
  const host = {
    requireSession: vi.fn(() => session),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
    showError: vi.fn(),
  } as unknown as SlashCommandHost & {
    readonly mountEditorReplacement: ReturnType<typeof vi.fn>;
    readonly restoreEditor: ReturnType<typeof vi.fn>;
    readonly showStatus: ReturnType<typeof vi.fn>;
  };
  return { host, session };
}
