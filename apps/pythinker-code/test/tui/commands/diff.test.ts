import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands';
import {
  buildWorkingTreeDiffLines,
  handleDiffCommand,
} from '#/tui/commands/diff';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('diff slash command', () => {
  it('opens a native file picker for current working-tree changes', async () => {
    const mountEditorReplacement = vi.fn();
    const host = {
      session: {
        listWorkingTreeChanges: vi.fn(async () => ({
          branch: 'feature',
          additions: 3,
          deletions: 1,
          truncated: false,
          files: [
            {
              path: 'src/main.ts',
              status: 'modified',
              additions: 3,
              deletions: 1,
              binary: false,
            },
          ],
        })),
      },
      mountEditorReplacement,
      restoreEditor: vi.fn(),
      showNotice: vi.fn(),
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleDiffCommand(host, '');

    expect(mountEditorReplacement).toHaveBeenCalledOnce();
    expect(mountEditorReplacement.mock.calls[0]?.[0].render(100).join('\n')).toContain(
      'src/main.ts',
    );
  });

  it('colors and labels a unified per-file diff', () => {
    const lines = buildWorkingTreeDiffLines({
      path: 'src/main.ts',
      diff: [
        'diff --git a/src/main.ts b/src/main.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new',
      ].join('\n'),
      truncated: false,
    }).map(strip);

    expect(lines[0]).toBe('src/main.ts');
    expect(lines).toContain('@@ -1 +1 @@');
    expect(lines).toContain('-old');
    expect(lines).toContain('+new');
  });
});
