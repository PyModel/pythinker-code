import type { Accessor } from 'solid-js';

import type {
  ComposerPort,
  ComposerViewState,
} from '#/tui/runtime/footer/open-tui-composer-port';

import { truncateToWidth } from './text-layout';

export interface ComposerProps {
  readonly port: ComposerPort;
  readonly revision: Accessor<number>;
  readonly width: number;
}

export function renderComposerRow(
  view: ComposerViewState,
  width: number,
): string {
  const safeWidth = Math.max(0, Math.trunc(Number.isFinite(width) ? width : 0));
  const content = view.isEmpty ? view.placeholder : view.text;
  return truncateToWidth(`${view.marker} ${content}`, safeWidth);
}

export function Composer(props: ComposerProps) {
  const row = () => {
    props.revision();
    return renderComposerRow(props.port.getViewState(), props.width);
  };
  return <text height={1}>{row()}</text>;
}
