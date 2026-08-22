import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  type Focusable,
} from '@pymodel/pi-tui';

import { currentTheme } from '#/tui/theme';
import { printableChar } from '#/tui/utils/printable-key';
import { SearchableList } from '#/tui/utils/searchable-list';

export type AuthenticationMethod = 'oauth' | 'api_key';

export interface AuthenticationMethodSelectorOptions {
  readonly onSelect: (method: AuthenticationMethod) => void;
  readonly onCancel: () => void;
}

const AUTHENTICATION_METHODS: readonly {
  readonly value: AuthenticationMethod;
  readonly label: string;
}[] = [
  { value: 'oauth', label: 'Sign in with an account' },
  { value: 'api_key', label: 'Sign in with an API key' },
];

export class AuthenticationMethodSelectorComponent extends Container implements Focusable {
  focused = false;
  private selectedIndex = 0;

  constructor(private readonly opts: AuthenticationMethodSelectorOptions) {
    super();
  }

  handleInput(data: string): void {
    const character = printableChar(data);
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.up) || character === 'k') {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down) || character === 'j') {
      this.selectedIndex = Math.min(AUTHENTICATION_METHODS.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.opts.onSelect(AUTHENTICATION_METHODS[this.selectedIndex]!.value);
    }
  }

  override render(width: number): string[] {
    const lines = [
      currentTheme.fg('border', '─'.repeat(Math.max(1, width))),
      '',
      currentTheme.boldFg('primary', ' Select authentication method:'),
      '',
    ];
    for (let index = 0; index < AUTHENTICATION_METHODS.length; index++) {
      const option = AUTHENTICATION_METHODS[index]!;
      const selected = index === this.selectedIndex;
      lines.push(
        selected
          ? currentTheme.fg('primary', ' → ') + currentTheme.fg('primary', option.label)
          : `   ${currentTheme.fg('text', option.label)}`,
      );
    }
    lines.push(
      '',
      currentTheme.fg('textMuted', ' ↑↓ navigate  Enter select  Esc cancel'),
      '',
      currentTheme.fg('border', '─'.repeat(Math.max(1, width))),
    );
    return lines.map((line) => truncateToWidth(line, width));
  }
}

export interface PlatformSelectorProvider {
  readonly value: string;
  readonly label: string;
  readonly status: 'configured' | 'unconfigured';
  readonly statusSource?: string;
}

export interface PlatformSelectorOptions {
  readonly providers: readonly PlatformSelectorProvider[];
  readonly onSelect: (platformId: string) => void;
  readonly onCancel: () => void;
}

export class PlatformSelectorComponent extends Container implements Focusable {
  focused = false;
  private readonly list: SearchableList<PlatformSelectorProvider>;

  constructor(private readonly opts: PlatformSelectorOptions) {
    super();
    this.list = new SearchableList({
      items: opts.providers.toSorted((left, right) => left.label.localeCompare(right.label)),
      toSearchText: (provider) => `${provider.label} ${provider.value}`,
      searchable: true,
      pageSize: 8,
    });
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const provider = this.list.selected();
      if (provider !== undefined) this.opts.onSelect(provider.value);
      return;
    }
    this.list.handleKey(data);
  }

  override render(width: number): string[] {
    const view = this.list.view();
    const lines = [
      currentTheme.fg('border', '─'.repeat(Math.max(1, width))),
      '',
      currentTheme.boldFg('primary', ' Select provider to configure:'),
      '',
      currentTheme.fg('primary', '> ') + currentTheme.fg('text', view.query),
      '',
    ];

    for (let index = view.page.start; index < view.page.end; index++) {
      const provider = view.items[index]!;
      const selected = index === view.selectedIndex;
      const prefix = selected ? currentTheme.fg('primary', ' → ') : '   ';
      const label = selected
        ? currentTheme.fg('primary', provider.label)
        : currentTheme.fg('text', provider.label);
      lines.push(prefix + label + this.formatStatus(provider));
    }

    if (view.items.length === 0) {
      lines.push(currentTheme.fg('textMuted', '   No matching providers'));
    } else if (view.items.length > 8) {
      lines.push(
        currentTheme.fg('textMuted', `   (${String(view.selectedIndex + 1)}/${String(view.items.length)})`),
      );
    }

    lines.push('', currentTheme.fg('border', '─'.repeat(Math.max(1, width))));
    return lines.map((line) => truncateToWidth(line, width));
  }

  private formatStatus(provider: PlatformSelectorProvider): string {
    if (provider.status === 'unconfigured') {
      return currentTheme.fg('textMuted', ' • unconfigured');
    }
    return currentTheme.fg('success', ` ✓ ${provider.statusSource ?? 'configured'}`);
  }
}
