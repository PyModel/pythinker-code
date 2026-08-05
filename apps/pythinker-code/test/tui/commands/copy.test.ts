import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands';
import {
  buildMessageActionChoices,
  collectRecentAssistantTexts,
  extractFencedCodeBlocks,
  handleCopyCommand,
  showMessageActions,
} from '#/tui/commands/copy';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';
import { copyTextToClipboard } from '#/utils/clipboard/clipboard-text';

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

vi.mock('node:fs/promises', () => fsMocks);
vi.mock('#/utils/clipboard/clipboard-text', () => ({
  copyTextToClipboard: vi.fn(async () => {}),
}));

describe('copy slash command', () => {
  it('collects the newest non-empty assistant responses', () => {
    expect(
      collectRecentAssistantTexts([
        transcript('assistant', 'first'),
        transcript('tool_call', 'ignored'),
        transcript('assistant', ''),
        transcript('assistant', 'latest'),
      ]),
    ).toEqual(['latest', 'first']);
  });

  it('extracts fenced code blocks without a Markdown dependency', () => {
    expect(
      extractFencedCodeBlocks(
        'Before\n```ts\nconst answer = 42;\n```\nAfter\n~~~../../sh\nprintf ok\n~~~',
      ),
    ).toEqual([
      { code: 'const answer = 42;', language: 'ts' },
      { code: 'printf ok', language: 'sh' },
    ]);
  });

  it('copies the requested prior response and writes the fallback file', async () => {
    const host = makeHost([
      transcript('assistant', 'older'),
      transcript('assistant', 'latest'),
    ]);

    await handleCopyCommand(host, '2');

    expect(copyTextToClipboard).toHaveBeenCalledWith('older');
    expect(fsMocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/response\.md$/u),
      'older',
      'utf8',
    );
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Copied to clipboard'),
      'success',
    );
  });

  it('opens a picker for full response, code blocks, and persistent full-copy mode', async () => {
    const host = makeHost([
      transcript('assistant', 'Use this:\n```ts\nconst answer = 42;\n```'),
    ]);

    await handleCopyCommand(host, '');

    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      render(width: number): string[];
    };
    const rendered = picker.render(100).join('\n');
    expect(rendered).toContain('Copy response');
    expect(rendered).toContain('Full response');
    expect(rendered).toContain('const answer = 42;');
    expect(rendered).toContain('Always copy full responses');
    expect(rendered).toContain('W write to file');
  });

  it('builds newest-first transcript actions for user, assistant, and tool messages', () => {
    expect(
      buildMessageActionChoices([
        transcript('user', 'fix the parser'),
        transcript('thinking', 'private reasoning'),
        transcript('tool_call', 'Ran tests', {
          name: 'Bash',
          args: { command: 'pnpm test' },
        }),
        transcript('assistant', 'All checks pass.'),
      ]).map(({ label, description }) => ({ label, description })),
    ).toEqual([
      { label: 'Assistant', description: 'All checks pass.' },
      { label: 'Bash', description: 'pnpm test' },
      { label: 'User', description: 'fix the parser' },
    ]);
  });

  it('restores a selected user message for editing', () => {
    const host = makeHost([transcript('user', 'change this prompt')]);

    showMessageActions(host);

    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    picker.handleInput('\r');
    expect(host.restoreInputText).toHaveBeenCalledWith('change this prompt');
  });

  it('copies a selected transcript message with the C action', async () => {
    const host = makeHost([transcript('assistant', 'copy this answer')]);

    showMessageActions(host);

    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      handleInput(data: string): void;
    };
    picker.handleInput('c');
    await vi.waitFor(() => {
      expect(copyTextToClipboard).toHaveBeenCalledWith('copy this answer');
    });
  });

  it('routes remapped message actions to full copy, primary input, selection, and cancel', async () => {
    vi.mocked(copyTextToClipboard).mockClear();
    const host = makeHost([
      transcript('user', 'older draft'),
      transcript('assistant', 'assistant action'),
      transcript('tool_call', 'full tool action', { name: 'Bash', args: { command: 'pnpm test' } }),
      transcript('user', 'newer draft'),
    ]);
    showMessageActions(host);
    const picker = host.mountEditorReplacement.mock.calls[0]?.[0] as {
      handleInput(data: string): void;
      render(width: number): string[];
      setKeybindings(bindings: ReturnType<typeof defaultKeybindings>): void;
    };
    const bindings = [
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        {
          context: 'MessageActions',
          bindings: {
            up: null, down: null, enter: null, escape: null, c: null, p: null,
            'ctrl+p': 'messageActions:prev', 'ctrl+n': 'messageActions:next',
            'ctrl+up': 'messageActions:top', 'ctrl+down': 'messageActions:bottom',
            'alt+up': 'messageActions:prevUser', 'alt+down': 'messageActions:nextUser',
            'alt+c': 'messageActions:c', 'alt+p': 'messageActions:p',
            'alt+e': 'messageActions:enter', 'alt+x': 'messageActions:escape',
          },
        },
      ]),
    ];
    picker.setKeybindings(bindings);

    picker.handleInput('\r');
    expect(host.restoreInputText).not.toHaveBeenCalled();
    expect(copyTextToClipboard).not.toHaveBeenCalled();
    expectSelected(picker, 'User', 'newer draft');
    picker.handleInput('\u001B[A');
    expectSelected(picker, 'User', 'newer draft');
    picker.handleInput('\u001B[B');
    expectSelected(picker, 'User', 'newer draft');

    picker.handleInput('ctrl+down');
    expectSelected(picker, 'User', 'older draft');
    picker.handleInput('alt+up');
    expectSelected(picker, 'User', 'newer draft');
    picker.handleInput('ctrl+n');
    expectSelected(picker, 'Bash', 'pnpm test');
    picker.handleInput('alt+down');
    expectSelected(picker, 'User', 'older draft');
    picker.handleInput('ctrl+p');
    expectSelected(picker, 'Assistant', 'assistant action');
    picker.handleInput('ctrl+up');
    expectSelected(picker, 'User', 'newer draft');
    picker.handleInput('ctrl+n');
    expectSelected(picker, 'Bash', 'pnpm test');
    picker.handleInput('\u001Bp');
    await vi.waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith('pnpm test'));
    picker.handleInput('\u001Bc');
    await vi.waitFor(() => expect(copyTextToClipboard).toHaveBeenCalledWith('full tool action'));
    picker.handleInput('ctrl+up');
    expectSelected(picker, 'User', 'newer draft');
    picker.handleInput('\u001Be');
    expect(host.restoreInputText).toHaveBeenCalledWith('newer draft');

    vi.mocked(host.restoreEditor).mockClear();
    showMessageActions(host);
    const cancelled = host.mountEditorReplacement.mock.calls[1]?.[0] as { handleInput(data: string): void; setKeybindings(bindings: ReturnType<typeof defaultKeybindings>): void };
    cancelled.setKeybindings(bindings);
    cancelled.handleInput('\u001B');
    expect(host.restoreEditor).not.toHaveBeenCalled();
    cancelled.handleInput('\u001Bx');
    expect(host.restoreEditor).toHaveBeenCalled();
  });
});

function expectSelected(
  picker: { render(width: number): string[] },
  label: string,
  description: string,
): void {
  const rendered = picker.render(120).join('\n').replaceAll(/\u001B\[[0-9;]*m/g, '');
  expect(rendered).toContain(`❯ ${label}\n    ${description}`);
}

function transcript(
  kind: 'user' | 'assistant' | 'tool_call' | 'thinking',
  content: string,
  tool?: { readonly name: string; readonly args: Record<string, unknown> },
) {
  return {
    id: `${kind}-${content}`,
    kind,
    renderMode: 'markdown' as const,
    content,
    ...(tool === undefined
      ? {}
      : {
          toolCallData: {
            id: `${kind}-${content}-tool`,
            name: tool.name,
            args: tool.args,
          },
        }),
  };
}

function makeHost(entries: ReturnType<typeof transcript>[]) {
  return {
    state: {
      copyFullResponse: false,
      transcriptEntries: entries,
    },
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost & {
    mountEditorReplacement: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    showStatus: ReturnType<typeof vi.fn>;
  };
}
