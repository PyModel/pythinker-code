import { useState } from 'react';

import type { AgentRecord, WireEntry } from '../../types';
import { CopyButton } from '../shared/CopyButton';
import { JsonViewer } from '../shared/JsonViewer';
import { GenericDetail } from './parts';
import { rendererFor } from './renderers';

interface WireRowDetailProps {
  entry: WireEntry;
  /** Scroll to + expand a given line. */
  onJumpTo?: (lineNo: number) => void;
}

type JsonView = 'none' | 'raw';

export function WireRowDetail({ entry }: WireRowDetailProps) {
  const [view, setView] = useState<JsonView>('none');

  return (
    <div className="pl-[120px] pr-2 py-1 font-mono text-[12px]">
      {renderFriendly(entry.data)}
      <div className="mt-2 flex items-center justify-end gap-3">
        <CopyButton
          value={JSON.stringify(entry.raw, null, 2)}
          label="copy raw"
        />
        <button
          onClick={() => {
            setView((v) => (v === 'raw' ? 'none' : 'raw'));
          }}
          className={`font-mono text-[10px] ${
            view === 'raw' ? 'text-fg-0' : 'text-fg-3 hover:text-fg-1'
          }`}
          title="What this line looks like on disk (no dashboard-side transforms)"
        >
          {view === 'raw' ? '[ hide raw ]' : '[ {…} raw ]'}
        </button>
      </div>
      {view !== 'none' ? (
        <div className="mt-2 border border-border bg-surface-0 p-2">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-fg-3">
            as written on disk
          </div>
          <JsonViewer value={entry.raw} defaultOpenDepth={2} />
        </div>
      ) : null}
    </div>
  );
}

/** Render the expanded detail for a wire record. Thin dispatch to the per-kind
 *  registry's `detail`; kinds without one fall back to a structured JSON dump. */
function renderFriendly(record: AgentRecord) {
  const renderer = rendererFor(record.type);
  if (renderer?.detail !== undefined) return renderer.detail(record);
  return <GenericDetail value={record} />;
}
