import type { KeyEvent } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import { createSignal } from 'solid-js';

import {
  defaultKeybindings,
  KeybindingResolver,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import {
  DialogListModel,
  type DialogListKeyEvent,
  type DialogListOptions,
  type DialogRow,
} from '#/tui/presentation/dialog-list-model';
import { openTuiKeyId } from '#/tui/runtime/footer/open-tui-composer-port';
import { DialogListView } from './dialog-list-view';

export interface ChoicePickerViewProps {
  readonly options: DialogListOptions;
  readonly width: number;
  readonly bindings?: readonly ParsedKeybinding[];
  readonly context?: 'Select';
  readonly onSelect: (row: DialogRow) => void;
  readonly onCancel: () => void;
}

const SELECT_ACTIONS: ReadonlySet<string> = new Set([
  'select:previous',
  'select:next',
  'select:accept',
  'select:cancel',
]);

function selectBindings(
  bindings: readonly ParsedKeybinding[],
): readonly ParsedKeybinding[] {
  const winners = new Map<string, ParsedKeybinding>();
  for (const binding of bindings) {
    winners.set(`${binding.context}\0${binding.chord.join(' ')}`, binding);
  }
  return [...winners.values()].filter(
    (binding) =>
      (binding.context === 'Select' || binding.context === 'Global') &&
      (binding.action === null || SELECT_ACTIONS.has(binding.action)),
  );
}

function dialogKeyEvent(key: Readonly<KeyEvent>): DialogListKeyEvent | undefined {
  switch (key.name) {
    case 'up':
      return { kind: 'up' };
    case 'down':
      return { kind: 'down' };
    case 'home':
      return { kind: 'home' };
    case 'end':
      return { kind: 'end' };
    case 'pageup':
      return { kind: 'page-up' };
    case 'pagedown':
      return { kind: 'page-down' };
    case 'return':
      return { kind: 'enter' };
    case 'escape':
      return { kind: 'escape' };
    case 'backspace':
      return { kind: 'backspace' };
    default:
      return !key.ctrl && !key.meta && !key.super && key.sequence.length === 1
        ? { kind: 'char', char: key.sequence }
        : undefined;
  }
}

export function ChoicePickerView(props: Readonly<ChoicePickerViewProps>) {
  const model = new DialogListModel(props.options);
  const keybindings = new KeybindingResolver(
    selectBindings(props.bindings ?? defaultKeybindings()),
  );
  const context = props.context ?? 'Select';
  const [viewModel, setViewModel] = createSignal(model.toViewModel());

  const handleEvent = (event: DialogListKeyEvent): void => {
    const result = model.handleKey(event);
    setViewModel(model.toViewModel());

    if (result.type === 'select') props.onSelect(result.row);
    if (result.type === 'cancel') props.onCancel();
  };

  useKeyboard((key: Readonly<KeyEvent>) => {
    const handled = keybindings.dispatchKeyId(
      openTuiKeyId({
        key: key.name,
        ctrl: key.ctrl,
        alt: key.meta,
        shift: key.shift,
        super: key.super,
      }),
      [context],
      {
        'select:previous': () => handleEvent({ kind: 'up' }),
        'select:next': () => handleEvent({ kind: 'down' }),
        'select:accept': () => handleEvent({ kind: 'enter' }),
        'select:cancel': () => handleEvent({ kind: 'escape' }),
      },
    );
    if (handled) {
      key.preventDefault();
      key.stopPropagation();
      return;
    }

    const event = dialogKeyEvent(key);
    if (!event) return;

    key.preventDefault();
    key.stopPropagation();
    handleEvent(event);
  });

  return <DialogListView viewModel={viewModel()} width={props.width} />;
}
