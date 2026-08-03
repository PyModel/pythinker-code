/**
 * Verifies deterministic transcript lifecycle commits and rejection behavior.
 */

import { describe, expect, it } from 'vitest';
import { TranscriptPresenter } from '../../../src/tui/runtime/transcript-presenter';

describe('TranscriptPresenter', () => {
  it('appends an unknown entry once as final', () => {
    const presenter = new TranscriptPresenter<string>();

    expect(presenter.append('entry', 'body')).toEqual([
      {
        key: 'entry:final',
        entryId: 'entry',
        phase: 'final',
        body: 'body',
      },
    ]);
    expect(presenter.append('entry', 'duplicate')).toEqual([]);
  });

  it('begins an unknown entry once', () => {
    const presenter = new TranscriptPresenter<string>();

    expect(presenter.begin('entry', 'body')).toEqual([
      {
        key: 'entry:start',
        entryId: 'entry',
        phase: 'start',
        body: 'body',
      },
    ]);
    expect(presenter.begin('entry', 'duplicate')).toEqual([]);
  });

  it('emits suffix deltas with incrementing progress keys', () => {
    const presenter = new TranscriptPresenter<string>();
    presenter.begin('entry', 'start');

    expect(presenter.update('entry', 'hello', (delta) => delta)).toEqual([
      {
        key: 'entry:progress:0',
        entryId: 'entry',
        phase: 'progress',
        body: 'hello',
      },
    ]);
    expect(presenter.update('entry', 'hello world', (delta) => delta)).toEqual([
      {
        key: 'entry:progress:1',
        entryId: 'entry',
        phase: 'progress',
        body: ' world',
      },
    ]);
  });

  it('rejects shrinking, equal, and divergent updates without advancing the counter', () => {
    const presenter = new TranscriptPresenter<string>();
    let calls = 0;
    const makeBody = (delta: string): string => {
      calls += 1;
      return delta;
    };

    presenter.begin('entry', 'start');
    presenter.update('entry', 'hello', makeBody);

    expect(presenter.update('entry', 'hell', makeBody)).toEqual([]);
    expect(presenter.update('entry', 'hello', makeBody)).toEqual([]);
    expect(presenter.update('entry', 'hullo!', makeBody)).toEqual([]);
    expect(calls).toBe(1);
    expect(presenter.update('entry', 'hello!', makeBody)).toEqual([
      {
        key: 'entry:progress:1',
        entryId: 'entry',
        phase: 'progress',
        body: '!',
      },
    ]);
    expect(calls).toBe(2);
  });

  it('completes a live entry once and rejects unknown or finalized entries', () => {
    const presenter = new TranscriptPresenter<string>();

    expect(presenter.complete('unknown', 'final')).toEqual([]);
    presenter.begin('entry', 'start');
    expect(presenter.complete('entry', 'final')).toEqual([
      {
        key: 'entry:final',
        entryId: 'entry',
        phase: 'final',
        body: 'final',
      },
    ]);
    expect(presenter.complete('entry', 'duplicate')).toEqual([]);
    expect(presenter.update('entry', 'late', (delta) => delta)).toEqual([]);
  });

  it('resets state and progress keys for a reused entry id', () => {
    const presenter = new TranscriptPresenter<string>();

    presenter.begin('entry', 'start');
    presenter.update('entry', 'text', (delta) => delta);
    presenter.reset();

    expect(presenter.begin('entry', 'new start')).toEqual([
      {
        key: 'entry:start',
        entryId: 'entry',
        phase: 'start',
        body: 'new start',
      },
    ]);
    expect(presenter.update('entry', 'new', (delta) => delta)).toEqual([
      {
        key: 'entry:progress:0',
        entryId: 'entry',
        phase: 'progress',
        body: 'new',
      },
    ]);
  });

  it('reports idle state based only on live entries', () => {
    const presenter = new TranscriptPresenter<string>();

    expect(presenter.idle()).toBe(true);
    presenter.append('finalized', 'body');
    expect(presenter.idle()).toBe(true);
    presenter.begin('live', 'body');
    expect(presenter.idle()).toBe(false);
    presenter.complete('live', 'body');
    expect(presenter.idle()).toBe(true);
    presenter.begin('another', 'body');
    presenter.reset();
    expect(presenter.idle()).toBe(true);
  });

  it('carries turn ids through live commits and omits absent turn ids', () => {
    const presenter = new TranscriptPresenter<string>();

    expect(presenter.begin('with-turn', 'start', 'turn-1')).toEqual([
      {
        key: 'with-turn:start',
        entryId: 'with-turn',
        turnId: 'turn-1',
        phase: 'start',
        body: 'start',
      },
    ]);
    expect(presenter.update('with-turn', 'text', (delta) => delta)).toEqual([
      {
        key: 'with-turn:progress:0',
        entryId: 'with-turn',
        turnId: 'turn-1',
        phase: 'progress',
        body: 'text',
      },
    ]);
    expect(presenter.complete('with-turn', 'final')).toEqual([
      {
        key: 'with-turn:final',
        entryId: 'with-turn',
        turnId: 'turn-1',
        phase: 'final',
        body: 'final',
      },
    ]);

    const withoutTurn = presenter.append('without-turn', 'body');
    expect(withoutTurn).toEqual([
      {
        key: 'without-turn:final',
        entryId: 'without-turn',
        phase: 'final',
        body: 'body',
      },
    ]);
    expect(withoutTurn[0]).not.toHaveProperty('turnId');
  });
});
