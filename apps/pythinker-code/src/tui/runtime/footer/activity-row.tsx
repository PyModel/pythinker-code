import type { FooterActivityRowViewModel } from './footer-model';

export interface ActivityRowProps {
  readonly model: FooterActivityRowViewModel;
  /** Produced by renderFooterRows, the single source of bounded row layout. */
  readonly renderedText: string;
}

export function ActivityRow(props: ActivityRowProps) {
  return <text height={1}>{props.renderedText}</text>;
}
