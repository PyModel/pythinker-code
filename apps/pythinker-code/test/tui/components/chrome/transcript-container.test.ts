import type { Component } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';

import {
  TranscriptContainer,
  type TranscriptChildMetadata,
} from '#/tui/components/chrome/transcript-container';

class StubLines implements Component {
  constructor(private readonly lines: readonly string[]) {}

  render(): string[] {
    return [...this.lines];
  }

  invalidate(): void {}
}

const durable: TranscriptChildMetadata = {
  role: 'durable',
  edgeBlankPolicy: 'trim-plain',
};

const ephemeral: TranscriptChildMetadata = {
  role: 'ephemeral',
  edgeBlankPolicy: 'preserve',
};

describe('TranscriptContainer', () => {
  it('trims opted-in edge blanks and inserts one durable separator', () => {
    const container = new TranscriptContainer(2, 2);
    const first = new StubLines(['', 'first', '']);
    const second = new StubLines(['', 'second', '']);

    container.addTranscriptChild(first, durable);
    container.addTranscriptChild(second, durable);

    expect(container.render(20)).toEqual(['  first', '  ', '  second']);
    expect(container.children).toEqual([first, second]);
    expect(container.renderedRowsAfterChild(20, first)).toBe(2);
  });

  it('preserves ANSI blank rows and does not invent gaps around ephemeral children', () => {
    const container = new TranscriptContainer(1, 1);
    const first = new StubLines(['', '\u001b[48;5;1m  \u001b[0m', 'first', '']);
    const status = new StubLines(['status']);
    const second = new StubLines(['', 'second']);

    container.addTranscriptChild(first, durable);
    container.addTranscriptChild(status, ephemeral);
    container.addTranscriptChild(second, durable);
    expect(container.render(20)).toEqual([
      ' \u001b[48;5;1m  \u001b[0m',
      ' first',
      ' status',
      ' second',
    ]);
    expect(container.renderedRowsAfterChild(20, first)).toBe(2);
  });

  it('skips empty durable segments when placing separators', () => {
    const container = new TranscriptContainer(1, 1);
    const first = new StubLines(['first']);
    const empty = new StubLines([]);
    const second = new StubLines(['second']);

    container.addTranscriptChild(first, durable);
    container.addTranscriptChild(empty, {
      role: 'live-durable',
      edgeBlankPolicy: 'trim-plain',
    });
    container.addTranscriptChild(second, durable);

    expect(container.render(20)).toEqual([' first', ' ', ' second']);
  });

  it('keeps unregistered policy out of normalization by requiring explicit metadata', () => {
    const container = new TranscriptContainer(0, 0);
    const child = new StubLines(['', 'status', '']);

    expect(() => container.addChild(child)).toThrow(/addTranscriptChild/u);
  });
});
