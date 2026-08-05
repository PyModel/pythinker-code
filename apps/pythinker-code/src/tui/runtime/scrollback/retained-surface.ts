/*
 * Splits accumulated streamed text into immutable chunks and a retained tail.
 */

export type SurfaceMode = 'plain' | 'markdown';

/**
 * Tracks monotonically growing text and exposes only complete, stable chunks.
 */
export class RetainedSurface {
  private readonly mode: SurfaceMode;
  private committed = '';
  private pending = '';

  /**
   * Creates a retained surface using line or Markdown block chunking.
   *
   * @param mode - The rules used to identify stable chunks.
   */
  constructor(mode: SurfaceMode) {
    this.mode = mode;
  }

  /**
   * Accepts a strict prefix-extension of the accumulated text.
   *
   * @param fullText - The complete accumulated text, rather than a delta.
   * @returns Newly stable chunks in oldest-first order.
   */
  accept(fullText: string): readonly string[] {
    const currentText = this.committed + this.pending;
    if (!fullText.startsWith(currentText) || fullText.length <= currentText.length) {
      return [];
    }

    this.pending = fullText.slice(this.committed.length);
    return this.mode === 'plain' ? this.extractPlainChunks() : this.extractMarkdownChunks();
  }

  /**
   * Commits and returns the retained tail, if one exists.
   *
   * Call this at completion only. Flushing mid-stream commits a partial block,
   * so the next `accept` resumes scanning from inside it and would emit the
   * remainder as if it were a block of its own.
   *
   * @returns The retained tail once, or an empty array when no text remains.
   */
  flush(): readonly string[] {
    if (this.pending.length === 0) {
      return [];
    }

    const retained = this.pending;
    this.committed += retained;
    this.pending = '';
    return [retained];
  }

  /**
   * Returns text that has not yet formed a stable chunk.
   *
   * @returns The currently retained trailing text.
   */
  retained(): string {
    return this.pending;
  }

  /**
   * Returns all source text consumed by emitted chunks and flushes.
   *
   * @returns The committed source text, including consumed separators.
   */
  committedText(): string {
    return this.committed;
  }

  private extractPlainChunks(): readonly string[] {
    const lastNewline = this.pending.lastIndexOf('\n');
    if (lastNewline < 0) {
      return [];
    }

    const stable = this.pending.slice(0, lastNewline + 1);
    const chunks = stable.slice(0, -1).split('\n');
    this.committed += stable;
    this.pending = this.pending.slice(lastNewline + 1);
    return chunks;
  }

  private extractMarkdownChunks(): readonly string[] {
    const chunks: string[] = [];
    let blockStart = 0;
    let lineStart = 0;
    let fenceMarker: '`' | '~' | undefined;
    let fenceLength: number | undefined;

    while (lineStart < this.pending.length) {
      const newline = this.pending.indexOf('\n', lineStart);
      if (newline < 0) {
        break;
      }

      const line = this.pending.slice(lineStart, newline);
      const fence = this.leadingFence(line);
      if (fenceLength === undefined) {
        if (fence !== undefined && fence.length >= 3) {
          fenceMarker = fence.marker;
          fenceLength = fence.length;
          lineStart = newline + 1;
          continue;
        }
      } else {
        if (
          fence !== undefined
          && fence.marker === fenceMarker
          && fence.length >= fenceLength
        ) {
          fenceMarker = undefined;
          fenceLength = undefined;
        } else {
          lineStart = newline + 1;
          continue;
        }
      }

      let separatorEnd = newline;
      while (
        separatorEnd < this.pending.length
        && this.pending.charAt(separatorEnd) === '\n'
      ) {
        separatorEnd += 1;
      }

      if (separatorEnd - newline >= 2) {
        chunks.push(this.pending.slice(blockStart, newline));
        blockStart = separatorEnd;
        lineStart = separatorEnd;
      } else {
        lineStart = newline + 1;
      }
    }

    if (blockStart > 0) {
      this.committed += this.pending.slice(0, blockStart);
      this.pending = this.pending.slice(blockStart);
    }
    return chunks;
  }

  private leadingFence(
    line: string,
  ): { marker: '`' | '~'; length: number } | undefined {
    let index = 0;
    while (index < line.length && line.charAt(index) === ' ') {
      index += 1;
    }

    const marker = line.charAt(index);
    if (marker !== '`' && marker !== '~') {
      return undefined;
    }

    const fenceStart = index;
    while (index < line.length && line.charAt(index) === marker) {
      index += 1;
    }
    return { marker, length: index - fenceStart };
  }
}
