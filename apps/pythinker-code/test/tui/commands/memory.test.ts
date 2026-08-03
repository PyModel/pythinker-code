import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands';
import { handleMemoryCommand } from '#/tui/commands/memory';
import { openFileInExternalEditor } from '#/utils/process/external-editor';

vi.mock('#/utils/process/external-editor', () => ({
  openFileInExternalEditor: vi.fn(async () => true),
  resolveEditorCommand: vi.fn(() => 'test-editor'),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  for (const directory of tempDirs.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('memory slash command', () => {
  it('opens user instructions and refreshes the active model context', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'pythinker-memory-home-'));
    const workDir = await mkdtemp(join(tmpdir(), 'pythinker-memory-work-'));
    tempDirs.push(homeDir, workDir);
    const refreshInstructions = vi.fn(async () => {});
    const showNotice = vi.fn();
    const host = {
      harness: { homeDir },
      session: { refreshInstructions },
      state: {
        appState: { editorCommand: null, workDir },
        editor: {},
        ui: {
          stop: vi.fn(),
          start: vi.fn(),
          setFocus: vi.fn(),
          requestRender: vi.fn(),
        },
      },
      setExternalEditorRunning: vi.fn(),
      showNotice,
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleMemoryCommand(host, 'user');

    const path = join(homeDir, 'AGENTS.md');
    await expect(readFile(path, 'utf-8')).resolves.toBe('');
    expect(openFileInExternalEditor).toHaveBeenCalledWith(path, 'test-editor');
    expect(refreshInstructions).toHaveBeenCalledOnce();
    expect(showNotice).toHaveBeenCalledWith(`Opened ${path} in your editor.`, 'Instructions refreshed.');
  });
});
