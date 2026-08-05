import { readFileSync, unwatchFile, watchFile } from 'node:fs';
import { join } from 'node:path';

import { matchesKey, type KeyId } from '@earendil-works/pi-tui';
import { z } from 'zod';

import type { KeyboardShortcut } from './components/dialogs/help-panel';

const KeybindingContextSchema = z.enum([
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

const BuiltinKeybindingActionSchema = z.enum([
  'app:interrupt',
  'app:exit',
  'app:redraw',
  'app:toggleTranscript',
  // Deprecated: no longer bound by default (shift+tab now cycles thinking
  // effort). Kept so existing keybindings.json rebinds of chat:cycleMode
  // don't fail schema validation; consumers treat it as chat:thinkingToggle.
  'chat:cycleMode',
  'chat:cancel',
  'chat:externalEditor',
  'chat:historySearch',
  'chat:messageActions',
  'chat:stash',
  'chat:modelPicker',
  'chat:submit',
  'chat:thinkingToggle',
  'chat:undo',
  'chat:newline',
  'chat:imagePaste',
  'history:search',
  'history:previous',
  'history:next',
  'autocomplete:accept',
  'autocomplete:dismiss',
  'autocomplete:previous',
  'autocomplete:next',
  'confirm:yes',
  'confirm:no',
  'confirm:previous',
  'confirm:next',
  'confirm:nextField',
  'confirm:previousField',
  'confirm:cycleMode',
  'confirm:toggle',
  'confirm:toggleExplanation',
  'permission:toggleDebug',
  'help:dismiss',
  'historySearch:next',
  'historySearch:accept',
  'historySearch:cancel',
  'historySearch:execute',
  'tabs:next',
  'tabs:previous',
  'footer:up',
  'footer:down',
  'footer:next',
  'footer:previous',
  'footer:openSelected',
  'footer:clearSelection',
  'messageSelector:up',
  'messageSelector:down',
  'messageSelector:top',
  'messageSelector:bottom',
  'messageSelector:select',
  'messageActions:prev',
  'messageActions:next',
  'messageActions:prevUser',
  'messageActions:nextUser',
  'messageActions:top',
  'messageActions:bottom',
  'messageActions:escape',
  'messageActions:ctrlc',
  'messageActions:enter',
  'messageActions:c',
  'messageActions:p',
  'modelPicker:decreaseEffort',
  'modelPicker:increaseEffort',
  'select:next',
  'select:previous',
  'select:accept',
  'select:cancel',
  'plugin:toggle',
  'plugin:install',
]);
const KeybindingActionSchema = z.union([
  BuiltinKeybindingActionSchema,
  z.custom<`command:${string}`>((value) =>
    typeof value === 'string' && value.startsWith('command:'),
  ),
]);

export type KeybindingContext = z.infer<typeof KeybindingContextSchema>;
export type KeybindingAction = z.infer<typeof KeybindingActionSchema>;

export interface KeybindingBlock {
  readonly context: KeybindingContext;
  readonly bindings: Readonly<Record<string, KeybindingAction | null>>;
}

export interface ParsedKeybinding {
  readonly context: KeybindingContext;
  readonly chord: readonly string[];
  readonly action: KeybindingAction | null;
}

export interface LoadedKeybindings {
  readonly bindings: readonly ParsedKeybinding[];
  readonly warnings: readonly string[];
  readonly valid: boolean;
}

const KeybindingsFileSchema = z.object({
  bindings: z.array(
    z.object({
      context: z.string().min(1),
      bindings: z.record(z.string(), KeybindingActionSchema.nullable()),
    }),
  ),
});

const DEFAULT_KEYBINDING_BLOCKS: readonly KeybindingBlock[] = [
  {
    context: 'Global',
    bindings: {
      'ctrl+c': 'app:interrupt',
      'ctrl+d': 'app:exit',
      'ctrl+l': 'app:redraw',
    },
  },
  {
    context: 'Chat',
    bindings: {
      'shift+tab': 'chat:thinkingToggle',
      'ctrl+g': 'chat:externalEditor',
      'ctrl+r': 'history:search',
      'shift+up': 'chat:messageActions',
      'ctrl+o': 'app:toggleTranscript',
      'ctrl+s': 'chat:stash',
      'ctrl+t': 'chat:thinkingToggle',
      'alt+p': 'chat:modelPicker',
      'ctrl+-': 'chat:undo',
      'shift+enter': 'chat:newline',
      'ctrl+j': 'chat:newline',
      [process.platform === 'win32' ? 'alt+v' : 'ctrl+v']: 'chat:imagePaste',
    },
  },
  {
    context: 'Autocomplete',
    bindings: {
      tab: 'autocomplete:accept',
      escape: 'autocomplete:dismiss',
      up: 'autocomplete:previous',
      down: 'autocomplete:next',
    },
  },
  {
    context: 'Confirmation',
    bindings: {
      y: 'confirm:yes',
      n: 'confirm:no',
      enter: 'confirm:yes',
      escape: 'confirm:no',
      up: 'confirm:previous',
      down: 'confirm:next',
      tab: 'confirm:nextField',
      'shift+tab': 'confirm:previousField',
      space: 'confirm:toggle',
      'ctrl+e': 'confirm:toggleExplanation',
      'ctrl+d': 'permission:toggleDebug',
    },
  },
  { context: 'Help', bindings: { escape: 'help:dismiss' } },
  {
    context: 'HistorySearch',
    bindings: {
      'ctrl+r': 'historySearch:next',
      escape: 'historySearch:accept',
      tab: 'historySearch:accept',
      'ctrl+c': 'historySearch:cancel',
      enter: 'historySearch:execute',
    },
  },
  {
    context: 'Tabs',
    bindings: {
      tab: 'tabs:next',
      'shift+tab': 'tabs:previous',
      right: 'tabs:next',
      left: 'tabs:previous',
    },
  },
  {
    context: 'Footer',
    bindings: {
      up: 'footer:up',
      'ctrl+p': 'footer:up',
      down: 'footer:down',
      'ctrl+n': 'footer:down',
      right: 'footer:next',
      left: 'footer:previous',
      enter: 'footer:openSelected',
      escape: 'footer:clearSelection',
    },
  },
  {
    context: 'MessageSelector',
    bindings: {
      up: 'messageSelector:up',
      down: 'messageSelector:down',
      k: 'messageSelector:up',
      j: 'messageSelector:down',
      'ctrl+p': 'messageSelector:up',
      'ctrl+n': 'messageSelector:down',
      'ctrl+up': 'messageSelector:top',
      'shift+up': 'messageSelector:top',
      'meta+up': 'messageSelector:top',
      'shift+k': 'messageSelector:top',
      'ctrl+down': 'messageSelector:bottom',
      'shift+down': 'messageSelector:bottom',
      'meta+down': 'messageSelector:bottom',
      'shift+j': 'messageSelector:bottom',
      enter: 'messageSelector:select',
    },
  },
  {
    context: 'MessageActions',
    bindings: {
      up: 'messageActions:prev',
      down: 'messageActions:next',
      k: 'messageActions:prev',
      j: 'messageActions:next',
      'meta+up': 'messageActions:top',
      'super+up': 'messageActions:top',
      'meta+down': 'messageActions:bottom',
      'super+down': 'messageActions:bottom',
      'shift+up': 'messageActions:prevUser',
      'shift+down': 'messageActions:nextUser',
      escape: 'messageActions:escape',
      'ctrl+c': 'messageActions:ctrlc',
      enter: 'messageActions:enter',
      c: 'messageActions:c',
      p: 'messageActions:p',
    },
  },
  {
    context: 'ModelPicker',
    bindings: {
      left: 'modelPicker:decreaseEffort',
      right: 'modelPicker:increaseEffort',
    },
  },
  {
    context: 'Select',
    bindings: {
      up: 'select:previous',
      down: 'select:next',
      k: 'select:previous',
      j: 'select:next',
      'ctrl+p': 'select:previous',
      'ctrl+n': 'select:next',
      enter: 'select:accept',
      escape: 'select:cancel',
    },
  },
  { context: 'Plugin', bindings: { space: 'plugin:toggle', i: 'plugin:install' } },
];

const RESERVED_KEYS = new Set(['ctrl+c', 'ctrl+d', 'ctrl+m']);
const INTERCEPTED_KEYS: Readonly<Record<string, string>> = {
  'ctrl+z': 'Unix process suspend (SIGTSTP)',
  'ctrl+\\': 'Terminal quit signal (SIGQUIT)',
  ...(process.platform === 'darwin'
    ? {
        'super+c': 'macOS system copy',
        'super+v': 'macOS system paste',
        'super+x': 'macOS system cut',
        'super+q': 'macOS quit application',
        'super+w': 'macOS close window or tab',
        'super+tab': 'macOS app switcher',
        'super+space': 'macOS Spotlight',
      }
    : {}),
};
const ACTIVE_CONTEXTS = new Set<KeybindingContext>(KeybindingContextSchema.options);
const CHORD_TIMEOUT_MS = 1_000;

export function defaultKeybindings(): readonly ParsedKeybinding[] {
  return parseKeybindingBlocks(DEFAULT_KEYBINDING_BLOCKS);
}

export function generateKeybindingsTemplate(): string {
  const bindings = DEFAULT_KEYBINDING_BLOCKS.map((block) => ({
    context: block.context,
    bindings: Object.fromEntries(
      Object.entries(block.bindings).filter(([shortcut]) =>
        !RESERVED_KEYS.has(normalizeShortcut(shortcut)),
      ),
    ),
  })).filter((block) => Object.keys(block.bindings).length > 0);
  return `${JSON.stringify({ bindings }, null, 2)}\n`;
}

export function parseKeybindingBlocks(
  blocks: readonly KeybindingBlock[],
): readonly ParsedKeybinding[] {
  return blocks.flatMap((block) =>
    Object.entries(block.bindings).map(([shortcut, action]) => ({
      context: block.context,
      chord: parseChord(shortcut),
      action,
    })),
  );
}

export function loadKeybindings(homeDir: string): LoadedKeybindings {
  const defaults = defaultKeybindings();
  let raw: unknown;
  let content: string;
  try {
    content = readFileSync(join(homeDir, 'keybindings.json'), 'utf8');
    raw = JSON.parse(content);
  } catch (error) {
    return isFileNotFound(error)
      ? { bindings: defaults, warnings: [], valid: true }
      : { bindings: defaults, warnings: ['Failed to parse keybindings.json.'], valid: false };
  }

  const parsed = KeybindingsFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      bindings: defaults,
      warnings: ['keybindings.json must contain valid binding blocks.'],
      valid: false,
    };
  }

  const warnings = duplicateBindingWarnings(content);
  const userBlocks: KeybindingBlock[] = [];
  const seenBindings = new Map<string, KeybindingAction | null>();
  for (const block of parsed.data.bindings) {
    if (!isKeybindingContext(block.context)) {
      warnings.push(
        `Unknown keybinding context: ${block.context}. Supported contexts: ${KeybindingContextSchema.options.join(', ')}.`,
      );
      continue;
    }
    const bindings: Record<string, KeybindingAction | null> = {};
    for (const [shortcut, action] of Object.entries(block.bindings)) {
      const normalized = normalizeShortcut(shortcut);
      const bindingId = `${block.context}\0${normalized}`;
      if (seenBindings.has(bindingId) && seenBindings.get(bindingId) !== action) {
        warnings.push(
          `Duplicate binding "${shortcut}" in ${block.context} bindings; the last value wins.`,
        );
      }
      seenBindings.set(bindingId, action);
      if (!isValidChord(shortcut)) {
        warnings.push(`Invalid keybinding: ${shortcut}`);
      } else if (RESERVED_KEYS.has(normalized)) {
        warnings.push(`${shortcut} is reserved and cannot be rebound.`);
      } else {
        const reason = INTERCEPTED_KEYS[normalized];
        if (reason !== undefined) {
          warnings.push(`${shortcut} may be intercepted by the terminal: ${reason}.`);
        }
        bindings[shortcut] = action;
      }
    }
    userBlocks.push({ context: block.context, bindings });
  }

  return {
    bindings: [...defaults, ...parseKeybindingBlocks(userBlocks)],
    warnings,
    valid: true,
  };
}

export function watchKeybindings(homeDir: string, onChange: () => void): () => void {
  const path = join(homeDir, 'keybindings.json');
  watchFile(path, { persistent: false }, onChange);
  return () => unwatchFile(path, onChange);
}

export function keybindingDisplayText(
  bindings: readonly ParsedKeybinding[],
  context: KeybindingContext,
  action: KeybindingAction,
): string | undefined {
  const shortcuts = effectiveBindings(bindings)
    .filter((binding) => binding.context === context && binding.action === action)
    .map((binding) => binding.chord.join(' '));
  return shortcuts.length === 0 ? undefined : shortcuts.join(' / ');
}

export type KeybindingHandler = () => void | false;
export type KeybindingHandlers = Readonly<Partial<Record<KeybindingAction, KeybindingHandler>>>;

export interface KeybindingDispatchOptions {
  readonly now?: number;
  readonly onCommand?: (command: string) => void;
}

export class KeybindingResolver {
  private readonly bindings: readonly ParsedKeybinding[];
  private pending:
    | {
        readonly candidates: readonly ResolvedKeybinding[];
        readonly index: number;
        readonly expiresAt: number;
      }
    | undefined;
  private contextKey: string | undefined;

  constructor(bindings: readonly ParsedKeybinding[]) {
    this.bindings = effectiveBindings(bindings).filter((binding) => ACTIVE_CONTEXTS.has(binding.context));
  }

  dispatch(
    data: string,
    contexts: readonly KeybindingContext[],
    handlers: KeybindingHandlers,
    options?: KeybindingDispatchOptions,
  ): boolean {
    return this.dispatchWithMatcher(
      contexts,
      handlers,
      options,
      (key) => matchesConfiguredKey(data, key),
    );
  }

  dispatchKeyId(
    keyId: string,
    contexts: readonly KeybindingContext[],
    handlers: KeybindingHandlers,
    options?: KeybindingDispatchOptions,
  ): boolean {
    const normalized = normalizeStep(keyId);
    return this.dispatchWithMatcher(contexts, handlers, options, (key) => key === normalized);
  }

  private dispatchWithMatcher(
    contexts: readonly KeybindingContext[],
    handlers: KeybindingHandlers,
    options: KeybindingDispatchOptions | undefined,
    matches: (key: string) => boolean,
  ): boolean {
    const now = options?.now ?? Date.now();
    const candidates = this.candidatesFor(contexts);
    const contextKey = candidates.contextKey;
    if (this.contextKey !== contextKey) {
      this.contextKey = contextKey;
      this.pending = undefined;
    }
    if (this.pending !== undefined && now > this.pending.expiresAt) {
      this.pending = undefined;
    }
    if (this.pending !== undefined) {
      const nextIndex = this.pending.index + 1;
      const nextCandidates = this.pending.candidates.filter((binding) =>
        matches(binding.chord[nextIndex] ?? ''),
      );
      this.pending = undefined;
      if (nextCandidates.length > 0) {
        return this.finishMatch(nextCandidates, nextIndex, now, handlers, options);
      }
      // The pending chord is broken: fall through so this key can start a
      // fresh match on its own.
    }

    const matchesAtStart = candidates.bindings.filter((binding) => matches(binding.chord[0] ?? ''));
    return matchesAtStart.length === 0
      ? false
      : this.finishMatch(matchesAtStart, 0, now, handlers, options);
  }

  private candidatesFor(contexts: readonly KeybindingContext[]): {
    readonly bindings: readonly ResolvedKeybinding[];
    readonly contextKey: string;
  } {
    const orderedContexts = [...contexts.filter((context) => context !== 'Global'), 'Global'];
    return {
      contextKey: orderedContexts.join('\0'),
      bindings: this.bindings.flatMap((binding) => {
        const rank = orderedContexts.indexOf(binding.context);
        return rank === -1 ? [] : [{ ...binding, rank }];
      }),
    };
  }

  private finishMatch(
    candidates: readonly ResolvedKeybinding[],
    index: number,
    now: number,
    handlers: KeybindingHandlers,
    options: KeybindingDispatchOptions | undefined,
  ): boolean {
    const bestRank = Math.min(...candidates.map((binding) => binding.rank));
    const bestCandidates = candidates.filter((binding) => binding.rank === bestRank);
    const longer = bestCandidates.filter((binding) => binding.chord.length > index + 1);
    if (longer.length > 0) {
      this.pending = { candidates: longer, index, expiresAt: now + CHORD_TIMEOUT_MS };
      return true;
    }
    const match = bestCandidates.findLast((binding) => binding.chord.length === index + 1);
    if (match === undefined || match.action === null) return true;
    if (match.action.startsWith('command:')) {
      if (options?.onCommand === undefined) return false;
      options.onCommand(match.action.slice('command:'.length));
      return true;
    }
    return handlers[match.action]?.() !== false && handlers[match.action] !== undefined;
  }
}

type ResolvedKeybinding = ParsedKeybinding & { readonly rank: number };

export interface KeybindingAware {
  setKeybindings(bindings: readonly ParsedKeybinding[]): void;
}

export function isKeybindingAware(value: unknown): value is KeybindingAware {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'setKeybindings' in value &&
    typeof value.setKeybindings === 'function'
  );
}

const HELP_ACTIONS: ReadonlyArray<{
  readonly action: KeybindingAction;
  readonly description: string;
}> = [
  { action: 'chat:modelPicker', description: 'Choose model' },
  { action: 'chat:externalEditor', description: 'Edit in external editor ($VISUAL / $EDITOR)' },
  { action: 'history:search', description: 'Search input history' },
  { action: 'chat:messageActions', description: 'Select transcript messages' },
  { action: 'app:redraw', description: 'Redraw terminal UI' },
  { action: 'app:toggleTranscript', description: 'Toggle tool output expansion' },
  { action: 'chat:thinkingToggle', description: 'Cycle thinking effort for the current model' },
  { action: 'chat:stash', description: 'Steer — inject a follow-up during streaming' },
  { action: 'chat:newline', description: 'Insert newline' },
  { action: 'app:interrupt', description: 'Interrupt stream / clear input' },
  { action: 'app:exit', description: 'Exit (on empty input)' },
];

export function editorShortcutHelp(
  bindings: readonly ParsedKeybinding[],
): readonly KeyboardShortcut[] {
  const configured = HELP_ACTIONS.flatMap(({ action, description }) => {
    const shortcuts = effectiveBindings(bindings)
      .filter((binding) => binding.action === action)
      .map((binding) => binding.chord.join(' '));
    return shortcuts.length === 0 ? [] : [{ keys: shortcuts.join(' / '), description }];
  });
  return [
    ...configured,
    { keys: 'escape', description: 'Close dialogs / interrupt streaming' },
    { keys: 'up / down', description: 'Browse input history' },
    { keys: 'enter', description: 'Submit' },
  ];
}

function effectiveBindings(bindings: readonly ParsedKeybinding[]): readonly ParsedKeybinding[] {
  const winners = new Map<string, ParsedKeybinding>();
  for (const binding of bindings) {
    winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
  }
  return [...winners.values()];
}

function parseChord(shortcut: string): readonly string[] {
  return shortcut === ' ' ? ['space'] : shortcut.trim().split(/\s+/u).map(normalizeStep);
}

function isValidChord(shortcut: string): boolean {
  if (shortcut === ' ') return true;
  const chord = shortcut.trim().split(/\s+/u);
  return chord.length > 0 && chord.every((step) => {
    const parts = step.split('+');
    return parts.length > 0 && parts.every((part) => part.trim().length > 0);
  });
}

function normalizeShortcut(shortcut: string): string {
  return parseChord(shortcut).join(' ');
}

function normalizeStep(step: string): string {
  const aliases: Readonly<Record<string, string>> = {
    control: 'ctrl',
    option: 'alt',
    opt: 'alt',
    command: 'super',
    cmd: 'super',
    win: 'super',
    return: 'enter',
    esc: 'escape',
  };
  return step
    .split('+')
    .map((part) => aliases[part.trim().toLowerCase()] ?? part.trim().toLowerCase())
    .join('+');
}

function isKeybindingContext(context: string): context is KeybindingContext {
  return ACTIVE_CONTEXTS.has(context as KeybindingContext);
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function duplicateBindingWarnings(content: string): string[] {
  const warnings: string[] = [];
  for (const block of content.matchAll(/"bindings"\s*:\s*\{([^{}]*)\}/gu)) {
    const before = content.slice(0, block.index);
    const context = /"context"\s*:\s*"([^"]+)"[^{]*$/u.exec(before)?.[1] ?? 'unknown';
    const seen = new Set<string>();
    for (const key of (block[1] ?? '').matchAll(/"([^"]+)"\s*:/gu)) {
      const name = key[1];
      if (name === undefined) continue;
      if (seen.has(name)) {
        warnings.push(`Duplicate key "${name}" in ${context} bindings; the last value wins.`);
      }
      seen.add(name);
    }
  }
  return warnings;
}

function matchesConfiguredKey(data: string, key: string): boolean {
  return matchesKey(data, key as KeyId);
}
