import type { Component } from '@earendil-works/pi-tui';

import { GutterContainer } from './gutter-container';
import {
  getTranscriptChildMetadata,
  type TranscriptChildMetadata,
  type TranscriptChildRole,
  markTranscriptChild,
} from '../../utils/transcript-component-metadata';

export type { TranscriptChildMetadata, TranscriptChildRole } from '../../utils/transcript-component-metadata';

export class TranscriptContainer extends GutterContainer {
  private readonly leftGutter: number;
  private readonly rightGutter: number;
  private renderedRowsAfterChildDepth = 0;

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
    const nestedRender = this.renderedRowsAfterChildDepth > 0;
    this.renderedRowsAfterChildDepth += 1;
    try {
      let rows = 0;
      let previousDurable = nestedRender ? isDurable(metadata.role) : false;
      if (!nestedRender) {
        for (let previousIndex = index; previousIndex >= 0; previousIndex -= 1) {
          const previousChild = this.children[previousIndex]!;
          const previousMetadata = getTranscriptChildMetadata(previousChild);
          if (previousMetadata === undefined) {
            throw new Error('Transcript child was added without metadata');
          }
          const previousRows = this.normalizeRows(
            previousChild.render(inner),
            previousMetadata,
          );
          if (previousRows.length === 0) continue;
          previousDurable = isDurable(previousMetadata.role);
          break;
        }
      }
      for (let childIndex = index + 1; childIndex < this.children.length; childIndex += 1) {
        const followingChild = this.children[childIndex]!;
        const followingMetadata = getTranscriptChildMetadata(followingChild);
        if (followingMetadata === undefined) {
          throw new Error('Transcript child was added without metadata');
        }
        const followingRows = this.normalizeRows(
          followingChild.render(inner),
          followingMetadata,
        );
        if (followingRows.length === 0) continue;
        if (previousDurable && isDurable(followingMetadata.role)) rows += 1;
        rows += followingRows.length;
        previousDurable = isDurable(followingMetadata.role);
      }
      return rows;
    } finally {
      this.renderedRowsAfterChildDepth -= 1;
    }
  }

  override render(width: number): string[] {
    const inner = Math.max(1, width - this.leftGutter - this.rightGutter);
    const lead = ' '.repeat(this.leftGutter);
    const rows: string[] = [];
    let hasVisible = false;
    let previousDurable = false;
    for (const child of this.children) {
      const metadata = getTranscriptChildMetadata(child);
      if (metadata === undefined) {
        throw new Error('Transcript child was added without metadata');
      }
      const childRows = this.normalizeRows(child.render(inner), metadata);
      if (childRows.length === 0) continue;
      if (hasVisible && previousDurable && isDurable(metadata.role)) rows.push(lead);
      for (const row of childRows) rows.push(lead + row);
      hasVisible = true;
      previousDurable = isDurable(metadata.role);
    }
    return rows;
  }

  private normalizeRows(
    rows: readonly string[],
    metadata: TranscriptChildMetadata,
  ): readonly string[] {
    if (metadata.edgeBlankPolicy === 'preserve') return rows;
    let start = 0;
    let end = rows.length;
    while (start < end && isPlainBlank(rows[start]!)) start += 1;
    while (end > start && isPlainBlank(rows[end - 1]!)) end -= 1;
    return rows.slice(start, end);
  }
}

function isPlainBlank(value: string): boolean {
  return /^[ ]*$/u.test(value);
}

function isDurable(role: TranscriptChildRole): boolean {
  return role === 'durable' || role === 'live-durable';
}
