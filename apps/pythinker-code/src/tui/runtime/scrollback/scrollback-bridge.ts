/*
 * Joins the transcript lifecycle to terminal scrollback.
 *
 * Static entries go straight out through the presenter, which guarantees one
 * final commit each. Streaming entries accumulate in a retained surface so only
 * whole markdown blocks are committed while the text is still growing; the
 * incomplete tail stays out of scrollback until the entry completes.
 */

import { TranscriptPresenter } from '../transcript-presenter';
import { RetainedSurface, type SurfaceMode } from './retained-surface';
import { StaticWriter, type ScrollbackSink } from './static-writer';

interface StreamingEntry {
  readonly surface: RetainedSurface;
  chunk: number;
}

export interface ScrollbackBridgeOptions {
  readonly sink: ScrollbackSink;
  /** Chunking rules for streamed entries. Defaults to markdown blocks. */
  readonly mode?: SurfaceMode;
}

export class ScrollbackBridge {
  private readonly presenter = new TranscriptPresenter<string>();
  private readonly writer: StaticWriter<string>;
  private readonly mode: SurfaceMode;
  private readonly streaming = new Map<string, StreamingEntry>();

  constructor(options: ScrollbackBridgeOptions) {
    this.writer = new StaticWriter<string>({
      sink: options.sink,
      render: (body) => body,
    });
    this.mode = options.mode ?? 'markdown';
  }

  /** Commits a complete entry, such as a user message, in one write. */
  append(entryId: string, text: string, turnId?: string): void {
    this.writer.writeAll(this.presenter.append(entryId, text, turnId));
  }

  /** Opens a streaming entry. Emits nothing on its own. */
  begin(entryId: string, turnId?: string): void {
    if (this.streaming.has(entryId)) return;
    this.presenter.begin(entryId, '', turnId);
    this.streaming.set(entryId, { surface: new RetainedSurface(this.mode), chunk: 0 });
  }

  /**
   * Feeds the full accumulated text of a streaming entry, committing whichever
   * leading blocks have become stable. A stale or shrinking update writes
   * nothing.
   */
  update(entryId: string, fullText: string): void {
    const entry = this.streaming.get(entryId);
    if (entry === undefined) return;
    this.writeChunks(entryId, entry, entry.surface.accept(fullText));
  }

  /** Flushes a streaming entry's remaining tail and closes it. */
  complete(entryId: string): void {
    const entry = this.streaming.get(entryId);
    if (entry === undefined) return;
    this.writeChunks(entryId, entry, entry.surface.flush());
    this.streaming.delete(entryId);
    this.presenter.complete(entryId, '');
  }

  /** Drops all state, for a session reset that clears the screen. */
  reset(): void {
    this.streaming.clear();
    this.presenter.reset();
    this.writer.reset();
  }

  private writeChunks(entryId: string, entry: StreamingEntry, chunks: readonly string[]): void {
    for (const chunk of chunks) {
      this.writer.write({
        key: `${entryId}:chunk:${entry.chunk}`,
        entryId,
        phase: 'progress',
        body: chunk,
      });
      entry.chunk += 1;
    }
  }
}
