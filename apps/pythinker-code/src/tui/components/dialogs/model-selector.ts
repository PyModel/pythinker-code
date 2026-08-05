import type { ModelAlias } from '@pythoughts/pythinker-code-sdk';
import {
  Container,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui';

import { DEFAULT_OAUTH_PROVIDER_NAME } from '#/constant/app';
import { CURRENT_MARK, SELECT_POINTER } from '#/tui/constant/symbols';
import {
  defaultKeybindings,
  keybindingDisplayText,
  KeybindingResolver,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { currentTheme } from '#/tui/theme';
import { SearchableList } from '#/tui/utils/searchable-list';
import {
  coerceEffortForModel,
  effortLevelsForModel,
  shortEffortLabel,
  thinkingAvailability,
} from '#/tui/utils/thinking-levels';

import {
  combinedBindingHint,
  formatBindingKeys,
  type ChoiceOption,
} from './choice-picker';

interface ModelChoice {
  readonly alias: string;
  readonly model: ModelAlias;
  /** Model display name (left column). */
  readonly name: string;
  /** Provider display name (right column). */
  readonly provider: string;
  /** Combined text the fuzzy filter matches against (name + provider). */
  readonly label: string;
}

export interface ModelSelection {
  readonly alias: string;
  readonly effort: string;
}

export interface NormalizedModelChoices {
  readonly models: Record<string, ModelAlias>;
  readonly aliasMap: Record<string, string>;
  readonly identityAliases: Record<string, string>;
}

export function modelDisplayName(alias: string, model: ModelAlias | undefined): string {
  return model?.displayName ?? model?.model ?? alias;
}

export function providerDisplayName(provider: string): string {
  if (provider === DEFAULT_OAUTH_PROVIDER_NAME) return 'Pythinker';
  if (provider.startsWith('managed:')) return provider.slice('managed:'.length);
  return provider;
}

export function canonicalModelAlias(model: Pick<ModelAlias, 'provider' | 'model'>): string {
  return `${model.provider}/${model.model}`;
}

export function modelIdentity(
  model: Pick<ModelAlias, 'provider' | 'model'> | undefined,
): string | undefined {
  return model === undefined ? undefined : `${model.provider}\u0000${model.model}`;
}

export function normalizeModelChoices(
  models: Record<string, ModelAlias>,
): NormalizedModelChoices {
  const aliasMap: Record<string, string> = {};
  const identityAliases: Record<string, string> = {};
  const sourceAliasesByIdentity = new Map<string, string[]>();
  const representativeByIdentity = new Map<string, { alias: string; model: ModelAlias }>();
  const identityOrder: string[] = [];

  for (const [alias, cfg] of Object.entries(models)) {
    const identity = modelIdentity(cfg);
    if (identity === undefined) continue;
    const sourceAliases = sourceAliasesByIdentity.get(identity);
    if (sourceAliases === undefined) {
      sourceAliasesByIdentity.set(identity, [alias]);
      representativeByIdentity.set(identity, { alias, model: cfg });
      identityOrder.push(identity);
      continue;
    }

    sourceAliases.push(alias);
    const representative = representativeByIdentity.get(identity);
    if (representative !== undefined && alias === canonicalModelAlias(cfg)) {
      representative.alias = alias;
      representative.model = cfg;
    }
  }

  const normalized: Record<string, ModelAlias> = {};
  for (const identity of identityOrder) {
    const representative = representativeByIdentity.get(identity);
    if (representative === undefined) continue;
    normalized[representative.alias] = representative.model;
    identityAliases[identity] = representative.alias;
    for (const sourceAlias of sourceAliasesByIdentity.get(identity) ?? []) {
      aliasMap[sourceAlias] = representative.alias;
    }
    aliasMap[representative.alias] = representative.alias;
  }

  return { models: normalized, aliasMap, identityAliases };
}

export function resolveNormalizedModelAlias(
  normalized: NormalizedModelChoices,
  alias: string,
  fallbackModel?: Pick<ModelAlias, 'provider' | 'model'>,
): string | undefined {
  const mapped = normalized.aliasMap[alias];
  if (mapped !== undefined) return mapped;
  const identity = modelIdentity(fallbackModel);
  return identity === undefined ? undefined : normalized.identityAliases[identity];
}

export function createModelChoiceOptions(
  models: Record<string, ModelAlias>,
): readonly ChoiceOption[] {
  const normalized = normalizeModelChoices(models);
  return Object.entries(normalized.models).map(([alias, cfg]) => ({
    value: alias,
    label: `${modelDisplayName(alias, cfg)} (${providerDisplayName(cfg.provider)})`,
  }));
}

export interface ModelSelectorOptions {
  readonly models: Record<string, ModelAlias>;
  readonly currentValue: string;
  readonly selectedValue?: string;
  readonly currentEffort: string;
  /** When true, typed characters filter the list (fuzzy) and a search line is shown. */
  readonly searchable?: boolean;
  /** Items per page. Lists longer than this paginate (PgUp/PgDn). */
  readonly pageSize?: number;
  /** When true, the hint line mentions the Tab provider switch — set by
   * TabbedModelSelectorComponent so the inner list advertises the tab keys. */
  readonly providerSwitchHint?: boolean;
  readonly onSelect: (selection: ModelSelection) => void;
  readonly onCancel: () => void;
}

function createModelChoices(models: Record<string, ModelAlias>): readonly ModelChoice[] {
  return Object.entries(models).map(([alias, cfg]) => {
    const name = modelDisplayName(alias, cfg);
    const provider = providerDisplayName(cfg.provider);
    return { alias, model: cfg, name, provider, label: `${name} (${provider})` };
  });
}

/**
 * Flat, searchable single-list model picker.
 *
 * One navigation axis: ↑/↓ move the cursor (PgUp/PgDn page), typing fuzzy-filters
 * across every provider (provider name included), and ←/→ move the thinking
 * effort draft within the selected model's supported levels. There are no
 * provider tabs — filtering by typing a provider name replaces them.
 * See .agents/skills/write-tui/DESIGN.md.
 */
export class ModelSelectorComponent extends Container implements Focusable {
  focused = false;
  private readonly opts: ModelSelectorOptions;
  private readonly models: Record<string, ModelAlias>;
  private readonly currentValue: string;
  private readonly list: SearchableList<ModelChoice>;
  /** Per-model effort override set by ←/→; absent → the default draft. */
  private readonly effortOverrides = new Map<string, string>();
  private bindings = defaultKeybindings();
  private keybindings = new KeybindingResolver(this.bindings);

  constructor(opts: ModelSelectorOptions) {
    super();
    this.opts = opts;
    const normalized = normalizeModelChoices(opts.models);
    this.models = normalized.models;
    this.currentValue =
      resolveNormalizedModelAlias(
        normalized,
        opts.currentValue,
        opts.models[opts.currentValue],
      ) ?? opts.currentValue;
    const choices = createModelChoices(this.models);
    const selectedCandidate = opts.selectedValue ?? opts.currentValue;
    const selectedValue =
      resolveNormalizedModelAlias(
        normalized,
        selectedCandidate,
        opts.models[selectedCandidate],
      ) ?? this.currentValue;
    const selectedIdx = choices.findIndex((choice) => choice.alias === selectedValue);
    this.list = new SearchableList({
      items: choices,
      toSearchText: (choice) => choice.label,
      pageSize: opts.pageSize,
      initialIndex: Math.max(selectedIdx, 0),
      searchable: opts.searchable === true,
    });
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.bindings = bindings;
    this.keybindings = new KeybindingResolver(bindings);
  }

  /**
   * Effort draft for a model: an explicit ←/→ override when set, otherwise the
   * live effort level for the active model, otherwise the first non-off level
   * (or 'off' when the model does not support thinking).
   */
  private draftFor(choice: ModelChoice): string {
    const override = this.effortOverrides.get(choice.alias);
    if (override !== undefined) return override;
    if (choice.alias === this.currentValue) {
      return coerceEffortForModel(choice.model, this.opts.currentEffort);
    }
    return effortLevelsForModel(choice.model).find((level) => level !== 'off') ?? 'off';
  }

  handleInput(data: string): boolean {
    const handlers = {
      'select:previous': () => this.list.moveUp(),
      'select:next': () => this.list.moveDown(),
      'select:accept': () => this.selectCurrent(),
      'select:cancel': () => {
        if (!this.list.clearQuery()) this.opts.onCancel();
      },
      'modelPicker:decreaseEffort': () => this.moveEffort(-1),
      'modelPicker:increaseEffort': () => this.moveEffort(1),
    } as const;
    if (
      this.keybindings.dispatch(data, ['Select', 'ModelPicker'], handlers) ||
      this.keybindings.dispatchKeyId(data, ['Select', 'ModelPicker'], handlers)
    ) {
      return true;
    }

    if (matchesKey(data, Key.pageUp)) {
      this.list.pageUp();
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.list.pageDown();
      return true;
    }
    return this.list.handleSearchKey(data);
  }

  override render(width: number): string[] {
    const searchable = this.opts.searchable === true;
    const view = this.list.view();
    const totalCount = Object.keys(this.models).length;

    const titleSuffix =
      searchable && view.query.length === 0
        ? currentTheme.fg('textMuted', '  (type to search)')
        : '';

    // "type to search" already lives in the title suffix, so the hint only
    // surfaces the backspace shortcut once a query is active.
    const hintParts: string[] = [];
    if (this.opts.providerSwitchHint) {
      const providerHint = combinedBindingHint(
        keybindingDisplayText(this.bindings, 'Tabs', 'tabs:next'),
        keybindingDisplayText(this.bindings, 'Tabs', 'tabs:previous'),
        'toggle provider',
      );
      if (providerHint !== undefined) hintParts.push(providerHint);
    }
    const navigationHint = combinedBindingHint(
      keybindingDisplayText(this.bindings, 'Select', 'select:previous'),
      keybindingDisplayText(this.bindings, 'Select', 'select:next'),
      'navigate',
    );
    if (navigationHint !== undefined) hintParts.push(navigationHint);
    if (searchable && view.query.length > 0) hintParts.push('Backspace clear');
    const accept = keybindingDisplayText(this.bindings, 'Select', 'select:accept');
    if (accept !== undefined) hintParts.push(`${formatBindingKeys(accept)} select`);
    const cancel = keybindingDisplayText(this.bindings, 'Select', 'select:cancel');
    if (cancel !== undefined) hintParts.push(`${formatBindingKeys(cancel)} cancel`);

    const lines: string[] = [
      currentTheme.fg('primary', '─'.repeat(width)),
      currentTheme.boldFg('primary', ' Select a model') + titleSuffix,
      currentTheme.fg('textMuted', ' ' + hintParts.join(' · ')),
      '',
    ];

    if (searchable && view.query.length > 0) {
      lines.push(currentTheme.fg('primary', ' Search: ') + currentTheme.fg('text', view.query));
    }

    if (view.items.length === 0) {
      lines.push(currentTheme.fg('textMuted', '   No matches'));
    } else {
      // Column width for model names so the provider column lines up. Capped so
      // the provider + "← current" marker still fit on normal terminal widths.
      const nameCap = Math.max(8, Math.floor(width * 0.5));
      let nameWidth = 0;
      for (let i = view.page.start; i < view.page.end; i++) {
        const choice = view.items[i];
        if (choice !== undefined) nameWidth = Math.max(nameWidth, visibleWidth(choice.name));
      }
      nameWidth = Math.min(nameWidth, nameCap);

      for (let i = view.page.start; i < view.page.end; i++) {
        const choice = view.items[i];
        if (choice === undefined) continue;
        const isSelected = i === view.selectedIndex;
        const isCurrent = choice.alias === this.currentValue;
        const pointer = isSelected ? SELECT_POINTER : ' ';
        const truncatedName = truncateToWidth(choice.name, nameWidth, '…');
        const namePad = ' '.repeat(Math.max(0, nameWidth - visibleWidth(truncatedName)));
        let line = currentTheme.fg(isSelected ? 'primary' : 'textDim', `  ${pointer} `);
        line += (isSelected ? currentTheme.boldFg('primary', truncatedName) : currentTheme.fg('text', truncatedName)) + namePad;
        line += '  ' + currentTheme.fg('textMuted', choice.provider);
        if (isCurrent) {
          line += ' ' + currentTheme.fg('success', CURRENT_MARK);
        }
        lines.push(line);
      }
    }

    // Scroll / match indicator.
    if (view.query.length > 0) {
      lines.push('', currentTheme.fg('textMuted', ` ${String(view.items.length)} / ${String(totalCount)}`));
    } else {
      const below = view.items.length - view.page.end;
      if (below > 0) {
        lines.push('', currentTheme.fg('textMuted', ` ▼ ${String(below)} more`));
      }
    }

    lines.push('');
    const selected = this.selectedChoice();
    if (selected !== undefined) {
      const levels = effortLevelsForModel(selected.model);
      const effortHint = combinedBindingHint(
        keybindingDisplayText(this.bindings, 'ModelPicker', 'modelPicker:decreaseEffort'),
        keybindingDisplayText(this.bindings, 'ModelPicker', 'modelPicker:increaseEffort'),
        'to switch',
      );
      const thinkingHeader =
        levels.length > 1 && effortHint !== undefined
          ? ` Thinking  (${effortHint})`
          : ' Thinking';
      lines.push(currentTheme.fg('textMuted', thinkingHeader), this.renderThinkingControl(selected));
    }
    lines.push('', currentTheme.fg('primary', '─'.repeat(width)));
    return lines.map((line) => truncateToWidth(line, width));
  }

  selectedAlias(): string | undefined {
    return this.selectedChoice()?.alias;
  }

  private selectedChoice(): ModelChoice | undefined {
    return this.list.selected();
  }

  private selectCurrent(): void {
    const selected = this.selectedChoice();
    if (selected === undefined) return;
    this.opts.onSelect({
      alias: selected.alias,
      effort: this.draftFor(selected),
    });
  }

  private moveEffort(delta: -1 | 1): void {
    const selected = this.selectedChoice();
    if (selected === undefined) return;
    const levels = effortLevelsForModel(selected.model);
    const current = levels.indexOf(this.draftFor(selected));
    const next = current + delta;
    if (current >= 0 && next >= 0 && next < levels.length) {
      this.effortOverrides.set(selected.alias, levels[next]!);
    }
  }

  private renderThinkingControl(choice: ModelChoice): string {
    if (thinkingAvailability(choice.model) === 'unsupported') {
      return currentTheme.fg('textMuted', '  Off (Unsupported)');
    }
    const draft = this.draftFor(choice);
    const segments = effortLevelsForModel(choice.model).map((level) => {
      const label = shortEffortLabel(level);
      return level === draft
        ? currentTheme.boldFg('primary', `[ ${label} ]`)
        : currentTheme.fg('text', `  ${label}  `);
    });
    return `  ${segments.join(' ')}`;
  }
}
