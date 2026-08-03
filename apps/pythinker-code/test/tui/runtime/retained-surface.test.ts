/*
 * Verifies stable chunk extraction and retained-tail behavior for streamed text.
 */

import { describe, expect, it } from 'vitest';

import { RetainedSurface } from '../../../src/tui/runtime/scrollback/retained-surface';

describe('RetainedSurface plain mode', () => {
  it('commits complete lines incrementally and preserves empty lines', () => {
    const surface = new RetainedSurface('plain');

    expect(surface.accept('a\nb')).toEqual(['a']);
    expect(surface.committedText() + surface.retained()).toBe('a\nb');
    expect(surface.retained()).toBe('b');
    expect(surface.accept('a\nb\n\nc')).toEqual(['b', '']);
    expect(surface.committedText() + surface.retained()).toBe('a\nb\n\nc');
    expect(surface.retained()).toBe('c');
    expect(surface.accept('a\nb\n\ncd')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('a\nb\n\ncd');
  });

  it('ignores equal, shrinking, and divergent text without changing state', () => {
    const surface = new RetainedSurface('plain');

    expect(surface.accept('line\ntail')).toEqual(['line']);
    expect(surface.accept('line\ntail')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('line\ntail');
    expect(surface.accept('line\n')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('line\ntail');
    expect(surface.accept('line\nfail')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('line\ntail');
  });

  it('flushes a retained tail exactly once', () => {
    const surface = new RetainedSurface('plain');

    expect(surface.accept('tail')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('tail');
    expect(surface.flush()).toEqual(['tail']);
    expect(surface.committedText() + surface.retained()).toBe('tail');
    expect(surface.retained()).toBe('');
    expect(surface.flush()).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('tail');
  });

  it('returns an empty flush after consuming a complete stream', () => {
    const surface = new RetainedSurface('plain');

    expect(surface.accept('line\n')).toEqual(['line']);
    expect(surface.retained()).toBe('');
    expect(surface.flush()).toEqual([]);
    expect(surface.committedText()).toBe('line\n');
  });
});

describe('RetainedSurface markdown mode', () => {
  it('commits complete blocks incrementally and retains incomplete additions', () => {
    const surface = new RetainedSurface('markdown');

    expect(surface.accept('# Title\n\nBody')).toEqual(['# Title']);
    expect(surface.committedText() + surface.retained()).toBe('# Title\n\nBody');
    expect(surface.retained()).toBe('Body');
    expect(surface.accept('# Title\n\nBody grows')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('# Title\n\nBody grows');
    expect(surface.accept('# Title\n\nBody grows\n\nTail')).toEqual(['Body grows']);
    expect(surface.committedText() + surface.retained()).toBe(
      '# Title\n\nBody grows\n\nTail',
    );
    expect(surface.retained()).toBe('Tail');
  });

  it('ignores equal, shrinking, and divergent text without changing state', () => {
    const surface = new RetainedSurface('markdown');

    expect(surface.accept('Block\n\nTail')).toEqual(['Block']);
    expect(surface.accept('Block\n\nTail')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('Block\n\nTail');
    expect(surface.accept('Block\n\n')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('Block\n\nTail');
    expect(surface.accept('Block\n\nOther')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('Block\n\nTail');
  });

  it('does not split at blank lines inside a fenced code block', () => {
    const surface = new RetainedSurface('markdown');

    expect(surface.accept('```\ncode\n\nmore')).toEqual([]);
    expect(surface.committedText() + surface.retained()).toBe('```\ncode\n\nmore');
    expect(surface.accept('```\ncode\n\nmore\n```\n\ntail')).toEqual([
      '```\ncode\n\nmore\n```',
    ]);
    expect(surface.committedText() + surface.retained()).toBe(
      '```\ncode\n\nmore\n```\n\ntail',
    );
    expect(surface.retained()).toBe('tail');
  });

  it('tracks tilde fences by marker and opening length', () => {
    const surface = new RetainedSurface('markdown');

    expect(surface.accept('~~~~\ncode\n\nstill open\n````\n\nmore')).toEqual([]);
    expect(surface.retained()).toBe('~~~~\ncode\n\nstill open\n````\n\nmore');
    expect(
      surface.accept('~~~~\ncode\n\nstill open\n````\n\nmore\n~~~~\n\ntail'),
    ).toEqual(['~~~~\ncode\n\nstill open\n````\n\nmore\n~~~~']);
    expect(surface.retained()).toBe('tail');
  });

  it('consumes a run of newlines as one block separator', () => {
    const surface = new RetainedSurface('markdown');

    expect(surface.accept('First\n\n\n\nSecond')).toEqual(['First']);
    expect(surface.committedText()).toBe('First\n\n\n\n');
    expect(surface.retained()).toBe('Second');
    expect(surface.committedText() + surface.retained()).toBe('First\n\n\n\nSecond');
  });

  it('keeps an open fence retained until it is flushed', () => {
    const surface = new RetainedSurface('markdown');

    expect(surface.accept('Before\n\n````\ncode\n\nstill open')).toEqual(['Before']);
    expect(surface.committedText() + surface.retained()).toBe(
      'Before\n\n````\ncode\n\nstill open',
    );
    expect(surface.retained()).toBe('````\ncode\n\nstill open');
    expect(surface.flush()).toEqual(['````\ncode\n\nstill open']);
    expect(surface.committedText() + surface.retained()).toBe(
      'Before\n\n````\ncode\n\nstill open',
    );
    expect(surface.retained()).toBe('');
    expect(surface.flush()).toEqual([]);
  });

  it('terminates for newline-only and backtick-only input', () => {
    const newlines = new RetainedSurface('markdown');
    const backticks = new RetainedSurface('markdown');

    expect(newlines.accept('\n\n\n')).toEqual(['']);
    expect(newlines.committedText()).toBe('\n\n\n');
    expect(newlines.retained()).toBe('');
    expect(newlines.flush()).toEqual([]);

    expect(backticks.accept('````')).toEqual([]);
    expect(backticks.retained()).toBe('````');
    expect(backticks.flush()).toEqual(['````']);
    expect(backticks.flush()).toEqual([]);
  });
});
