import { For, type Accessor } from 'solid-js';

import { ActivityRow } from './activity-row';
import { Composer } from './composer';
import { truncateToWidth } from './text-layout';
import { formatStatusRow, type FooterViewModel, type FooterViewModelRow } from './footer-model';
import type { ComposerPort } from './open-tui-composer-port';
import { StatusRow } from './status-row';

export interface SplitFooterViewProps {
  readonly composerPort: ComposerPort;
  readonly composerRevision: Accessor<number>;
  readonly viewModel: FooterViewModel;
  readonly width: number;
}

/**
 * Pure non-interactive rows are used for headless tests because the CLI
 * renderer owns terminal streams and lifecycle state. The Solid view consumes
 * the same activity, validation, and status rows while mounting the live
 * composer from its port.
 */
export function renderFooterRows(
  viewModel: FooterViewModel,
  width: number,
): readonly string[] {
  const safeWidth = Math.max(0, Math.trunc(Number.isFinite(width) ? width : 0));
  return Object.freeze(
    viewModel.rows.map((row) => truncateToWidth(renderFooterRow(row), safeWidth)),
  );
}

export function SplitFooterView(props: SplitFooterViewProps) {
  const rows = () => renderFooterRows(props.viewModel, props.width);
  return (
    <box
      flexDirection='column'
      flexShrink={0}
      height={rows().length}
      width={props.width}
      overflow='hidden'
    >
      <For each={props.viewModel.rows}>
        {(row, index) => (
          <FooterRow
            composerPort={props.composerPort}
            composerRevision={props.composerRevision}
            renderedText={rows()[index()] ?? ''}
            row={row}
            width={props.width}
          />
        )}
      </For>
    </box>
  );
}

function FooterRow(props: {
  readonly composerPort: ComposerPort;
  readonly composerRevision: Accessor<number>;
  readonly row: FooterViewModelRow;
  readonly renderedText: string;
  readonly width: number;
}) {
  switch (props.row.kind) {
    case 'activity':
      return <ActivityRow model={props.row} renderedText={props.renderedText} />;
    case 'composer':
      return (
        <Composer
          port={props.composerPort}
          revision={props.composerRevision}
          width={props.width}
        />
      );
    case 'status':
      return <StatusRow model={props.row} renderedText={props.renderedText} />;
    case 'validation':
      return <text height={1}>{props.renderedText}</text>;
  }
}

function renderFooterRow(row: FooterViewModelRow): string {
  switch (row.kind) {
    case 'activity':
      return joinSections(row.primary, row.indicators);
    case 'composer':
      return `${row.slot.marker} [${row.slot.placeholder}]`;
    case 'status':
      return formatStatusRow(row.items);
    case 'validation':
      return row.level === 'info' ? row.message : `${row.level}: ${row.message}`;
  }
}

function joinSections(primary: string, indicators: readonly string[]): string {
  if (primary.length === 0) return indicators.join('  ');
  if (indicators.length === 0) return primary;
  return `${primary}  ${indicators.join('  ')}`;
}
