import type { Component } from '@earendil-works/pi-tui';

import { GutterContainer } from './gutter-container';
import {
  getTranscriptChildMetadata,
  type TranscriptChildMetadata,
  type TranscriptChildRole,
  markTranscriptChild,
} from '../../utils/transcript-component-metadata';

export type { TranscriptChildMetadata, TranscriptChildRole } from '../../utils/transcript-component-metadata';

interface RenderedChild {
  readonly child: Component;
  readonly metadata: TranscriptChildMetadata;
  readonly rows: readonly string[];
}

export class TranscriptContainer extends GutterContainer {
  private readonly leftGutter: number;
  private readonly rightGutter: number;

  constructor(leftPad: number, rightPad: number) {
    super(leftPad, rightPad);
    this.leftGutter = leftPad;
    this.rightGutter = rightPad;
  }

  addTranscriptChild(child: Component, metadata: TranscriptChildMetadata): void {
    markTranscriptChild(child, metadata);
    super.addChild(child);
  }

  addTranscriptChildAt(
    index: number,
    child: Component,
    metadata: TranscriptChildMetadata,
  ): void {
    markTranscriptChild(child, metadata);
    this.children.splice(Math.max(0, Math.min(index, this.children.length)), 0, child);
    this.invalidate();
  }
  replaceTranscriptChild(
    current: Component,
    next: Component,
    metadata: TranscriptChildMetadata,
  ): void {
    const index = this.children.indexOf(current);
    if (index < 0) {
      this.addTranscriptChild(next, metadata);
      return;
    }
    markTranscriptChild(next, metadata);
    this.children[index] = next;
    this.invalidate();
  }
  override addChild(_child: Component): void {
    throw new Error('TranscriptContainer requires addTranscriptChild() metadata');
  }

  renderedRowsAfterChild(width: number, child: Component): number {
    const index = this.children.indexOf(child);
    if (index < 0) return 0;
    const metadata = getTranscriptChildMetadata(child);
    if (metadata === undefined) {
      throw new Error('Transcript child was added without metadata');
    }
    const inner = Math.max(1, width - this.leftGutter - this.rightGutter);
    const following = this.children.slice(index + 1).map((followingChild) => {
      const followingMetadata = getTranscriptChildMetadata(followingChild);
      if (followingMetadata === undefined) {
        throw new Error('Transcript child was added without metadata');
      }
      return {
        child: followingChild,
        metadata: followingMetadata,
        rows: this.normalizeRows(followingChild.render(inner), followingMetadata),
      };
    });
    const firstVisible = following.find((segment) => segment.rows.length > 0);
    const separator =
      firstVisible !== undefined &&
      isDurable(metadata.role) &&
      isDurable(firstVisible.metadata.role)
        ? 1
        : 0;
    return separator + this.rowsForSegments(following).length;
  }

  override render(width: number): string[] {
    return this.rowsForSegments(this.renderedChildren(width)).map((row) => {
      return ' '.repeat(this.leftGutter) + row;
    });
  }


  private renderedChildren(width: number): RenderedChild[] {
    const inner = Math.max(1, width - this.leftGutter - this.rightGutter);
    return this.children.map((child) => {
      const metadata = getTranscriptChildMetadata(child);
      if (metadata === undefined) {
        throw new Error('Transcript child was added without metadata');
      }
      return {
        child,
        metadata,
        rows: this.normalizeRows(child.render(inner), metadata),
      };
    });
  }

  private normalizeRows(
    rows: readonly string[],
    metadata: TranscriptChildMetadata,
  ): readonly string[] {
    if (metadata.edgeBlankPolicy === 'preserve') return [...rows];
    let start = 0;
    let end = rows.length;
    while (start < end && isPlainBlank(rows[start]!)) start += 1;
    while (end > start && isPlainBlank(rows[end - 1]!)) end -= 1;
    return rows.slice(start, end);
  }

  private rowsForSegments(segments: readonly RenderedChild[]): string[] {
    const rows: string[] = [];
    const visibleSegments = segments.filter((segment) => segment.rows.length > 0);
    for (let index = 0; index < visibleSegments.length; index += 1) {
      const segment = visibleSegments[index]!;
      rows.push(...segment.rows);
      const next = visibleSegments[index + 1];
      if (
        next !== undefined &&
        isDurable(segment.metadata.role) &&
        isDurable(next.metadata.role)
      ) {
        rows.push('');
      }
    }
    return rows;
  }
}

function isPlainBlank(value: string): boolean {
  return /^[ ]*$/u.test(value);
}

function isDurable(role: TranscriptChildRole): boolean {
  return role === 'durable' || role === 'live-durable';
}
