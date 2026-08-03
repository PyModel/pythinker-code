import { For, Show } from 'solid-js';

import { CURRENT_MARK, SELECT_POINTER } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme/theme';
import type { DialogViewModel } from '../../presentation/dialog-list-model';

const SEARCH_SUFFIX = '  (type to search)';
const DIALOG_HINT = '↑↓ navigate · Enter select · Esc cancel';
const CLEAR_SEARCH_HINT = `${DIALOG_HINT} · Backspace clear`;

export interface DialogListViewProps {
  readonly viewModel: DialogViewModel;
  readonly width: number;
}

export function DialogListView(props: DialogListViewProps) {
  const query = () => props.viewModel.query ?? '';
  const border = () => '─'.repeat(Math.max(0, props.width));

  return (
    <box flexDirection='column' width={props.width}>
      <text fg={currentTheme.palette.primary} height={1}>
        {border()}
      </text>
      <text height={1}>
        <b style={{ fg: currentTheme.palette.primary }}>{props.viewModel.title}</b>
        <Show when={query().length === 0}>
          <span style={{ fg: currentTheme.palette.textMuted }}>{SEARCH_SUFFIX}</span>
        </Show>
      </text>
      <text fg={currentTheme.palette.textMuted} height={1}>
        {query().length > 0 ? CLEAR_SEARCH_HINT : DIALOG_HINT}
      </text>
      <text height={1}> </text>
      <Show when={query().length > 0}>
        <text height={1}>
          <span style={{ fg: currentTheme.palette.primary }}>Search: </span>
          <span style={{ fg: currentTheme.palette.text }}>{query()}</span>
        </text>
      </Show>
      <Show
        when={props.viewModel.rows.length > 0}
        fallback={
          <text fg={currentTheme.palette.textMuted} height={1}>
            {props.viewModel.hint ?? ''}
          </text>
        }
      >
        <For each={props.viewModel.rows}>
          {(row, index) => {
            const selected = () => index() === props.viewModel.selectedIndex;
            const disabled = row.disabled === true;
            const rowColor = () =>
              disabled
                ? currentTheme.palette.textDim
                : selected()
                  ? currentTheme.palette.primary
                  : currentTheme.palette.text;
            const prefixColor = () =>
              disabled || !selected()
                ? currentTheme.palette.textDim
                : currentTheme.palette.primary;

            return (
              <text fg={rowColor()} height={1}>
                <span style={{ fg: prefixColor() }}>
                  {selected() ? `${SELECT_POINTER} ` : '  '}
                </span>
                {selected() && !disabled ? (
                  <b style={{ fg: currentTheme.palette.primary }}>{row.label}</b>
                ) : (
                  <span style={{ fg: rowColor() }}>{row.label}</span>
                )}
                {row.current === true ? (
                  <span style={{ fg: currentTheme.palette.success }}>
                    {` ${CURRENT_MARK}`}
                  </span>
                ) : null}
                {disabled ? (
                  <span style={{ fg: currentTheme.palette.textDim }}> (disabled)</span>
                ) : null}
              </text>
            );
          }}
        </For>
      </Show>
      <text fg={currentTheme.palette.primary} height={1}>
        {border()}
      </text>
    </box>
  );
}
