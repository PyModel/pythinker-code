import {
  Container,
  Key,
  matchesKey,
  parseKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui';
import type { PluginInfo, PluginMcpServerInfo, PluginSummary } from '@pymodel/pythinker-code-sdk';

import { SELECT_POINTER } from '#/tui/constant/symbols';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type KeybindingHandlers,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { currentTheme, type ColorToken } from '#/tui/theme';
import {
  formatPluginSourceLabel,
  pluginSourceTrustLabel,
  pluginTrustLabel,
} from '#/tui/utils/plugin-source-label';
import { printableChar } from '#/tui/utils/printable-key';
import { SearchableList } from '#/tui/utils/searchable-list';
import {
  computeMarketplaceEntryStatus,
  type PluginMarketplace,
  type PluginMarketplaceEntry,
} from '#/utils/plugin-marketplace';

import {
  ChoicePickerComponent,
  combinedBindingHint,
  formatBindingKeys,
} from './choice-picker';

const OVERVIEW_MARKETPLACE = 'marketplace';
const OVERVIEW_RELOAD = 'reload';
const OVERVIEW_SHOW_LIST = 'show-list';
const OVERVIEW_PLUGIN_PREFIX = 'plugin:';
const MCP_SERVER_PREFIX = 'mcp:';

const REMOVE_CONFIRM_CANCEL = 'cancel';
const REMOVE_CONFIRM_REMOVE = 'remove';
const ELLIPSIS = '…';

interface PluginsOverviewItem {
  readonly value: string;
  readonly kind: 'plugin' | 'action';
  readonly label: string;
  readonly status?: string;
  readonly description: string;
}

export type PluginsOverviewSelection =
  | { readonly kind: 'marketplace' }
  | { readonly kind: 'reload' }
  | { readonly kind: 'show-list' }
  | { readonly kind: 'toggle'; readonly id: string; readonly enabled: boolean }
  | { readonly kind: 'mcp'; readonly id: string }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'info'; readonly id: string };

export interface PluginsOverviewSelectorOptions {
  readonly plugins: readonly PluginSummary[];
  readonly selectedId?: string;
  readonly pluginHint?: {
    readonly id: string;
    readonly text: string;
  };
  readonly onSelect: (selection: PluginsOverviewSelection) => void;
  readonly onCancel: () => void;
}

export class PluginsOverviewSelectorComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: PluginsOverviewSelectorOptions;
  private readonly items: readonly PluginsOverviewItem[];
  private selectedIndex = 0;
  private bindings = defaultKeybindings();
  private keybindings = new KeybindingResolver([]);

  constructor(opts: PluginsOverviewSelectorOptions) {
    super();
    this.opts = opts;
    this.items = buildOverviewItems(opts.plugins);
    const selectedIndex = this.items.findIndex(
      (item) => item.value === `${OVERVIEW_PLUGIN_PREFIX}${opts.selectedId}`,
    );
    this.selectedIndex = Math.max(0, selectedIndex);
    this.setKeybindings(this.bindings);
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.bindings = bindings;
    const winners = new Map<string, ParsedKeybinding>();
    for (const binding of bindings) {
      winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
    }
    const actions = new Set(['select:previous', 'select:next', 'select:accept', 'select:cancel', 'plugin:toggle']);
    this.keybindings = new KeybindingResolver(
      [...winners.values()].filter(
        (binding) => binding.action !== null && actions.has(binding.action),
      ),
    );
  }

  handleInput(data: string): void {
    const handlers: KeybindingHandlers = {
      'select:previous': () => this.moveUp(),
      'select:next': () => this.moveDown(),
      'select:accept': () => this.accept(),
      'select:cancel': () => this.opts.onCancel(),
      'plugin:toggle': () => this.toggle(),
    };
    const keyId = parseKey(data);
    if (
      keyId?.includes('+') === true
        ? this.keybindings.dispatch(data, ['Plugin', 'Select'], handlers)
        : this.keybindings.dispatchKeyId(keyId ?? data, ['Plugin', 'Select'], handlers)
    ) {
      return;
    }
    const chosen = this.items[this.selectedIndex];
    if (chosen === undefined) return;
    const pluginId = overviewItemPluginId(chosen);
    const decoded = printableChar(data);
    if (decoded === 'd' || decoded === 'D') {
      if (pluginId !== undefined) this.opts.onSelect({ kind: 'remove', id: pluginId });
      return;
    }
    if (decoded === 'm' || decoded === 'M') {
      if (pluginId === undefined) return;
      const plugin = this.opts.plugins.find((item) => item.id === pluginId);
      if (plugin !== undefined && plugin.mcpServerCount > 0) {
        this.opts.onSelect({ kind: 'mcp', id: pluginId });
      }
      return;
    }
  }

  override render(width: number): string[] {
    const { plugins } = this.opts;
    const hint = [
      combinedBindingHint(
        keybindingDisplayText(this.bindings, 'Select', 'select:previous'),
        keybindingDisplayText(this.bindings, 'Select', 'select:next'),
        'navigate',
      ),
      pluginBindingHint(this.bindings, 'plugin:toggle', 'toggle'),
      'M MCP servers',
      'D remove',
      pluginBindingHint(this.bindings, 'select:accept', 'details'),
      pluginBindingHint(this.bindings, 'select:cancel', 'cancel'),
    ].filter((part): part is string => part !== undefined).join(' · ');
    const pluginItems = this.items.filter((item) => item.kind === 'plugin');
    const actionItems = this.items.filter((item) => item.kind === 'action');
    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ' Plugins'),
      mutedHintLine(` ${hint}`),
      '',
      sectionLabel(`Installed plugins (${plugins.length})`),
    ];

    if (pluginItems.length === 0) {
      lines.push(currentTheme.fg('textMuted', '  No plugins installed.'));
    } else {
      let absoluteIndex = 0;
      for (const item of pluginItems) {
        lines.push(...this.renderItem(item, absoluteIndex, width));
        absoluteIndex++;
      }
    }

    lines.push('', sectionLabel('Actions'));
    for (let i = 0; i < actionItems.length; i++) {
      lines.push(...this.renderItem(actionItems[i]!, pluginItems.length + i, width));
    }

    lines.push('', currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  private renderItem(item: PluginsOverviewItem, index: number, width: number): string[] {
    const selected = index === this.selectedIndex;
    const pointer = selected ? SELECT_POINTER : ' ';
    const labelStyle = selected
      ? (text: string) => currentTheme.boldFg('primary', text)
      : (text: string) => currentTheme.fg('text', text);
    const prefix = currentTheme.fg(selected ? 'primary' : 'textDim', `  ${pointer} `);
    let line = prefix + labelStyle(item.label);
    if (item.status !== undefined) {
      line += '  ' + statusStyle(item)(item.status);
    }
    const pluginId = overviewItemPluginId(item);
    if (pluginId !== undefined && this.opts.pluginHint?.id === pluginId) {
      line += '  ' + currentTheme.fg('warning', this.opts.pluginHint.text);
    }

    const descriptionWidth = Math.max(1, width - 4);
    const lines = [line];
    for (const descLine of wrapOverviewDescription(item.description, descriptionWidth)) {
      lines.push(mutedHintLine(`    ${descLine}`));
    }
    return lines;
  }

  private moveUp(): void {
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
  }

  private moveDown(): void {
    this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
  }

  private toggle(): void {
    const chosen = this.items[this.selectedIndex];
    const pluginId = chosen === undefined ? undefined : overviewItemPluginId(chosen);
    if (pluginId === undefined) return;
    const plugin = this.opts.plugins.find((item) => item.id === pluginId);
    if (plugin !== undefined) {
      this.opts.onSelect({ kind: 'toggle', id: pluginId, enabled: !plugin.enabled });
    }
  }

  private accept(): void {
    const chosen = this.items[this.selectedIndex];
    if (chosen === undefined) return;
    const pluginId = overviewItemPluginId(chosen);
    if (pluginId !== undefined) {
      this.opts.onSelect({ kind: 'info', id: pluginId });
      return;
    }
    const selection = parseOverviewSelection(chosen.value);
    if (selection !== undefined) this.opts.onSelect(selection);
  }
}

const MARKETPLACE_PAGE_SIZE = 4;

export type PluginMarketplaceSelection =
  | { readonly kind: 'install'; readonly entry: PluginMarketplaceEntry }
  | {
      readonly kind: 'unavailable';
      readonly entry: PluginMarketplaceEntry;
      readonly reason: string;
    };

export interface PluginMarketplaceSelectorOptions {
  readonly marketplace: PluginMarketplace;
  readonly installed: ReadonlyMap<string, PluginSummary>;
  readonly onSelect: (selection: PluginMarketplaceSelection) => void;
  readonly onCancel: () => void;
}

export class PluginMarketplaceSelectorComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: PluginMarketplaceSelectorOptions;
  private readonly list: SearchableList<PluginMarketplaceEntry>;
  private submitted = false;
  private keybindings = new KeybindingResolver([]);

  constructor(opts: PluginMarketplaceSelectorOptions) {
    super();
    this.opts = opts;
    this.list = new SearchableList({
      items: opts.marketplace.plugins,
      toSearchText: marketplaceSearchText,
      pageSize: MARKETPLACE_PAGE_SIZE,
      searchable: true,
    });
    this.setKeybindings(defaultKeybindings());
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    const actions = new Set([
      'select:previous',
      'select:next',
      'select:accept',
      'select:cancel',
    ]);
    const winners = new Map<string, ParsedKeybinding>();
    for (const binding of bindings) {
      winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
    }
    this.keybindings = new KeybindingResolver(
      [...winners.values()].filter(
        (binding) => binding.action !== null && actions.has(binding.action),
      ),
    );
  }

  handleInput(data: string): void {
    if (this.list.handleSearchKey(data)) return;
    if (matchesKey(data, Key.pageUp)) {
      this.list.pageUp();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.list.pageDown();
      return;
    }

    const handlers: KeybindingHandlers = {
      'select:previous': () => this.list.moveUp(),
      'select:next': () => this.list.moveDown(),
      'select:accept': () => this.activate(),
      'select:cancel': () => this.cancel(),
    };
    const keyId = parseKey(data);
    if (
      keyId?.includes('+') === true
        ? this.keybindings.dispatch(data, ['Select'], handlers)
        : this.keybindings.dispatchKeyId(keyId ?? data, ['Select'], handlers)
    ) return;

    if (matchesKey(data, Key.enter)) this.activate();
    else if (matchesKey(data, Key.escape)) this.cancel();
  }

  override render(width: number): string[] {
    const view = this.list.view();
    const titleSuffix = view.query.length === 0
      ? currentTheme.fg('textMuted', '  (type to search)')
      : '';
    const hint = view.query.length === 0
      ? ' ↑↓ navigate · PgUp/PgDn page · Enter install · Esc cancel'
      : ' ↑↓ navigate · PgUp/PgDn page · Enter install · Backspace clear · Esc cancel';
    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg(
        'primary',
        ` ${this.opts.marketplace.name} (${this.opts.marketplace.plugins.length})`,
      ) + titleSuffix,
      mutedHintLine(hint),
      '',
    ];

    if (view.query.length > 0) {
      lines.push(
        currentTheme.fg('primary', ' Search: ') + currentTheme.fg('text', view.query),
      );
    }
    if (view.items.length === 0) {
      lines.push(currentTheme.fg('textMuted', '   No matches'));
    } else {
      for (let index = view.page.start; index < view.page.end; index++) {
        lines.push(this.renderEntry(view.items[index]!, index === view.selectedIndex, width));
      }
    }

    lines.push('');
    if (view.query.length > 0 && view.items.length > 0) {
      lines.push(mutedHintLine(` ${view.selectedIndex + 1} / ${view.items.length}`));
    } else {
      const remaining = view.items.length - view.page.end;
      if (remaining > 0) lines.push(mutedHintLine(` ▼ ${remaining} more`));
      else if (view.page.start > 0) lines.push(mutedHintLine(` ▲ ${view.page.start} previous`));
    }

    const selected = this.list.selected();
    if (selected !== undefined) {
      lines.push('', ...marketplaceDetailLines(selected, this.opts.marketplace, width));
    }
    lines.push(currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  private renderEntry(entry: PluginMarketplaceEntry, selected: boolean, width: number): string {
    const status = marketplaceStatus(entry, this.opts.installed.get(entry.id));
    const prefix = currentTheme.fg(selected ? 'primary' : 'textDim', `  ${selected ? SELECT_POINTER : ' '} `);
    const statusWidth = visibleWidth(status.text) + 2;
    const nameWidth = Math.max(1, width - visibleWidth(`  ${SELECT_POINTER} `) - statusWidth);
    const name = truncateToWidth(entry.displayName, nameWidth, ELLIPSIS);
    const styledName = selected
      ? currentTheme.boldFg('primary', name)
      : currentTheme.fg('text', name);
    return prefix + styledName + '  ' + currentTheme.fg(status.tone, status.text);
  }

  private cancel(): void {
    if (!this.list.clearQuery()) this.opts.onCancel();
  }

  private activate(): void {
    const entry = this.list.selected();
    if (entry === undefined) return;
    if (entry.install.kind === 'unsupported') {
      this.opts.onSelect({
        kind: 'unavailable',
        entry,
        reason: entry.install.reason,
      });
      return;
    }
    if (this.submitted) return;
    this.submitted = true;
    this.opts.onSelect({ kind: 'install', entry });
  }
}

function pluginBindingHint(
  bindings: readonly ParsedKeybinding[],
  action: 'plugin:toggle' | 'select:accept' | 'select:cancel',
  label: string,
): string | undefined {
  const context = action.startsWith('plugin:') ? 'Plugin' : 'Select';
  const keys = keybindingDisplayText(bindings, context, action);
  return keys === undefined ? undefined : `${formatBindingKeys(keys)} ${label}`;
}

export type PluginMcpSelection =
  | { readonly kind: 'toggle'; readonly pluginId: string; readonly server: string; readonly enabled: boolean }
  | { readonly kind: 'back'; readonly pluginId: string };

export interface PluginMcpSelectorOptions {
  readonly info: PluginInfo;
  readonly selectedServer?: string;
  readonly serverHint?: {
    readonly server: string;
    readonly text: string;
  };
  readonly onSelect: (selection: PluginMcpSelection) => void;
  readonly onCancel: () => void;
}

export class PluginMcpSelectorComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: PluginMcpSelectorOptions;
  private readonly items: readonly PluginsOverviewItem[];
  private selectedIndex = 0;

  constructor(opts: PluginMcpSelectorOptions) {
    super();
    this.opts = opts;
    this.items = buildMcpItems(opts.info);
    const selectedIndex = this.items.findIndex(
      (item) => item.value === `${MCP_SERVER_PREFIX}${opts.selectedServer}`,
    );
    this.selectedIndex = Math.max(0, selectedIndex);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space) || printableChar(data) === ' ') {
      const chosen = this.items[this.selectedIndex];
      if (chosen === undefined) return;
      if (chosen.value === 'back') {
        this.opts.onSelect({ kind: 'back', pluginId: this.opts.info.id });
        return;
      }
      const serverName = mcpItemServerName(chosen);
      if (serverName === undefined) return;
      const server = this.opts.info.mcpServers.find((item) => item.name === serverName);
      if (server === undefined) return;
      this.opts.onSelect({
        kind: 'toggle',
        pluginId: this.opts.info.id,
        server: server.name,
        enabled: !server.enabled,
      });
    }
  }

  override render(width: number): string[] {
    const { info } = this.opts;
    const serverItems = this.items.filter((item) => item.kind === 'plugin');
    const actionItems = this.items.filter((item) => item.kind === 'action');
    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ` MCP servers · ${info.displayName}`),
      mutedHintLine(' ↑↓ navigate · Enter/Space enable/disable · Esc cancel'),
      '',
      sectionLabel(`MCP servers (${info.enabledMcpServerCount}/${info.mcpServerCount} enabled)`),
    ];

    if (serverItems.length === 0) {
      lines.push(currentTheme.fg('textMuted', '  No MCP servers declared.'));
    } else {
      for (let i = 0; i < serverItems.length; i++) {
        lines.push(...this.renderItem(serverItems[i]!, i, width));
      }
    }

    lines.push('', sectionLabel('Actions'));
    for (let i = 0; i < actionItems.length; i++) {
      lines.push(...this.renderItem(actionItems[i]!, serverItems.length + i, width));
    }

    lines.push('', currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width, ELLIPSIS));
  }

  private renderItem(item: PluginsOverviewItem, index: number, width: number): string[] {
    const selected = index === this.selectedIndex;
    const pointer = selected ? SELECT_POINTER : ' ';
    const labelStyle = selected
      ? (text: string) => currentTheme.boldFg('primary', text)
      : (text: string) => currentTheme.fg('text', text);
    const prefix = currentTheme.fg(selected ? 'primary' : 'textDim', `  ${pointer} `);
    let line = prefix + labelStyle(item.label);
    if (item.status !== undefined) {
      line += '  ' + statusStyle(item)(item.status);
    }
    const serverName = mcpItemServerName(item);
    if (serverName !== undefined && this.opts.serverHint?.server === serverName) {
      line += '  ' + currentTheme.fg('warning', this.opts.serverHint.text);
    }
    const descriptionWidth = Math.max(1, width - 4);
    const lines = [line];
    for (const descLine of wrapOverviewDescription(item.description, descriptionWidth)) {
      lines.push(mutedHintLine(`    ${descLine}`));
    }
    return lines;
  }
}

export type PluginRemoveConfirmResult =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'cancel' };

export interface PluginRemoveConfirmOptions {
  readonly id: string;
  readonly displayName: string;
  readonly onDone: (result: PluginRemoveConfirmResult) => void;
}

export class PluginRemoveConfirmComponent extends ChoicePickerComponent {
  constructor(opts: PluginRemoveConfirmOptions) {
    super({
      title: `Remove ${opts.displayName} (${opts.id})?`,
      hint: '↑↓ navigate · Enter/Space select · ←/Esc cancel',
      formatHint: mutedHintLine,
      options: [
        {
          value: REMOVE_CONFIRM_CANCEL,
          label: 'Cancel',
          description: 'Keep this plugin installed.',
        },
        {
          value: REMOVE_CONFIRM_REMOVE,
          label: 'Remove plugin',
          tone: 'danger',
          description: 'Remove only the install record; plugin files are left in place.',
        },
      ],
      onSelect: (value) => {
        opts.onDone(value === REMOVE_CONFIRM_REMOVE ? { kind: 'confirm' } : { kind: 'cancel' });
      },
      onCancel: () => {
        opts.onDone({ kind: 'cancel' });
      },
    });
  }
}

function buildOverviewItems(plugins: readonly PluginSummary[]): PluginsOverviewItem[] {
  const options: PluginsOverviewItem[] = plugins.map((plugin) => ({
    value: `${OVERVIEW_PLUGIN_PREFIX}${plugin.id}`,
    kind: 'plugin',
    label: plugin.displayName,
    status: pluginStatus(plugin),
    description: overviewPluginDescription(plugin),
  }));
  options.push(
    {
      value: OVERVIEW_MARKETPLACE,
      kind: 'action',
      label: 'Marketplace',
      description: 'Browse official plugins.',
    },
    {
      value: OVERVIEW_RELOAD,
      kind: 'action',
      label: 'Reload',
      description: 'Re-read installed plugins and manifests.',
    },
    {
      value: OVERVIEW_SHOW_LIST,
      kind: 'action',
      label: 'Summary',
      description: 'Append the current plugin summary to the transcript.',
    },
  );
  return options;
}

function overviewPluginDescription(plugin: PluginSummary): string {
  const state = plugin.state === 'ok' ? '' : ` · state ${plugin.state}`;
  const skills = `${plugin.skillCount} skill${plugin.skillCount === 1 ? '' : 's'}`;
  const mcp =
    plugin.mcpServerCount > 0
      ? ` · MCP ${plugin.enabledMcpServerCount}/${plugin.mcpServerCount}`
      : '';
  const diagnostics = plugin.hasErrors ? ' · diagnostics available' : '';
  const source = ` · ${formatPluginSourceLabel(plugin)}`;
  const trust = ` · ${pluginTrustLabel(plugin)}`;
  return `id ${plugin.id} · ${skills}${mcp}${source}${trust}${state}${diagnostics}`;
}

function pluginStatus(plugin: PluginSummary): string {
  if (plugin.state !== 'ok') return plugin.state;
  return plugin.enabled ? 'enabled' : 'disabled';
}

function parseOverviewSelection(value: string): PluginsOverviewSelection | undefined {
  if (value === OVERVIEW_MARKETPLACE) return { kind: 'marketplace' };
  if (value === OVERVIEW_RELOAD) return { kind: 'reload' };
  if (value === OVERVIEW_SHOW_LIST) return { kind: 'show-list' };
  return undefined;
}

function overviewItemPluginId(item: PluginsOverviewItem): string | undefined {
  if (!item.value.startsWith(OVERVIEW_PLUGIN_PREFIX)) return undefined;
  return item.value.slice(OVERVIEW_PLUGIN_PREFIX.length);
}

function marketplaceSearchText(entry: PluginMarketplaceEntry): string {
  return [
    entry.displayName,
    entry.id,
    entry.description,
    entry.author?.name,
    entry.marketplaceName,
    entry.marketplaceOwner,
    entry.category,
    ...(entry.keywords ?? []),
    ...(entry.tags ?? []),
    entry.sourceLabel,
    entry.repository,
    entry.homepage,
  ].filter((value): value is string => value !== undefined && value.length > 0).join(' ');
}

function marketplaceStatus(
  entry: PluginMarketplaceEntry,
  installed: PluginSummary | undefined,
): { readonly text: string; readonly tone: ColorToken } {
  if (entry.install.kind === 'unsupported') return { text: 'unavailable', tone: 'error' };
  const status = computeMarketplaceEntryStatus(entry, installed);
  switch (status.kind) {
    case 'update':
      return {
        text: `update ${shortRevision(status.local)} → ${shortRevision(status.latest)}`,
        tone: 'warning',
      };
    case 'up-to-date':
      return {
        text: status.version === undefined ? 'installed' : `installed · v${status.version}`,
        tone: 'success',
      };
    case 'not-installed':
      return {
        text: entry.version === undefined ? 'install' : `install · v${entry.version}`,
        tone: 'primary',
      };
  }
}

function marketplaceDetailLines(
  entry: PluginMarketplaceEntry,
  marketplace: PluginMarketplace,
  width: number,
): string[] {
  const lines = [sectionLabel(`Details · ${entry.displayName}`)];
  if (entry.description !== undefined) {
    for (const line of boundedDescription(entry.description, Math.max(1, width - 2), 2)) {
      lines.push(mutedHintLine(`  ${line}`));
    }
  }

  const identity = [
    `id ${entry.id}`,
    entry.author === undefined ? undefined : `author ${entry.author.name}`,
    entry.category === undefined ? undefined : `category ${entry.category}`,
  ].filter((value): value is string => value !== undefined);
  lines.push(mutedHintLine(` ${identity.join(' · ')}`));

  const revision = [
    `Source: ${entry.sourceLabel}`,
    entry.declaredRef === undefined ? undefined : `ref ${entry.declaredRef}`,
    entry.effectiveSha === undefined ? undefined : `SHA ${shortRevision(entry.effectiveSha)}`,
  ].filter((value): value is string => value !== undefined);
  lines.push(mutedHintLine(` ${revision.join(' · ')}`));

  const links = [entry.homepage, entry.repository]
    .filter((value): value is string => value !== undefined)
    .filter((value, index, values) => values.indexOf(value) === index);
  if (links.length > 0) lines.push(mutedHintLine(` Links: ${links.join(' · ')}`));

  const trustSource = entry.install.kind === 'supported' ? entry.install.source : undefined;
  const catalogOwner = marketplace.owner?.name ?? entry.marketplaceOwner;
  lines.push(mutedHintLine(
    ` Catalog: ${marketplace.name}${catalogOwner === undefined ? '' : ` · ${catalogOwner}`} · Pythinker trust ${pluginSourceTrustLabel(trustSource)}`,
  ));

  const supported = entry.supportedComponents.length === 0
    ? 'discovered during installation'
    : entry.supportedComponents.map(componentLabel).join(', ');
  lines.push(mutedHintLine(` Supported: ${supported}`));

  const compatibility = [
    entry.unsupportedComponents.length === 0
      ? undefined
      : `not run: ${entry.unsupportedComponents.join(', ')}`,
    entry.install.kind === 'unsupported' ? `unavailable: ${entry.install.reason}` : undefined,
  ].filter((value): value is string => value !== undefined);
  if (compatibility.length > 0) {
    const tone: ColorToken = entry.install.kind === 'unsupported' ? 'error' : 'warning';
    lines.push(currentTheme.fg(tone, ` Compatibility: ${compatibility.join(' · ')}`));
  }
  return lines;
}

function boundedDescription(text: string, width: number, maxLines: number): string[] {
  const lines = wrapOverviewDescription(text, width);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  out[maxLines - 1] = truncateToWidth(`${out[maxLines - 1]!}${ELLIPSIS}`, width, ELLIPSIS);
  return out;
}

function componentLabel(component: PluginMarketplaceEntry['supportedComponents'][number]): string {
  switch (component) {
    case 'mcpServers':
      return 'MCP';
    case 'lspServers':
      return 'LSP';
    case 'outputStyles':
      return 'output styles';
    default:
      return component;
  }
}

function shortRevision(value: string): string {
  return /^[0-9a-f]{40}$/i.test(value) ? value.slice(0, 8) : value;
}

function buildMcpItems(info: PluginInfo): PluginsOverviewItem[] {
  const items: PluginsOverviewItem[] = info.mcpServers.map((server) => ({
    value: `${MCP_SERVER_PREFIX}${server.name}`,
    kind: 'plugin',
    label: server.name,
    status: server.enabled ? 'enabled' : 'disabled',
    description: mcpServerDescription(server),
  }));
  items.push({
    value: 'back',
    kind: 'action',
    label: 'Back to installed plugins',
    description: 'Return to the local plugin manager.',
  });
  return items;
}

function mcpServerDescription(server: PluginMcpServerInfo): string {
  const action = server.enabled ? 'Enter/Space disable' : 'Enter/Space enable';
  if (server.transport === 'http' || server.transport === 'sse') {
    return `${action} · ${server.transport.toUpperCase()} · ${server.url ?? server.runtimeName}`;
  }
  const args = server.args !== undefined && server.args.length > 0 ? ` ${server.args.join(' ')}` : '';
  const command = `${server.command ?? ''}${args}`.trim();
  const cwd = server.cwd === undefined ? '' : ` · cwd ${server.cwd}`;
  return `${action} · stdio · ${command || server.runtimeName}${cwd}`;
}

function mcpItemServerName(item: PluginsOverviewItem): string | undefined {
  if (!item.value.startsWith(MCP_SERVER_PREFIX)) return undefined;
  return item.value.slice(MCP_SERVER_PREFIX.length);
}

function sectionLabel(label: string): string {
  return currentTheme.boldFg('textDim', ` ${label}`);
}

function statusStyle(
  item: PluginsOverviewItem,
): (text: string) => string {
  if (item.kind === 'action') return (text) => currentTheme.fg('textDim', text);
  if (item.status?.startsWith('update')) return (text) => currentTheme.fg('warning', text);
  if (item.status === 'enabled' || item.status?.startsWith('installed')) return (text) => currentTheme.fg('success', text);
  if (item.status?.startsWith('install')) return (text) => currentTheme.fg('primary', text);
  if (item.status === 'disabled') return (text) => currentTheme.fg('textDim', text);
  if (item.status !== undefined && /^\d/.test(item.status)) return (text) => currentTheme.fg('textDim', text);
  return (text) => currentTheme.fg('warning', text);
}

function mutedHintLine(text: string): string {
  return currentTheme.fg('textMuted', text);
}

function wrapOverviewDescription(text: string, width: number): string[] {
  const maxWidth = Math.max(1, width);
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (visibleWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = visibleWidth(word) <= maxWidth ? word : truncateToWidth(word, maxWidth, ELLIPSIS);
  }

  if (current.length > 0) lines.push(current);
  return lines;
}
