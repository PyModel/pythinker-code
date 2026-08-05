import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands';
import { handleKeybindingsCommand } from '#/tui/commands/config';
import { PythinkerTUI } from '#/tui/pythinker-tui';
import {
  defaultKeybindings,
  editorShortcutHelp,
  generateKeybindingsTemplate,
  isKeybindingAware,
  KeybindingResolver,
  keybindingDisplayText,
  loadKeybindings,
  parseKeybindingBlocks,
  watchKeybindings,
} from '#/tui/keybindings';

const fsMocks = vi.hoisted(() => ({
  unwatchFile: vi.fn(),
  watchFile: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  ...fsMocks,
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('TUI keybindings', () => {
  it('provides every supported context and its default binding block', () => {
    const defaults = defaultKeybindings();

    expect([...new Set(defaults.map((binding) => binding.context))]).toEqual([
      'Global',
      'Chat',
      'Autocomplete',
      'Confirmation',
      'Help',
      'HistorySearch',
      'Tabs',
      'Footer',
      'MessageSelector',
      'MessageActions',
      'ModelPicker',
      'Select',
      'Plugin',
    ]);
    expect(defaults.some((binding) => binding.action === 'messageActions:enter')).toBe(true);
  });

  it('binds shift+tab to cycle thinking effort, not plan mode, by default', () => {
    const defaults = defaultKeybindings();
    const shiftTab = defaults.find(
      (binding) => binding.context === 'Chat' && binding.chord.join(' ') === 'shift+tab',
    );
    expect(shiftTab?.action).toBe('chat:thinkingToggle');
  });

  it('dispatches specific contexts before Global and supports OpenTUI key IDs', () => {
    const defaults = defaultKeybindings();
    const resolver = new KeybindingResolver(defaults);
    const calls: string[] = [];

    expect(
      resolver.dispatch('\u001B[A', ['Select'], {
        'select:previous': () => {
          calls.push('select');
        },
      }),
    ).toBe(true);
    expect(calls).toEqual(['select']);

    const overridden = parseKeybindingBlocks([
      { context: 'Global', bindings: { 'alt+k': 'app:redraw' } },
      { context: 'Select', bindings: { 'alt+k': 'select:previous' } },
    ]);
    const contextResolver = new KeybindingResolver(overridden);
    expect(
      contextResolver.dispatch('\u001Bk', ['Select'], {
        'app:redraw': () => {
          calls.push('global');
        },
        'select:previous': () => {
          calls.push('specific');
        },
      }),
    ).toBe(true);
    expect(calls.at(-1)).toBe('specific');
    expect(
      resolver.dispatchKeyId('up', ['Select'], {
        'select:previous': () => {
          calls.push('key-id');
        },
      }),
    ).toBe(true);
    expect(calls.at(-1)).toBe('key-id');
  });

  it('honors null bindings, ignores unhandled actions, and clears chords on context changes', () => {
    const resolver = new KeybindingResolver(
      parseKeybindingBlocks([
        {
          context: 'Select',
          bindings: {
            'alt+x': null,
            'alt+y': 'select:accept',
            'ctrl+k ctrl+g': 'select:accept',
          },
        },
      ]),
    );

    expect(resolver.dispatch('\u001Bx', ['Select'], {})).toBe(true);
    expect(resolver.dispatch('\u001By', ['Select'], {})).toBe(false);
    expect(resolver.dispatch('\u000B', ['Select'], {})).toBe(true);
    expect(resolver.dispatch('\u0007', ['Chat'], { 'select:accept': () => {} })).toBe(false);
    expect(resolver.dispatch('\u001B[A', ['Select'], {})).toBe(false);
  });

  it('reprocesses a pending-chord mismatch as a fresh key', () => {
    const resolver = new KeybindingResolver(
      parseKeybindingBlocks([
        {
          context: 'Select',
          bindings: {
            'ctrl+k ctrl+g': 'select:accept',
            x: 'select:cancel',
          },
        },
      ]),
    );
    const onCancel = vi.fn();

    expect(resolver.dispatchKeyId('ctrl+k', ['Select'], {})).toBe(true);
    expect(
      resolver.dispatchKeyId('x', ['Select'], {
        'select:cancel': onCancel,
      }),
    ).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();

    expect(resolver.dispatchKeyId('ctrl+k', ['Select'], {})).toBe(true);
    expect(resolver.dispatchKeyId('q', ['Select'], {})).toBe(false);
  });

  it('uses effective last-wins bindings for display text and recognizes aware components', () => {
    const bindings = parseKeybindingBlocks([
      { context: 'Select', bindings: { up: 'select:previous', k: 'select:previous' } },
      { context: 'Select', bindings: { up: null } },
    ]);
    const aware = { setKeybindings: vi.fn() };

    expect(keybindingDisplayText(bindings, 'Select', 'select:previous')).toBe('k');
    expect(isKeybindingAware(aware)).toBe(true);
    expect(isKeybindingAware({ setKeybindings: true })).toBe(false);
  });

  it('watches keybindings.json and removes the watcher on cleanup', () => {
    const onChange = vi.fn();
    const stop = watchKeybindings('/tmp/pythinker-home', onChange);

    expect(fsMocks.watchFile).toHaveBeenCalledWith(
      '/tmp/pythinker-home/keybindings.json',
      { persistent: false },
      onChange,
    );

    stop();

    expect(fsMocks.unwatchFile).toHaveBeenCalledWith(
      '/tmp/pythinker-home/keybindings.json',
      onChange,
    );
  });

  it('silences successful watched reloads but reports warnings', () => {
    let warnings: readonly string[] = [];
    const showStatus = vi.fn();
    const host = {
      stopKeybindingsWatcher: undefined,
      harness: { homeDir: '/tmp/pythinker-home' },
      reloadKeybindings: vi.fn(() => warnings),
      showStatus,
    };
    const startKeybindingsWatcher = (
      PythinkerTUI.prototype as unknown as {
        startKeybindingsWatcher(this: typeof host): void;
      }
    ).startKeybindingsWatcher;

    startKeybindingsWatcher.call(host);
    const onChange = fsMocks.watchFile.mock.calls[0]?.[2] as () => void;

    onChange();
    expect(showStatus).not.toHaveBeenCalled();

    warnings = ['Invalid keybinding override.'];
    onChange();
    expect(showStatus).toHaveBeenCalledWith(
      'Keybindings reloaded with warnings: Invalid keybinding override.',
      'warning',
    );
  });

  it('loads user overrides, unbinds defaults, and resolves two-key chords', async () => {
    const homeDir = await temporaryHome();
    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [
          {
            context: 'Chat',
            bindings: {
              'ctrl+t': null,
              'alt+t': 'chat:thinkingToggle',
              'ctrl+k ctrl+g': 'chat:externalEditor',
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = loadKeybindings(homeDir);
    const resolver = new KeybindingResolver(loaded.bindings);
    const calls: string[] = [];

    expect(loaded.warnings).toEqual([]);
    expect(loaded.valid).toBe(true);
    expect(resolver.dispatch('\u0014', ['Chat'], {})).toBe(true);
    expect(
      resolver.dispatch('\u001Bt', ['Chat'], {
        'chat:thinkingToggle': () => {
          calls.push('thinking');
        },
      }),
    ).toBe(true);
    expect(resolver.dispatch('\u000B', ['Chat'], {})).toBe(true);
    expect(
      resolver.dispatch('\u0007', ['Chat'], {
        'chat:externalEditor': () => {
          calls.push('editor');
        },
      }),
    ).toBe(true);
    expect(calls).toEqual(['thinking', 'editor']);
  });

  it('accepts slash-command keybindings', async () => {
    const homeDir = await temporaryHome();
    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [
          {
            context: 'Chat',
            bindings: {
              'alt+h': 'command:help',
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = loadKeybindings(homeDir);
    const resolver = new KeybindingResolver(loaded.bindings);
    const commands: string[] = [];

    expect(loaded.warnings).toEqual([]);
    expect(
      resolver.dispatch('\u001Bh', ['Chat'], {}, { onCommand: (command) => commands.push(command) }),
    ).toBe(true);
    expect(commands).toEqual(['help']);
  });

  it('accepts MessageActions bindings and distinguishes missing, malformed, and invalid files', async () => {
    const homeDir = await temporaryHome();
    expect(loadKeybindings(join(homeDir, 'missing')).valid).toBe(true);

    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [{ context: 'MessageActions', bindings: { enter: 'messageActions:enter' } }],
      }),
      'utf8',
    );
    expect(loadKeybindings(homeDir)).toMatchObject({ valid: true, warnings: [] });

    await writeFile(join(homeDir, 'keybindings.json'), '{"bindings":', 'utf8');
    expect(loadKeybindings(homeDir)).toMatchObject({ valid: false });

    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'alt+x': 'not:an-action' } }] }),
      'utf8',
    );
    expect(loadKeybindings(homeDir)).toMatchObject({ valid: false });
  });

  it('uses source-compatible redraw, history-search, and model-picker defaults', () => {
    const loaded = loadKeybindings('/missing-keybindings-home');
    const resolver = new KeybindingResolver(loaded.bindings);
    const calls: string[] = [];

    expect(
      resolver.dispatch('\u000C', ['Chat'], {
        'app:redraw': () => {
          calls.push('redraw');
        },
      }),
    ).toBe(true);
    expect(
      resolver.dispatch('\u0012', ['Chat'], {
        'history:search': () => {
          calls.push('history');
        },
      }),
    ).toBe(true);
    expect(
      resolver.dispatch('\u001Bp', ['Chat'], {
        'chat:modelPicker': () => {
          calls.push('model');
        },
      }),
    ).toBe(true);
    expect(
      resolver.dispatch('\u001B[1;2A', ['Chat'], {
        'chat:messageActions': () => {
          calls.push('messages');
        },
      }),
    ).toBe(true);
    expect(calls).toEqual(['redraw', 'history', 'model', 'messages']);
  });

  it('keeps Ctrl-C and Ctrl-D reserved while reporting invalid overrides', async () => {
    const homeDir = await temporaryHome();
    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [
          {
            context: 'Global',
            bindings: {
              'ctrl+c': 'chat:thinkingToggle',
              'ctrl+d': null,
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = loadKeybindings(homeDir);
    const resolver = new KeybindingResolver(loaded.bindings);
    const calls: string[] = [];

    expect(loaded.warnings).toHaveLength(2);
    expect(
      resolver.dispatch('\u0003', ['Chat'], {
        'app:interrupt': () => {
          calls.push('interrupt');
        },
      }),
    ).toBe(true);
    expect(
      resolver.dispatch('\u0004', ['Chat'], {
        'app:exit': () => {
          calls.push('exit');
        },
      }),
    ).toBe(true);
    expect(calls).toEqual(['interrupt', 'exit']);
  });

  it('warns about terminal-reserved shortcuts without rejecting them', async () => {
    const homeDir = await temporaryHome();
    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [
          {
            context: 'Chat',
            bindings: {
              'ctrl+z': 'chat:thinkingToggle',
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = loadKeybindings(homeDir);
    const resolver = new KeybindingResolver(loaded.bindings);
    const calls: string[] = [];

    expect(loaded.warnings).toContain(
      'ctrl+z may be intercepted by the terminal: Unix process suspend (SIGTSTP).',
    );
    expect(
      resolver.dispatch('\u001A', ['Chat'], {
        'chat:thinkingToggle': () => {
          calls.push('thinking');
        },
      }),
    ).toBe(true);
    expect(calls).toEqual(['thinking']);
  });

  it('warns when a bindings block contains duplicate JSON keys', async () => {
    const homeDir = await temporaryHome();
    await writeFile(
      join(homeDir, 'keybindings.json'),
      `{
        "bindings": [{
          "context": "Chat",
          "bindings": {
            "ctrl+t": "chat:thinkingToggle",
            "ctrl+t": null
          }
        }]
      }`,
      'utf8',
    );

    expect(loadKeybindings(homeDir).warnings).toContain(
      'Duplicate key "ctrl+t" in Chat bindings; the last value wins.',
    );
  });

  it('warns when normalized shortcuts conflict across blocks', async () => {
    const homeDir = await temporaryHome();
    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [
          {
            context: 'Chat',
            bindings: {
              'control+t': 'chat:thinkingToggle',
            },
          },
          {
            context: 'Chat',
            bindings: {
              'ctrl+t': null,
            },
          },
        ],
      }),
      'utf8',
    );

    expect(loadKeybindings(homeDir).warnings).toContain(
      'Duplicate binding "ctrl+t" in Chat bindings; the last value wins.',
    );
  });

  it('warns about inactive keybinding contexts instead of silently accepting them', async () => {
    const homeDir = await temporaryHome();
    await writeFile(
      join(homeDir, 'keybindings.json'),
      JSON.stringify({
        bindings: [
          {
            context: 'Unknown',
            bindings: {
              'alt+t': 'chat:thinkingToggle',
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = loadKeybindings(homeDir);

    expect(loaded.warnings).toContain(
      'Unknown keybinding context: Unknown. Supported contexts: Global, Chat, Autocomplete, Confirmation, Help, HistorySearch, Tabs, Footer, MessageSelector, MessageActions, ModelPicker, Select, Plugin.',
    );
    expect(loaded.bindings).not.toContainEqual(
      expect.objectContaining({ context: 'Unknown' }),
    );
  });

  it('falls back to defaults for malformed configuration and drives help labels from bindings', async () => {
    const homeDir = await temporaryHome();
    await writeFile(join(homeDir, 'keybindings.json'), '{"bindings": "bad"}', 'utf8');

    const loaded = loadKeybindings(homeDir);
    const help = editorShortcutHelp(loaded.bindings);

    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.valid).toBe(false);
    expect(help).toContainEqual({
      keys: 'ctrl+o',
      description: 'Toggle tool output expansion',
    });
  });

  it('generates a valid template without non-rebindable shortcuts', async () => {
    const template = generateKeybindingsTemplate();
    const homeDir = await temporaryHome();
    await writeFile(join(homeDir, 'keybindings.json'), template, 'utf8');

    expect(JSON.parse(template)).toMatchObject({
      bindings: expect.any(Array),
    });
    expect(template).not.toContain('"ctrl+c"');
    expect(template).not.toContain('"ctrl+d"');
    expect(loadKeybindings(homeDir).warnings).toEqual([]);
    expect(loadKeybindings(homeDir).valid).toBe(true);
  });

  it('creates the keybindings file and reports how to configure an editor', async () => {
    vi.stubEnv('VISUAL', '');
    vi.stubEnv('EDITOR', '');
    const homeDir = await temporaryHome();
    const reloadKeybindings = vi.fn(() => []);
    const showNotice = vi.fn();
    const host = {
      harness: { homeDir },
      state: { appState: { editorCommand: null } },
      reloadKeybindings,
      showNotice,
      showError: vi.fn(),
    } as unknown as SlashCommandHost;

    await handleKeybindingsCommand(host, '');

    expect(JSON.parse(await readFile(join(homeDir, 'keybindings.json'), 'utf8'))).toMatchObject({
      bindings: expect.any(Array),
    });
    expect(reloadKeybindings).toHaveBeenCalledOnce();
    expect(showNotice).toHaveBeenCalledWith(
      expect.stringContaining('Created'),
      expect.stringContaining('No editor configured'),
    );
  });
});

async function temporaryHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'pythinker-keybindings-'));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  return directory;
}
