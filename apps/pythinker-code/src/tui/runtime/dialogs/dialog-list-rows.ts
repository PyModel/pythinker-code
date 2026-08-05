import { CURRENT_MARK, SELECT_POINTER } from '#/tui/constant/symbols';
import type { DialogViewModel } from '#/tui/presentation/dialog-list-model';
import { currentTheme } from '#/tui/theme/theme';
import { truncateToWidth } from '../footer/text-layout';

const SEARCH_SUFFIX = '  (type to search)';
const DIALOG_HINT = '↑↓ navigate · Enter select · Esc cancel';
const CLEAR_SEARCH_HINT = `${DIALOG_HINT} · Backspace clear`;

export function renderDialogListRows(viewModel: DialogViewModel, width: number): readonly string[] {
  const query = viewModel.query ?? '';
  const border = currentTheme.fg('primary', '─'.repeat(Math.max(0, width)));
  const titleText =
    query.length > 0
      ? currentTheme.boldFg('primary', viewModel.title)
      : `${currentTheme.boldFg('primary', viewModel.title)}${currentTheme.fg('textMuted', SEARCH_SUFFIX)}`;
  const lines: string[] = [
    truncateToWidth(border, width),
    truncateToWidth(titleText, width),
    truncateToWidth(
      currentTheme.fg('textMuted', query.length > 0 ? CLEAR_SEARCH_HINT : DIALOG_HINT),
      width,
    ),
    '',
  ];

  if (query.length > 0) {
    lines.push(
      truncateToWidth(
        `${currentTheme.fg('primary', 'Search: ')}${currentTheme.fg('text', query)}`,
        width,
      ),
    );
  }

  if (viewModel.rows.length === 0) {
    lines.push(
      truncateToWidth(currentTheme.fg('textMuted', viewModel.hint ?? ''), width),
     truncateToWidth(border, width));
    return lines;
  }

  for (const [index, row] of viewModel.rows.entries()) {
    const selected = index === viewModel.selectedIndex;
    const disabled = row.disabled === true;
    const prefix = currentTheme.fg(
      disabled ? 'textDim' : selected ? 'primary' : 'textDim',
      selected ? `${SELECT_POINTER} ` : '  ',
    );
    const label = disabled
      ? currentTheme.fg('textDim', row.label)
      : selected
        ? currentTheme.boldFg('primary', row.label)
        : currentTheme.fg('text', row.label);
    const currentMark =
      row.current === true ? currentTheme.fg('success', ` ${CURRENT_MARK}`) : '';
    const disabledMark =
      disabled ? currentTheme.fg('textDim', ' (disabled)') : '';
    lines.push(
      truncateToWidth(`${prefix}${label}${currentMark}${disabledMark}`, width),
    );
  }

  lines.push(truncateToWidth(border, width));
  return lines;
}
