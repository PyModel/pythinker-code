import { describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';
import type { CapabilityStatus, PluginSummary } from '@pymodel/pythinker-code-sdk';

import {
  PluginInstallTrustConfirmComponent,
  PluginMcpSelectorComponent,
  PluginRemoveConfirmComponent,
  PluginsPanelComponent,
  type PluginInstallTrustConfirmResult,
  type PluginMcpSelection,
  type PluginRemoveConfirmResult,
  type PluginsPanelSelection,
} from '#/tui/components/dialogs/plugins-selector';
import { currentTheme } from '#/tui/theme';
import { darkColors, lightColors } from '#/tui/theme/colors';
import { isOfficialPluginInstall, isOfficialPluginSource, pluginTrustLabel } from '#/tui/utils/plugin-source-label';

const ANSI_SGR = /\u001B\[[0-9;]*m/g;

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

function warningMark(): string {
  // Opening ANSI escape for the warning color; the install-trust notice is the
  // only element in that dialog using it, so its presence confirms the tone.
  return withAnsiColors(() => chalk.hex(darkColors.warning)('\u0001').split('\u0001')[0]!);
}

const superpowers = {
  id: 'superpowers',
  displayName: 'Superpowers',
  version: '5.1.0',
  enabled: true,
  state: 'ok' as const,
  skillCount: 14,
  mcpServerCount: 0,
  enabledMcpServerCount: 0,
  hookCount: 0,
  commandCount: 0,
  hasErrors: false,
  source: 'local-path' as const,
};

const officialEntries = [
  {
    id: 'example-data',
    tier: 'official' as const,
    displayName: 'Example Data',
    description: 'Query supported data sources',
    version: '3.1.1',
    source: 'https://x/d.zip',
    keywords: ['data'],
  },
];
const thirdPartyEntries = [
  { id: 'superpowers', tier: 'curated' as const, displayName: 'Superpowers', source: 'https://x/s.zip' },
];
const marketplaceEntries = [...officialEntries, ...thirdPartyEntries];

function makePanel(opts: {
  installed?: readonly PluginSummary[];
  capabilities?: readonly CapabilityStatus[];
  catalogIsDefault?: boolean;
  initialTab?: 'installed' | 'official' | 'third-party' | 'custom';
  selectedId?: string;
  pluginHint?: { id: string; text: string };
}) {
  const installed = opts.installed ?? [];
  const onSelect = vi.fn<(s: PluginsPanelSelection) => void>();
  const onRequestMarketplace = vi.fn();
  const panel = new PluginsPanelComponent({
    installed,
    installedIds: new Set(installed.map((p) => p.id)),
    capabilities: opts.capabilities,
    catalogIsDefault: opts.catalogIsDefault,
    initialTab: opts.initialTab,
    selectedId: opts.selectedId,
    pluginHint: opts.pluginHint,
    onSelect,
    onCancel: vi.fn(),
    onRequestMarketplace,
  });
  return { panel, onSelect, onRequestMarketplace };
}

function makeCapability(overrides: Partial<CapabilityStatus> = {}): CapabilityStatus {
  return {
    id: 'pythinker-cu',
    displayName: 'Pythinker Computer Use',
    description: 'Background GUI automation',
    supported: true,
    state: 'partial',
    steps: [
      { id: 'plugin', state: 'ok' },
      { id: 'app', state: 'ok' },
      { id: 'service', state: 'ok' },
      { id: 'permissions', state: 'missing', detail: 'screenRecording' },
    ],
    install: { running: false },
    ...overrides,
  };
}

describe('plugins selector dialogs', () => {
  it('treats every plugin install as third-party', () => {
    const installed = {
      ...superpowers,
      source: 'zip-url' as const,
      originalSource:
        'https://plugins.example.com/pythinker-code/plugins/official/example-data.zip',
    };

    expect(pluginTrustLabel(installed)).toBe('third-party');
    expect(isOfficialPluginInstall(installed)).toBe(false);
    expect(isOfficialPluginSource(installed.originalSource)).toBe(false);
    expect(isOfficialPluginSource('https://example.test/plugin.zip')).toBe(false);
    expect(isOfficialPluginSource('./plugins/local')).toBe(false);
  });

  it('opens on the Installed tab with the four panel tabs', () => {
    const { panel } = makePanel({ installed: [superpowers] });
    const out = strip(renderRaw(panel));
    expect(out).toContain('Plugins');
    expect(out).toContain('Installed');
    expect(out).toContain('Official');
    expect(out).toContain('Curated');
    expect(out).toContain('Custom');
    expect(out).toContain('? Superpowers  enabled');
    expect(out).toContain('Space toggle');
    expect(out).toContain('1 installed');
  });

  it('repaints from the current theme palette without remounting', () => {
    const { panel } = makePanel({ installed: [superpowers] });
    const previous = currentTheme.palette;
    try {
      currentTheme.setPalette(darkColors);
      const darkOut = renderRaw(panel);
      currentTheme.setPalette(lightColors);
      const lightOut = renderRaw(panel);
      // A palette snapshot cached at construction would render identically
      // after the switch; reading currentTheme.palette at render time must
      // produce different ANSI output for the same panel instance.
      expect(darkOut).not.toBe(lightOut);
    } finally {
      currentTheme.setPalette(previous);
    }
  });

  it('toggles an installed plugin with Space', () => {
    const { panel, onSelect } = makePanel({ installed: [superpowers] });
    panel.handleInput(' ');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'toggle', id: 'superpowers', enabled: false });
  });

  it('routes D / M / R / Enter to remove / mcp / reload / details on the Installed tab', () => {
    const { panel, onSelect } = makePanel({ installed: [superpowers] });
    panel.handleInput('d');
    panel.handleInput('m');
    panel.handleInput('r');
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'remove', id: 'superpowers' });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'mcp', id: 'superpowers' });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'reload' });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'details', id: 'superpowers' });
  });

  it('Enter on an installed plugin with an available update installs it', () => {
    const installed = [{ ...superpowers, id: 'superpowers', version: '4.0.0' }];
    const entries = [
      {
        id: 'superpowers',
        tier: 'curated' as const,
        displayName: 'Superpowers',
        version: '5.0.0',
        source: 'https://x/s.zip',
      },
    ];
    const { panel, onSelect } = makePanel({ installed });
    panel.setMarketplace(entries, '/tmp/marketplace.json');
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'superpowers' }),
    });
  });

  it('Enter on an up-to-date installed plugin opens details', () => {
    const installed = [{ ...superpowers, id: 'superpowers', version: '5.0.0' }];
    const entries = [
      {
        id: 'superpowers',
        tier: 'curated' as const,
        displayName: 'Superpowers',
        version: '5.0.0',
        source: 'https://x/s.zip',
      },
    ];
    const { panel, onSelect } = makePanel({ installed });
    panel.setMarketplace(entries, '/tmp/marketplace.json');
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'details', id: 'superpowers' });
  });

  it('I on an installed plugin opens details even when an update is available', () => {
    const installed = [{ ...superpowers, id: 'superpowers', version: '4.0.0' }];
    const entries = [
      {
        id: 'superpowers',
        tier: 'curated' as const,
        displayName: 'Superpowers',
        version: '5.0.0',
        source: 'https://x/s.zip',
      },
    ];
    const { panel, onSelect } = makePanel({ installed });
    panel.setMarketplace(entries, '/tmp/marketplace.json');
    panel.handleInput('i');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'details', id: 'superpowers' });
  });

  it('renders the inline plugin hint on the installed row', () => {
    const datasource = { ...superpowers, id: 'example-data', displayName: 'Example Data', skillCount: 1 };
    const { panel } = makePanel({
      installed: [datasource],
      selectedId: 'example-data',
      pluginHint: { id: 'example-data', text: 'pending /new' },
    });
    const out = strip(renderRaw(panel));
    expect(out).toContain('? Example Data  enabled  pending /new');
  });

  it('lazily loads the Official catalog, then lists installed entries first', () => {
    const { panel, onRequestMarketplace } = makePanel({ installed: [superpowers] });
    panel.handleInput('\t'); // → Official
    expect(onRequestMarketplace).toHaveBeenCalledTimes(1);
    expect(strip(renderRaw(panel))).toContain('Loading marketplace');

    panel.setMarketplace(marketplaceEntries, '/tmp/marketplace.json');
    const out = strip(renderRaw(panel));
    expect(out).toContain('Example Data  install');
    expect(out).toContain('Query supported data sources');
    expect(out).not.toContain('Query supported data sources · v3.1.1');
    expect(out).not.toContain('id example-data');
    expect(out).not.toContain('Official plugin');
    expect(out).not.toContain('· data');
    expect(out).toContain('0 installed · 1 available');
  });

  it('does not inject a WebBridge promo while the Official catalog loads', () => {
    const { panel } = makePanel({ initialTab: 'official' });
    const out = strip(renderRaw(panel));
    expect(out).not.toContain('Pythinker WebBridge');
    expect(out).toContain('Loading marketplace');
  });

  it('does not inject a WebBridge promo when the Official catalog errors', () => {
    const { panel } = makePanel({ initialTab: 'official' });
    panel.setMarketplaceError('fetch failed');
    const out = strip(renderRaw(panel));
    expect(out).not.toContain('Pythinker WebBridge');
    expect(out).toContain('Marketplace unavailable: fetch failed');
  });

  it('renders a same-id custom catalog row as a normal plugin, without capability state', () => {
    // A custom marketplace may legitimately list an entry reusing the
    // pythinker-webbridge id: without the capability: marker it must render and
    // install as a plain plugin, not borrow capability status.
    const capabilities = [makeCapability({ id: 'pythinker-webbridge', displayName: 'Pythinker WebBridge' })];
    const entries = [
      {
        id: 'pythinker-webbridge',
        tier: 'official' as const,
        displayName: 'Pythinker WebBridge (fork)',
        source: 'https://x/fork.zip',
      },
    ];
    const { panel, onSelect } = makePanel({ initialTab: 'official', capabilities });
    panel.setMarketplace(entries, '/tmp/marketplace.json');

    const out = strip(renderRaw(panel));
    expect(out).toContain('Pythinker WebBridge (fork)  install');

    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'pythinker-webbridge', source: 'https://x/fork.zip' }),
    });
  });

  it('renders capability rows from the engine while the catalog is still loading', () => {
    const capabilities = [
      makeCapability(),
      makeCapability({
        id: 'pythinker-webbridge',
        displayName: 'Pythinker WebBridge',
        state: 'not_installed',
        steps: [],
      }),
    ];
    const { panel, onSelect } = makePanel({ initialTab: 'official', capabilities });

    // No setMarketplace yet — caller-supplied built-in rows do not wait on
    // the remote catalog.
    const out = strip(renderRaw(panel));
    expect(out).toContain('Pythinker Computer Use  install');
    expect(out).toContain('Pythinker WebBridge  install');
    expect(out).toContain('Background GUI automation');
    expect(out).not.toContain('id pythinker-cu');
    expect(out).not.toContain('Official plugin');
    expect(out).not.toContain('open in browser');
    expect(out).toContain('Loading marketplace');

    panel.handleInput('\r'); // index 0 → pythinker-cu routes to capability install
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'pythinker-cu', source: 'capability:pythinker-cu' }),
    });
    panel.handleInput('[B');
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'pythinker-webbridge', source: 'capability:pythinker-webbridge' }),
    });
  });

  it('keeps built-in rows out while the overridden marketplace is loading', () => {
    // /plugins marketplace <url> or the env override must be able to fully
    // replace the Official tab — fallback capability rows stay out too.
    const capabilities = [makeCapability()];
    const { panel } = makePanel({ initialTab: 'official', capabilities, catalogIsDefault: false });

    const out = strip(renderRaw(panel));
    expect(out).not.toContain('Pythinker Computer Use');
    expect(out).not.toContain('Pythinker WebBridge');
    expect(out).toContain('Loading marketplace');
  });

  it('installs the first catalog official entry directly', () => {
    const { panel, onSelect } = makePanel({ initialTab: 'official' });
    panel.setMarketplace(marketplaceEntries, '/tmp/marketplace.json');
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'example-data' }),
    });
  });

  it('shows only the real WebBridge catalog entry', () => {
    const entries = [
      {
        id: 'pythinker-webbridge',
        tier: 'official' as const,
        displayName: 'Pythinker WebBridge',
        source: 'capability:pythinker-webbridge',
      },
      ...officialEntries,
    ];
    const { panel, onSelect } = makePanel({ initialTab: 'official' });
    panel.setMarketplace(entries, '/tmp/marketplace.json');
    const out = strip(renderRaw(panel));
    expect(out.split('Pythinker WebBridge').length - 1).toBe(1);
    expect(out).not.toContain('open in browser');
    panel.handleInput('\r'); // index 0 → the real entry installs
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'pythinker-webbridge', source: 'capability:pythinker-webbridge' }),
    });
  });

  it('installs a Curated WebBridge catalog entry', () => {
    const entries = [
      {
        id: 'pythinker-webbridge',
        tier: 'curated' as const,
        displayName: 'Pythinker WebBridge',
        source: 'capability:pythinker-webbridge',
      },
    ];
    const { panel, onSelect } = makePanel({ initialTab: 'third-party' });
    panel.setMarketplace(entries, '/tmp/marketplace.json');
    const out = strip(renderRaw(panel));
    expect(out).toContain('Curated');
    expect(out).toContain('Third-party plugins from our partners.');
    expect(out).toContain('Pythinker WebBridge  install');
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'pythinker-webbridge', source: 'capability:pythinker-webbridge' }),
    });
  });

  it('installs the selected Curated entry on Enter', () => {
    const { panel, onSelect } = makePanel({ installed: [superpowers], initialTab: 'third-party' });
    panel.setMarketplace(marketplaceEntries, '/tmp/marketplace.json');
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'superpowers' }),
    });
  });

  it('renders an installing state while an install is in progress', () => {
    const { panel } = makePanel({ installed: [superpowers] });
    panel.setInstalling('Superpowers');
    const out = strip(renderRaw(panel));
    expect(out).toContain('Installing Superpowers…');
  });

  it('keeps a valid selection if ↓ is pressed while the catalog is loading', () => {
    const { panel, onSelect } = makePanel({ initialTab: 'third-party' });
    // Catalog still loading (entries empty); pressing ↓ must not drive the
    // selection negative, or the later Enter would read entries[-1].
    panel.handleInput('\u001B[B'); // ↓
    panel.setMarketplace(marketplaceEntries, '/tmp/marketplace.json');
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install',
      entry: expect.objectContaining({ id: 'superpowers' }),
    });
  });

  it('shows untiered custom marketplace entries without the partner description', () => {
    const untiered = [
      { id: 'custom-plugin', displayName: 'Custom Plugin', source: 'https://x/c.zip' },
    ];
    const { panel } = makePanel({ initialTab: 'third-party', catalogIsDefault: false });
    panel.setMarketplace(untiered, '/tmp/marketplace.json');
    const out = strip(renderRaw(panel));
    expect(out).toContain('Custom Plugin  install');
    expect(out).not.toContain('Third-party plugins from our partners.');
  });

  it('shows an update badge when the marketplace version is newer than installed', () => {
    const installed = [{ ...superpowers, id: 'superpowers', version: '4.0.0' }];
    const entries = [
      {
        id: 'superpowers',
        tier: 'curated' as const,
        displayName: 'Superpowers',
        version: '5.0.0',
        source: 'https://x/s.zip',
      },
    ];
    const { panel } = makePanel({ installed, initialTab: 'third-party' });
    panel.setMarketplace(entries, '/tmp/marketplace.json');
    const out = strip(renderRaw(panel));
    expect(out).toContain('Superpowers  update 4.0.0 → 5.0.0');
  });

  it('shows an update badge on the Installed tab when the marketplace version is newer', () => {
    const installed = [{ ...superpowers, id: 'superpowers', version: '4.0.0' }];
    const entries = [
      {
        id: 'superpowers',
        tier: 'curated' as const,
        displayName: 'Superpowers',
        version: '5.0.0',
        source: 'https://x/s.zip',
      },
    ];
    const { panel } = makePanel({ installed });
    panel.setMarketplace(entries, '/tmp/marketplace.json');
    const out = strip(renderRaw(panel));
    expect(out).toContain('Superpowers  enabled  update 4.0.0 → 5.0.0');
  });

  it('updates the Windows backing plugin through its capability entry', () => {
    const installed = [
      {
        ...superpowers,
        id: 'pythinker-cu-win',
        displayName: 'Pythinker Computer Use for Windows',
        version: '0.2.13',
      },
    ];
    const capability = makeCapability({ pluginId: 'pythinker-cu-win' });
    const entry = {
      id: 'pythinker-cu',
      tier: 'official' as const,
      displayName: 'Pythinker Computer Use',
      version: '0.2.14',
      source: 'capability:pythinker-cu',
      builtIn: true,
    };
    const { panel, onSelect } = makePanel({ installed, capabilities: [capability] });
    panel.setMarketplace([entry], '/tmp/marketplace.json');

    expect(strip(renderRaw(panel))).toContain(
      'Pythinker Computer Use for Windows  enabled  update 0.2.13 → 0.2.14',
    );
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'install', entry });
  });

  it('keeps installation state separate from capability readiness', () => {
    const installed = [
      { ...superpowers, id: 'pythinker-cu', displayName: 'Pythinker Computer Use', version: '0.5.4' },
    ];
    const capabilities = [makeCapability()];
    const entries = [
      {
        id: 'pythinker-cu',
        tier: 'official' as const,
        displayName: 'Pythinker Computer Use',
        version: '0.5.4',
        source: 'capability:pythinker-cu',
        builtIn: true,
      },
    ];
    const { panel } = makePanel({ installed, capabilities });
    panel.setMarketplace(entries, '/tmp/marketplace.json');

    const installedOut = strip(renderRaw(panel));
    expect(installedOut).toContain('Pythinker Computer Use  enabled');
    expect(installedOut).not.toContain('setup incomplete');
    expect(installedOut).not.toContain('needs permissions');

    panel.handleInput('\t');
    const officialOut = strip(renderRaw(panel));
    expect(officialOut).toContain('Pythinker Computer Use  installed · v0.5.4');
    expect(officialOut).toContain('1 installed · 0 available');
    expect(officialOut).not.toContain('needs permissions');
  });

  it('uses the Windows backing plugin id for Official installation state', () => {
    const installed = [
      {
        ...superpowers,
        id: 'pythinker-cu-win',
        displayName: 'Pythinker Computer Use for Windows',
        version: '0.2.14',
      },
    ];
    const capabilities = [makeCapability({ pluginId: 'pythinker-cu-win' })];
    const entries = [
      {
        id: 'pythinker-cu',
        tier: 'official' as const,
        displayName: 'Pythinker Computer Use',
        version: '0.2.14',
        source: 'capability:pythinker-cu',
        builtIn: true,
      },
    ];
    const { panel } = makePanel({ installed, capabilities, initialTab: 'official' });
    panel.setMarketplace(entries, '/tmp/marketplace.json');

    const out = strip(renderRaw(panel));
    expect(out).toContain('Pythinker Computer Use  installed · v0.2.14');
    expect(out).toContain('1 installed · 0 available');
  });

  it('keeps Enter on the Installed tab consistent with other plugins', () => {
    const installed = [
      { ...superpowers, id: 'pythinker-cu', displayName: 'Pythinker Computer Use', version: '0.5.4' },
    ];
    const { panel, onSelect } = makePanel({ installed, capabilities: [makeCapability()] });

    panel.handleInput('\r');

    expect(onSelect).toHaveBeenCalledWith({ kind: 'details', id: 'pythinker-cu' });
  });

  it('keeps unsupported capability diagnostics out of the Installed list', () => {
    const installed = [
      { ...superpowers, id: 'pythinker-cu', displayName: 'Pythinker Computer Use', version: '0.5.4' },
    ];
    const capabilities = [
      makeCapability({ supported: false, state: 'unsupported', steps: [] }),
    ];
    const { panel, onSelect } = makePanel({ installed, capabilities });

    const out = strip(renderRaw(panel));
    expect(out).toContain('Pythinker Computer Use  enabled');
    expect(out).not.toContain('unsupported');

    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ kind: 'details', id: 'pythinker-cu' });
  });

  it('does not expose capability readiness, version, or optional issues in the marketplace', () => {
    const capabilities = [
      makeCapability({
        id: 'pythinker-webbridge',
        displayName: 'Pythinker WebBridge',
        state: 'ready',
        version: 'v1.11.5',
        steps: [
          { id: 'daemon-binary', state: 'ok' },
          { id: 'daemon', state: 'ok' },
          { id: 'skill', state: 'ok' },
          { id: 'extension', state: 'missing', optional: true },
        ],
      }),
    ];
    const installed = [
      { ...superpowers, id: 'pythinker-webbridge', displayName: 'Pythinker WebBridge', version: '1.11.3' },
    ];
    const { panel } = makePanel({ installed, capabilities, initialTab: 'official' });
    panel.setMarketplace(
      [{ id: 'pythinker-webbridge', displayName: 'Pythinker WebBridge', source: 'capability:pythinker-webbridge', tier: 'official', builtIn: true }],
      '/tmp/marketplace.json',
    );

    const out = strip(renderRaw(panel));
    expect(out).toContain('Pythinker WebBridge  installed');
    expect(out).not.toContain('ready');
    expect(out).not.toContain('v1.11.5');
    expect(out).not.toContain('browser extension');
  });

  it('keeps capability repair details out of marketplace rows', () => {
    const capabilities = [
      makeCapability({
        id: 'pythinker-webbridge',
        displayName: 'Pythinker WebBridge',
        state: 'partial',
        steps: [
          { id: 'daemon-binary', state: 'ok' },
          { id: 'daemon', state: 'ok' },
          { id: 'skill', state: 'missing' },
          { id: 'skill-shadow', state: 'failed', optional: true },
        ],
      }),
    ];
    const { panel } = makePanel({ capabilities, initialTab: 'official' });
    panel.setMarketplace(
      [{ id: 'pythinker-webbridge', displayName: 'Pythinker WebBridge', source: 'capability:pythinker-webbridge', tier: 'official', builtIn: true }],
      '/tmp/marketplace.json',
    );

    const out = strip(renderRaw(panel));
    expect(out).toContain('Pythinker WebBridge  install');
    expect(out).not.toContain('agent skill');
    expect(out).not.toContain('skill shadows');
  });

  it('does not show an update badge on the Installed tab before the marketplace loads', () => {
    const installed = [{ ...superpowers, id: 'superpowers', version: '4.0.0' }];
    const { panel } = makePanel({ installed });
    // The marketplace has not been loaded yet, so the badge stays hidden rather
    // than guessing.
    const out = strip(renderRaw(panel));
    expect(out).not.toContain('update');
  });

  it('shows installed · v<version> when the installed plugin is up to date', () => {
    const installed = [{ ...superpowers, id: 'superpowers', version: '5.0.0' }];
    const entries = [
      {
        id: 'superpowers',
        tier: 'curated' as const,
        displayName: 'Superpowers',
        version: '5.0.0',
        source: 'https://x/s.zip',
      },
    ];
    const { panel } = makePanel({ installed, initialTab: 'third-party' });
    panel.setMarketplace(entries, '/tmp/marketplace.json');
    const out = strip(renderRaw(panel));
    expect(out).toContain('Superpowers  installed · v5.0.0');
  });

  it('shows an inline error when the Official catalog fails', () => {
    const { panel } = makePanel({ installed: [superpowers] });
    panel.handleInput('\t'); // → Official
    panel.setMarketplaceError('fetch failed');
    const out = strip(renderRaw(panel));
    expect(out).toContain('Marketplace unavailable: fetch failed');
    expect(out).toContain('Use the Custom tab');
  });

  it('installs from a URL typed on the Custom tab', () => {
    const { panel, onSelect } = makePanel({ initialTab: 'custom' });
    const out = strip(renderRaw(panel));
    expect(out).toContain('Install from a GitHub URL');
    expect(out).toContain('╭');

    for (const ch of 'https://github.com/owner/repo') {
      panel.handleInput(ch);
    }
    panel.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'install-source',
      source: 'https://github.com/owner/repo',
    });
  });

  it('toggles MCP servers from the MCP selector', () => {
    const selections: PluginMcpSelection[] = [];
    const picker = new PluginMcpSelectorComponent({
      info: {
        id: 'example-data',
        displayName: 'Example Data',
        version: '1.0.0',
        enabled: true,
        state: 'ok',
        skillCount: 1,
        mcpServerCount: 1,
        enabledMcpServerCount: 1,
        hookCount: 0,
      commandCount: 0,
        hasErrors: false,
        source: 'local-path',
        installedAt: '2026-05-29T00:00:00.000Z',
        root: '/plugins/example-data',
        manifest: undefined,
        mcpServers: [
          {
            name: 'data',
            runtimeName: 'plugin-example-data-data',
            enabled: true,
            transport: 'stdio',
            command: 'node',
            args: ['./bin/example-data.mjs'],
            cwd: '/plugins/example-data',
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
      { kind: 'toggle', pluginId: 'example-data', server: 'data', enabled: false },
    ]);
  });

  it('defaults plugin removal confirmation to cancel', () => {
    const results: PluginRemoveConfirmResult[] = [];
    const picker = new PluginRemoveConfirmComponent({
      id: 'example-data',
      displayName: 'Example Data',
      onDone: (result) => {
        results.push(result);
      },
    });

    const out = picker.render(120).map(strip);
    expect(out).toContain(' Remove Example Data (example-data)?');
    expect(out).toContain('  ? Cancel');
    expect(out).toContain('    Keep this plugin installed.');
    expect(out).toContain('    Remove only the install record; plugin files are left in place.');

    picker.handleInput('\r');
    expect(results).toEqual([{ kind: 'cancel' }]);
  });

  it('confirms plugin removal only after choosing remove', () => {
    const results: PluginRemoveConfirmResult[] = [];
    const picker = new PluginRemoveConfirmComponent({
      id: 'example-data',
      displayName: 'Example Data',
      onDone: (result) => {
        results.push(result);
      },
    });

    picker.handleInput('\u001B[B');
    const raw = renderRaw(picker);
    expect(strip(raw)).toContain('Enter/Space select');
    // The destructive option label keeps its danger styling (error + bold).
    expect(raw).toContain(dangerShortcut('Remove plugin'));

    picker.handleInput('\r');

    expect(results).toEqual([{ kind: 'confirm' }]);
  });

  it('defaults the third-party install trust prompt to exit', () => {
    const results: PluginInstallTrustConfirmResult[] = [];
    const picker = new PluginInstallTrustConfirmComponent({
      label: 'Superpowers',
      onDone: (result) => {
        results.push(result);
      },
    });

    const raw = renderRaw(picker);
    const out = raw.split('\n').map(strip);
    expect(out).toContain(' Install third-party plugin Superpowers?');
    expect(out).toContain('  ? Exit');
    expect(out).toContain('    Cancel the installation.');
    expect(out).toContain('    Install this third-party plugin anyway.');
    // The warning explains why confirmation is required and uses the
    // design-system warning color rather than muted/default text.
    expect(out.some((line) => line.includes('Pythinker has not reviewed'))).toBe(true);
    expect(out.some((line) => line.includes('trust the source'))).toBe(true);
    expect(raw).toContain(warningMark());

    picker.handleInput('\r');
    expect(results).toEqual([{ kind: 'cancel' }]);
  });

  it('installs a third-party plugin only after switching to trust', () => {
    const results: PluginInstallTrustConfirmResult[] = [];
    const picker = new PluginInstallTrustConfirmComponent({
      label: 'Superpowers',
      onDone: (result) => {
        results.push(result);
      },
    });

    picker.handleInput('\u001B[B');
    const raw = renderRaw(picker);
    expect(strip(raw)).toContain('Enter/Space select');
    // The opt-in option keeps its danger styling (error + bold).
    expect(raw).toContain(dangerShortcut('Trust and install'));

    picker.handleInput('\r');

    expect(results).toEqual([{ kind: 'confirm' }]);
  });
});
