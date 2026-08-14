import { describe, expect, it, vi } from 'vitest';

import {
  EditorKeyboardController,
  type EditorKeyboardHost,
} from '#/tui/controllers/editor-keyboard';
import type { ImageAttachmentStore } from '#/tui/utils/image-attachment-store';

function makeHost() {
  const editor: Record<string, unknown> = {};
  const setConfig = vi.fn(() => Promise.resolve());
  const getConfig = vi.fn(() =>
    Promise.resolve({ defaultModel: undefined, defaultThinking: undefined, thinking: undefined }),
  );
  const host = {
    state: {
      editor,
      ui: { addInputListener: vi.fn(() => () => {}), requestRender: vi.fn() },
      appState: {
        model: 'test/model',
        thinkingLevel: 'low',
        availableModels: {
          'test/model': {
            capabilities: ['thinking'],
            supportEfforts: ['low', 'medium', 'high', 'max'],
          },
        },
      },
    },
    session: { setThinking: vi.fn(() => Promise.resolve()) },
    harness: { getConfig, setConfig },
    cancelInFlight: undefined,
    setAppState: vi.fn(),
    track: vi.fn(),
    showError: vi.fn(),
    showNotice: vi.fn(),
    dispatchFooter: vi.fn(),
    updateEditorBorderHighlight: vi.fn(),
    updateQueueDisplay: vi.fn(),
  } as unknown as EditorKeyboardHost;
  return { host, editor, setConfig, getConfig };
}

describe('EditorKeyboardController thinking-effort cycling', () => {
  it('persists the cycled effort as the startup default', async () => {
    const { host, editor, setConfig } = makeHost();
    const controller = new EditorKeyboardController(host, {} as unknown as ImageAttachmentStore);
    controller.install();

    const onCycleEffort = editor['onCycleEffort'] as () => void;
    expect(typeof onCycleEffort).toBe('function');
    onCycleEffort();
    await vi.waitFor(() => {
      expect(setConfig).toHaveBeenCalledWith({
        defaultModel: 'test/model',
        defaultThinking: true,
        thinking: { effort: 'medium', mode: 'on' },
      });
    });
  });
});
