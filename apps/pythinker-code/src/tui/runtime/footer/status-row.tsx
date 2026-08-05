import { currentTheme } from '#/tui/theme';

import type { FooterStatusRowViewModel } from './footer-model';

export interface StatusRowProps {
  readonly model: FooterStatusRowViewModel;
  /** Produced by renderFooterRows, the single source of bounded row layout. */
  readonly renderedText: string;
}

export function StatusRow(props: StatusRowProps) {
  const color =
    props.model.emphasis === 'danger'
      ? currentTheme.palette.error
      : currentTheme.palette.textDim;
  return <text fg={color} height={1}>{props.renderedText}</text>;
}
