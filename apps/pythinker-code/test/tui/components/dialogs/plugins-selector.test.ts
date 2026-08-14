import { visibleWidth } from '@earendil-works/pi-tui';
import type { PluginSummary } from '@pymodel/pythinker-code-sdk';
import { describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

import {
  PluginMcpSelectorComponent,
  PluginMarketplaceSelectorComponent,
  PluginRemoveConfirmComponent,
  PluginsOverviewSelectorComponent,
  type PluginMcpSelection,
  type PluginRemoveConfirmResult,
} from '#/tui/components/dialogs/plugins-selector';
import { ChoicePickerComponent } from '#/tui/components/dialogs/choice-picker';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';
import { darkColors } from '#/tui/theme/colors';
import { pluginTrustLabel } from '#/tui/utils/plugin-source-label';
import type {
  PluginMarketplace,
  PluginMarketplaceEntry,
} from '#/utils/plugin-marketplace';

const ANSI_SGR = /\[[0-9;]*m/g;
const MID = '\u00B7';
const ESC = String.fromCodePoint(27);
const RIGHT = `${ESC}[C`;
const LEFT = `${ESC}[D`;

function strip(text: string): string {
  return text.replaceAll(ANSI_SGR, '').replaceAll('\u276F', '?');
}

function withAnsiColors<T>(fn: () => T): T {
  const previousChalkLevel = chalk.level;
  chalk.level = 3;
  try {
    return fn();
  } finally {
    chalk.level = previousChalkLevel;
  }
}

function renderRaw(component: { render(width: number): string[] }, width = 120): string {
  return withAnsiColors(() => component.render(width).join('\n'));
}

function dangerShortcut(text: string): string {
  return withAnsiColors(() => chalk.hex(darkColors.error).bold(text));
}

function marketplace(
  plugins: readonly PluginMarketplaceEntry[],
): PluginMarketplace {
  return {
    format: 'pythinker',
    source: '/tmp/marketplace.json',
    sourceLabel: '/tmp/marketplace.json',
    name: 'Example marketplace',
    plugins,
  };
}

function marketplaceEntry(
  overrides: Partial<PluginMarketplaceEntry> = {},
): PluginMarketplaceEntry {
  const source = 'https://example.com/example.zip';
  return {
    id: 'example',
    displayName: 'Example',
    source,
    sourceLabel: source,
    marketplaceName: 'Example marketplace',
    supportedComponents: ['skills'],
    unsupportedComponents: [],
    install: { kind: 'supported', source, options: {} },
    ...overrides,
  };
}

function pluginSummary(id: string, version?: string): PluginSummary {
  return {
    id,
    displayName: id,
    version,
    enabled: true,
    state: 'ok',
    skillCount: 0,
    mcpServerCount: 0,
    enabledMcpServerCount: 0,
    hasErrors: false,
    source: 'local-path',
  };
}

describe('plugins selector dialogs', () => {
  it('trusts only built-in Pythinker CDN plugin paths', () => {
    expect(pluginTrustLabel({
      id: 'pythinker-datasource',
      displayName: 'Pythinker Datasource',
      enabled: true,
      state: 'ok',
      skillCount: 0,
      mcpServerCount: 0,
      enabledMcpServerCount: 0,
      hasErrors: false,
      source: 'zip-url',
      originalSource: 'https://code.pythinker.com/pythinker-code/plugins/official/pythinker-datasource.zip',
    })).toBe('official');
    expect(pluginTrustLabel({
      id: 'superpowers',
      displayName: 'Superpowers',
      enabled: true,
      state: 'ok',
      skillCount: 0,
      mcpServerCount: 0,
      enabledMcpServerCount: 0,
      hasErrors: false,
      source: 'zip-url',
      originalSource: 'https://code.pythinker.com/pythinker-code/plugins/curated/superpowers.zip',
    })).toBe('curated');
    expect(pluginTrustLabel({
      id: 'demo',
      displayName: 'Demo',
      enabled: true,
      state: 'ok',
      skillCount: 0,
      mcpServerCount: 0,
      enabledMcpServerCount: 0,
      hasErrors: false,
      source: 'zip-url',
      originalSource: 'https://code.pythinker.com/demo.zip',
    })).toBe('third-party');
    expect(pluginTrustLabel({
      id: 'local',
      displayName: 'Local',
      enabled: true,
      state: 'ok',
      skillCount: 0,
      mcpServerCount: 0,
      enabledMcpServerCount: 0,
      hasErrors: false,
      source: 'local-path',
      originalSource: 'https://code.pythinker.com/pythinker-code/plugins/official/local',
    })).toBe('third-party');
  });

  it('renders installed plugins as selectable overview entries', () => {
    const onSelect = vi.fn();
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'pythinker-datasource',
          displayName: 'Pythinker Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 2,
          mcpServerCount: 1,
          enabledMcpServerCount: 1,
          hasErrors: false,
          source: 'local-path',
        },
      ],
      onSelect,
      onCancel: vi.fn(),
    });

    const raw = renderRaw(picker);
    const out = strip(raw);
    expect(out).toContain('Installed plugins (1)');
    expect(out).toContain('Actions');
    expect(out).toContain('? Pythinker Datasource  enabled');
    expect(out).toContain(`id pythinker-datasource ${MID} 2 skills ${MID} MCP 1/1`);
    expect(out).not.toContain('Space disable');
    expect(out).not.toContain('Enter info');
    expect(out).toContain('Space toggle · M MCP servers · D remove · Enter details');
    expect(out).toContain('Marketplace');
    expect(out).toContain('Summary');

    picker.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'info', id: 'pythinker-datasource' });
  });

  it('ignores Left/Right arrows in the overview (no enter/exit by arrow)', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'pythinker-datasource',
          displayName: 'Pythinker Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 2,
          mcpServerCount: 1,
          enabledMcpServerCount: 1,
          hasErrors: false,
          source: 'local-path',
        },
      ],
      onSelect,
      onCancel,
    });

    picker.handleInput(RIGHT); // must NOT open details
    expect(onSelect).not.toHaveBeenCalled();
    picker.handleInput(LEFT); // must NOT cancel/exit
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('renders a searchable marketplace list with persistent bounded details', () => {
    const onSelect = vi.fn();
    const entry = marketplaceEntry({
      id: 'superpowers',
      displayName: 'Superpowers',
      version: '5.1.0',
      description: 'Workflow skills for planning and review.',
      author: { name: 'Example Author' },
      category: 'productivity',
      supportedComponents: ['skills', 'mcpServers'],
      unsupportedComponents: ['hooks'],
    });
    const picker = new PluginMarketplaceSelectorComponent({
      marketplace: marketplace([entry]),
      installed: new Map(),
      onSelect,
      onCancel: vi.fn(),
    });

    const lines = picker.render(80).map(strip);
    const out = lines.join('\n');
    expect(out).toContain('Example marketplace (1)  (type to search)');
    expect(out).toContain('? Superpowers  install · v5.1.0');
    expect(out).toContain('Details · Superpowers');
    expect(out).toContain(`id superpowers ${MID} author Example Author ${MID} category productivity`);
    expect(out).toContain('Pythinker trust third-party');
    expect(out).toContain('Supported: skills, MCP');
    expect(out).toContain('not run: hooks');
    expect(out).not.toContain('Actions');
    expect(out).not.toContain('Back to installed plugins');
    expect(lines.filter((line) => /^─+$/.test(line))).toHaveLength(2);
    expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true);

    picker.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'superpowers' }),
    });
  });

  it('treats printable i and Space as search and uses two-stage Escape', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const picker = new PluginMarketplaceSelectorComponent({
      marketplace: marketplace([
        marketplaceEntry({ id: 'initial-tools', displayName: 'Initial Tools' }),
        marketplaceEntry({ id: 'review', displayName: 'Review' }),
      ]),
      installed: new Map(),
      onSelect,
      onCancel,
    });

    picker.handleInput(`${ESC}[105u`);
    picker.handleInput(`${ESC}[32u`);
    for (const character of 'tools') picker.handleInput(character);

    const searched = strip(picker.render(80).join('\n'));
    expect(searched).toContain('Search: i tools');
    expect(searched).toContain('? Initial Tools');
    expect(searched).not.toContain('Review');
    expect(onSelect).not.toHaveBeenCalled();

    picker.handleInput(ESC);
    expect(onCancel).not.toHaveBeenCalled();
    expect(strip(picker.render(80).join('\n'))).not.toContain('Search:');
    picker.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('pages a large catalog without rendering every entry', () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      marketplaceEntry({ id: `plugin-${index}`, displayName: `Plugin ${index}` }),
    );
    const picker = new PluginMarketplaceSelectorComponent({
      marketplace: marketplace(entries),
      installed: new Map(),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const firstPage = strip(picker.render(80).join('\n'));
    expect(firstPage).toContain('Plugin 0');
    expect(firstPage).toContain('Plugin 3');
    expect(firstPage).not.toContain('Plugin 4');
    expect(firstPage).toContain('▼ 6 more');

    picker.handleInput(`${ESC}[6~`);
    const secondPage = strip(picker.render(80).join('\n'));
    expect(secondPage).toContain('? Plugin 4');
    expect(secondPage).not.toContain('Plugin 0');
  });

  it('shows installed and update states from full plugin summaries', () => {
    const update = marketplaceEntry({ id: 'update', displayName: 'Update', version: '2.0.0' });
    const current = marketplaceEntry({ id: 'current', displayName: 'Current', version: '1.0.0' });
    const picker = new PluginMarketplaceSelectorComponent({
      marketplace: marketplace([update, current]),
      installed: new Map([
        ['update', pluginSummary('update', '1.0.0')],
        ['current', pluginSummary('current', '1.0.0')],
      ]),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = strip(picker.render(80).join('\n'));
    expect(out).toContain('Update  update 1.0.0 → 2.0.0');
    expect(out).toContain(`Current  installed ${MID} v1.0.0`);
  });

  it('reports unavailable entries without invoking install and locks duplicate submits', () => {
    const unavailableSelect = vi.fn();
    const unavailable = marketplaceEntry({
      id: 'npm-plugin',
      displayName: 'NPM Plugin',
      install: { kind: 'unsupported', reason: 'npm plugin sources are not supported.' },
    });
    const unavailablePicker = new PluginMarketplaceSelectorComponent({
      marketplace: marketplace([unavailable]),
      installed: new Map(),
      onSelect: unavailableSelect,
      onCancel: vi.fn(),
    });

    expect(strip(unavailablePicker.render(80).join('\n'))).toContain('unavailable');
    unavailablePicker.handleInput('\r');
    expect(unavailableSelect).toHaveBeenCalledWith({
      kind: 'unavailable',
      entry: unavailable,
      reason: 'npm plugin sources are not supported.',
    });

    const installSelect = vi.fn();
    const installPicker = new PluginMarketplaceSelectorComponent({
      marketplace: marketplace([marketplaceEntry()]),
      installed: new Map(),
      onSelect: installSelect,
      onCancel: vi.fn(),
    });
    installPicker.handleInput('\r');
    installPicker.handleInput('\r');
    expect(installSelect).toHaveBeenCalledOnce();
  });

  it('keeps status visible and every line within a narrow width', () => {
    const picker = new PluginMarketplaceSelectorComponent({
      marketplace: marketplace([marketplaceEntry({
        displayName: 'A very long marketplace plugin name with Launch 🚀 tools',
      })]),
      installed: new Map(),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const lines = picker.render(40).map(strip);
    expect(lines.join('\n')).toContain('install');
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true);
  });

  it('toggles an installed plugin from the overview with space', () => {
    const onSelect = vi.fn();
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'pythinker-datasource',
          displayName: 'Pythinker Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 1,
          mcpServerCount: 0,
          enabledMcpServerCount: 0,
          hasErrors: false,
          source: 'local-path',
        },
      ],
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput(' ');

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'toggle',
      id: 'pythinker-datasource',
      enabled: false,
    });
  });

  it('uses remapped Select and Plugin actions without consuming unbound keys', () => {
    const onSelect = vi.fn();
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'first', displayName: 'First', enabled: true, state: 'ok', skillCount: 0,
          mcpServerCount: 0, enabledMcpServerCount: 0, hasErrors: false, source: 'local-path',
        },
        {
          id: 'second', displayName: 'Second', enabled: true, state: 'ok', skillCount: 0,
          mcpServerCount: 0, enabledMcpServerCount: 0, hasErrors: false, source: 'local-path',
        },
      ],
      onSelect,
      onCancel: vi.fn(),
    });
    picker.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Select', bindings: { down: null, 'alt+n': 'select:next' } },
        {
          context: 'Plugin',
          bindings: {
            space: null,
            'd x': 'plugin:install',
            'x y': 'plugin:toggle',
            'ctrl+k ctrl+t': 'plugin:toggle',
            'ctrl+x ctrl+y': 'plugin:toggle',
          },
        },
      ]),
    ]);

    picker.handleInput(`${ESC}[B`);
    expect(strip(picker.render(120).join('\n'))).toContain('? First');
    picker.handleInput(' ');
    expect(onSelect).not.toHaveBeenCalled();
    expect(strip(picker.render(120).join('\n'))).toContain('? First');
    picker.handleInput('\u001Bn');
    expect(strip(picker.render(120).join('\n'))).toContain('? Second');
    picker.handleInput('d');
    expect(onSelect).toHaveBeenNthCalledWith(1, { kind: 'remove', id: 'second' });
    picker.handleInput('x');
    picker.handleInput('y');
    picker.handleInput(String.fromCodePoint(0x0b));
    picker.handleInput(String.fromCodePoint(0x14));
    picker.handleInput('ctrl+x');
    picker.handleInput('ctrl+y');

    expect(onSelect).toHaveBeenNthCalledWith(2, { kind: 'toggle', id: 'second', enabled: false });
    expect(onSelect).toHaveBeenNthCalledWith(3, { kind: 'toggle', id: 'second', enabled: false });
    expect(onSelect).toHaveBeenNthCalledWith(4, { kind: 'toggle', id: 'second', enabled: false });
    expect(strip(picker.render(120).join('\n'))).toContain('alt+n navigate');
  });

  it('issues a remove request from the overview on D', () => {
    const onSelect = vi.fn();
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'pythinker-datasource',
          displayName: 'Pythinker Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 1,
          mcpServerCount: 0,
          enabledMcpServerCount: 0,
          hasErrors: false,
          source: 'local-path',
        },
      ],
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput('d');

    expect(onSelect).toHaveBeenCalledWith({ kind: 'remove', id: 'pythinker-datasource' });
  });

  it('opens MCP server management from the overview on M', () => {
    const onSelect = vi.fn();
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'pythinker-datasource',
          displayName: 'Pythinker Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 1,
          mcpServerCount: 1,
          enabledMcpServerCount: 1,
          hasErrors: false,
          source: 'local-path',
        },
      ],
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput('m');

    expect(onSelect).toHaveBeenCalledWith({ kind: 'mcp', id: 'pythinker-datasource' });
  });

  it('toggles MCP servers from the MCP selector', () => {
    const selections: PluginMcpSelection[] = [];
    const picker = new PluginMcpSelectorComponent({
      info: {
        id: 'pythinker-datasource',
        displayName: 'Pythinker Datasource',
        version: '1.0.0',
        enabled: true,
        state: 'ok',
        skillCount: 1,
        mcpServerCount: 1,
        enabledMcpServerCount: 1,
        hasErrors: false,
        source: 'local-path',
        installedAt: '2026-05-29T00:00:00.000Z',
        root: '/plugins/pythinker-datasource',
        manifest: undefined,
        mcpServers: [
          {
            name: 'data',
            runtimeName: 'plugin-pythinker-datasource-data',
            enabled: true,
            transport: 'stdio',
            command: 'node',
            args: ['./bin/pythinker-datasource.mjs'],
            cwd: '/plugins/pythinker-datasource',
          },
        ],
        diagnostics: [],
      },
      onSelect: (selection) => {
        selections.push(selection);
      },
      onCancel: vi.fn(),
    });

    const raw = renderRaw(picker);
    const out = strip(raw);
    expect(out).toContain('MCP servers (1/1 enabled)');
    expect(out).toContain('? data  enabled');
    expect(out).toContain('Enter/Space enable/disable');

    picker.handleInput(' ');

    expect(selections).toEqual([
      { kind: 'toggle', pluginId: 'pythinker-datasource', server: 'data', enabled: false },
    ]);
  });

  it('renders plugin action hints inline on the overview row', () => {
    const picker = new PluginsOverviewSelectorComponent({
      plugins: [
        {
          id: 'pythinker-datasource',
          displayName: 'Pythinker Datasource',
          version: '1.0.0',
          enabled: true,
          state: 'ok',
          skillCount: 1,
          mcpServerCount: 0,
          enabledMcpServerCount: 0,
          hasErrors: false,
          source: 'local-path',
        },
      ],
      selectedId: 'pythinker-datasource',
      pluginHint: { id: 'pythinker-datasource', text: 'pending /new' },
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = picker.render(120).map(strip).join('\n');

    expect(out).toContain('? Pythinker Datasource  enabled  pending /new');
  });

  it('defaults plugin removal confirmation to cancel', () => {
    const results: PluginRemoveConfirmResult[] = [];
    const picker = new PluginRemoveConfirmComponent({
      id: 'pythinker-datasource',
      displayName: 'Pythinker Datasource',
      onDone: (result) => {
        results.push(result);
      },
    });

    const out = picker.render(120).map(strip);
    expect(out).toContain(' Remove Pythinker Datasource (pythinker-datasource)?');
    expect(out).toContain('  ? Cancel');
    expect(out).toContain('    Keep this plugin installed.');
    expect(out).toContain('    Remove only the install record; plugin files are left in place.');

    picker.handleInput('\r');
    expect(results).toEqual([{ kind: 'cancel' }]);
  });

  it('keeps raw Enter and Space unbound in plugin removal confirmation', () => {
    const results: PluginRemoveConfirmResult[] = [];
    const picker = new PluginRemoveConfirmComponent({
      id: 'pythinker-datasource',
      displayName: 'Pythinker Datasource',
      onDone: (result) => {
        results.push(result);
      },
    });
    picker.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Select', bindings: { enter: null, space: null } },
      ]),
    ]);

    const hint = strip(picker.render(120).join('\n')).split('\n')[2] ?? '';
    expect(hint).not.toContain('Enter');
    expect(hint).not.toContain('Space');
    picker.handleInput('\r');
    picker.handleInput(' ');

    expect(results).toEqual([]);
  });

  it('keeps raw Space available to searchable Select queries', () => {
    const onSelect = vi.fn();
    const picker = new ChoicePickerComponent({
      title: 'Search plugins',
      options: [
        { value: 'alpha-beta', label: 'Alpha Beta' },
        { value: 'alphabet', label: 'Alphabet' },
      ],
      searchable: true,
      onSelect,
      onCancel: vi.fn(),
    });
    picker.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Select', bindings: { space: null } },
      ]),
    ]);

    for (const character of 'alpha beta') picker.handleInput(character);

    const rendered = strip(picker.render(120).join('\n'));
    expect(rendered).toContain('Search: alpha beta');
    expect(rendered).toContain('? Alpha Beta');
    expect(rendered).not.toContain('Alphabet');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('confirms plugin removal only after choosing remove', () => {
    const results: PluginRemoveConfirmResult[] = [];
    const picker = new PluginRemoveConfirmComponent({
      id: 'pythinker-datasource',
      displayName: 'Pythinker Datasource',
      onDone: (result) => {
        results.push(result);
      },
    });

    picker.handleInput('[B');
    const raw = renderRaw(picker);
    expect(strip(raw)).toContain('Enter select');
    // The destructive option label keeps its danger styling (error + bold).
    expect(raw).toContain(dangerShortcut('Remove plugin'));

    picker.handleInput('\r');

    expect(results).toEqual([{ kind: 'confirm' }]);
  });
});
