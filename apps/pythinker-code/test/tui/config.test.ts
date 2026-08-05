import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_STATUS_LINE_CONFIG,
  DEFAULT_TUI_CONFIG,
  INVALID_TUI_CONFIG_MESSAGE,
  loadTuiConfig,
  parseTuiConfig,
  saveTuiConfig,
  TuiConfigParseError,
} from '#/tui/config';

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = join(tmpdir(), `pythinker-tui-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  filePath = join(dir, 'tui.toml');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('TUI config', () => {
  it('creates the default config when the file does not exist', async () => {
    const result = await loadTuiConfig(filePath);

    expect(result).toEqual(DEFAULT_TUI_CONFIG);
    const text = readFileSync(filePath, 'utf-8');
    expect(text).toContain('Client preferences for pythinker-code.');
    expect(text).toContain('theme = "auto"');
    expect(text).toContain('copy_full_response = false');
    expect(text).toContain('command = ""');
    expect(text).toContain('[upgrade]');
    expect(text).toContain('auto_install = true');
    expect(text).toContain('[notifications]');
    expect(text).toContain('enabled = true');
    expect(text).toContain('notification_condition = "unfocused"');
    expect(text.match(/^\[status_line\]$/gmu)).toHaveLength(1);
    for (const key of [
      'show_model',
      'show_effort',
      'show_token_speed',
      'show_context_bar',
      'show_git',
      'show_modes',
      'show_elapsed',
      'show_goal',
      'show_background_tasks',
    ]) {
      expect(text).toContain(`${key} = true`);
    }
  });

  it('parses valid TOML', () => {
    const config = parseTuiConfig(`
theme = "light"
layout = "inline"

[editor]
command = "code --wait"

[notifications]
enabled = false
notification_condition = "always"

[upgrade]
auto_install = false
`);

    expect(config).toEqual({
      theme: 'light',
      layout: 'inline',
      copyFullResponse: false,
      editorCommand: 'code --wait',
      notifications: { enabled: false, condition: 'always' },
      upgrade: { autoInstall: false },
      statusLine: DEFAULT_STATUS_LINE_CONFIG,
    });
  });

  it('normalizes an empty editor command to auto-detect', () => {
    const config = parseTuiConfig(`
[editor]
command = "   "
`);

    expect(config).toEqual({
      theme: 'auto',
      layout: 'fixed',
      copyFullResponse: false,
      editorCommand: null,
      notifications: { enabled: true, condition: 'unfocused' },
      upgrade: { autoInstall: true },
      statusLine: DEFAULT_STATUS_LINE_CONFIG,
    });
  });

  it('falls back to default notifications when the section is omitted', () => {
    const config = parseTuiConfig(`theme = "dark"`);

    expect(config.notifications).toEqual({ enabled: true, condition: 'unfocused' });
    expect(config.upgrade).toEqual({ autoInstall: true });
    expect(config.statusLine).toEqual(DEFAULT_STATUS_LINE_CONFIG);
  });

  it('normalizes partial and complete status-line tables', () => {
    expect(
      parseTuiConfig(`
[status_line]
show_model = false
show_git = false
`).statusLine,
    ).toEqual({
      ...DEFAULT_STATUS_LINE_CONFIG,
      showModel: false,
      showGit: false,
    });

    expect(
      parseTuiConfig(`
[status_line]
show_model = false
show_effort = true
show_token_speed = false
show_context_bar = true
show_git = false
show_modes = true
show_elapsed = false
show_goal = true
show_background_tasks = false
`).statusLine,
    ).toEqual({
      showModel: false,
      showEffort: true,
      showTokenSpeed: false,
      showContextBar: true,
      showGit: false,
      showModes: true,
      showElapsed: false,
      showGoal: true,
      showBackgroundTasks: false,
    });
  });

  it('parses the full-response copy preference', () => {
    expect(parseTuiConfig('copy_full_response = true').copyFullResponse).toBe(true);
  });

  it('throws TuiConfigParseError with fallback when parsing fails, leaving the file untouched', async () => {
    writeFileSync(filePath, '[[[', 'utf-8');

    const error = await loadTuiConfig(filePath).then(
      () => null,
      (error: unknown) => error,
    );

    expect(error).toBeInstanceOf(TuiConfigParseError);
    expect((error as TuiConfigParseError).message).toBe(INVALID_TUI_CONFIG_MESSAGE);
    expect((error as TuiConfigParseError).fallback).toEqual(DEFAULT_TUI_CONFIG);
    expect(readFileSync(filePath, 'utf-8')).toBe('[[[');
  });

  it('saves and reloads the normalized config', async () => {
    await saveTuiConfig(
      {
        theme: 'light',
        layout: 'inline',
        copyFullResponse: true,
        editorCommand: 'vim',
        notifications: { enabled: false, condition: 'always' },
        upgrade: { autoInstall: false },
        statusLine: {
          ...DEFAULT_STATUS_LINE_CONFIG,
          showContextBar: false,
          showModes: false,
        },
      },
      filePath,
    );

    expect(await loadTuiConfig(filePath)).toEqual({
      theme: 'light',
      layout: 'inline',
      copyFullResponse: true,
      editorCommand: 'vim',
      notifications: { enabled: false, condition: 'always' },
      upgrade: { autoInstall: false },
      statusLine: {
        ...DEFAULT_STATUS_LINE_CONFIG,
        showContextBar: false,
        showModes: false,
      },
    });
  });

  it('escapes special characters in a custom theme name so the TOML round-trips', async () => {
    const theme = 'weird"name\\with-quote';
    await saveTuiConfig(
      {
        theme,
        layout: DEFAULT_TUI_CONFIG.layout,
        copyFullResponse: DEFAULT_TUI_CONFIG.copyFullResponse,
        editorCommand: null,
        notifications: DEFAULT_TUI_CONFIG.notifications,
        upgrade: DEFAULT_TUI_CONFIG.upgrade,
        statusLine: DEFAULT_TUI_CONFIG.statusLine,
      },
      filePath,
    );

    expect((await loadTuiConfig(filePath)).theme).toBe(theme);
  });
});
