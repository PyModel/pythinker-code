import { describe, expect, it } from 'vitest';

import { TaskOutputModel } from '../../../src/tui/presentation/task-output-model';

function createModel(complete?: boolean): TaskOutputModel {
  return new TaskOutputModel({
    taskId: 'task-1',
    title: 'Task output',
    complete,
  });
}

describe('TaskOutputModel', () => {
  it('starts empty, following, at the top, and defaults complete to false', () => {
    const model = createModel();

    expect(model.toViewModel(3)).toEqual({
      taskId: 'task-1',
      title: 'Task output',
      lines: [],
      follow: true,
      complete: false,
    });
    expect(createModel(true).toViewModel(3).complete).toBe(true);
  });

  it('computes the scroll bound with at least one viewable row', () => {
    const model = createModel();
    model.setOutput('a\nb\nc');
    model.toViewModel(0);
    model.handleKey({ kind: 'home' });
    model.handleKey({ kind: 'page-down' });

    expect(model.toViewModel(1).lines).toEqual(['b']);
  });

  it('replaces output, follows new output, preserves manual position, and clamps after shrink', () => {
    const following = createModel();
    following.setOutput('a\nb\nc\nd');
    expect(following.toViewModel(2).lines).toEqual(['c', 'd']);
    following.setOutput('a\nb\nc\nd\ne\nf');
    expect(following.toViewModel(2).lines).toEqual(['e', 'f']);

    const manual = createModel();
    manual.setOutput('a\nb\nc\nd\ne\nf');
    manual.toViewModel(3);
    manual.handleKey({ kind: 'up' });
    manual.setOutput('a\nb\nc\nd\ne\nf\ng\nh');
    expect(manual.toViewModel(3)).toMatchObject({
      lines: ['c', 'd', 'e'],
      follow: false,
    });

    manual.setOutput('a\nb\nc');
    expect(manual.toViewModel(3)).toMatchObject({
      lines: ['a', 'b', 'c'],
      follow: false,
    });
  });

  it('updates completion without changing output, position, or follow state', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd');
    model.toViewModel(2);
    model.handleKey({ kind: 'up' });
    const before = model.toViewModel(2);

    model.setComplete(true);

    expect(model.toViewModel(2)).toEqual({ ...before, complete: true });
  });

  it('moves up one row and always disengages follow', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd');
    model.toViewModel(2);

    expect(model.handleKey({ kind: 'up' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel(2)).toMatchObject({
      lines: ['b', 'c'],
      follow: false,
    });
  });

  it('moves down one row and re-engages follow only at the exact bottom', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd\ne');
    model.toViewModel(2);
    model.handleKey({ kind: 'home' });

    model.handleKey({ kind: 'down' });
    expect(model.toViewModel(2)).toMatchObject({ lines: ['b', 'c'], follow: false });
    model.handleKey({ kind: 'down' });
    expect(model.toViewModel(2)).toMatchObject({ lines: ['c', 'd'], follow: false });
    model.handleKey({ kind: 'down' });
    expect(model.toViewModel(2)).toMatchObject({ lines: ['d', 'e'], follow: true });
  });

  it('moves page-up by viewport rows minus one and disengages follow', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd\ne\nf');
    model.toViewModel(3);

    expect(model.handleKey({ kind: 'page-up' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel(3)).toMatchObject({
      lines: ['b', 'c', 'd'],
      follow: false,
    });
  });

  it('moves page-down by viewport rows minus one and follows only at the bottom', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd\ne\nf\ng\nh');
    model.toViewModel(3);
    model.handleKey({ kind: 'home' });

    model.handleKey({ kind: 'page-down' });
    expect(model.toViewModel(3)).toMatchObject({ lines: ['c', 'd', 'e'], follow: false });
    model.handleKey({ kind: 'page-down' });
    expect(model.toViewModel(3)).toMatchObject({ lines: ['e', 'f', 'g'], follow: false });
    model.handleKey({ kind: 'page-down' });
    expect(model.toViewModel(3)).toMatchObject({ lines: ['f', 'g', 'h'], follow: true });
  });

  it('jumps home and always disengages follow', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd');
    model.toViewModel(2);

    expect(model.handleKey({ kind: 'home' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel(2)).toMatchObject({
      lines: ['a', 'b'],
      follow: false,
    });
  });

  it('jumps end and always re-engages follow', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd');
    model.toViewModel(2);
    model.handleKey({ kind: 'home' });

    expect(model.handleKey({ kind: 'end' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel(2)).toMatchObject({
      lines: ['c', 'd'],
      follow: true,
    });
  });

  it('returns close without changing state', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd');
    model.toViewModel(2);
    model.handleKey({ kind: 'up' });
    const before = model.toViewModel(2);

    expect(model.handleKey({ kind: 'close' })).toEqual({ type: 'close' });
    expect(model.toViewModel(2)).toEqual(before);
  });

  it('uses the latest viewport, clamps a manual window, and pins a followed resize', () => {
    const manual = createModel();
    manual.setOutput('a\nb\nc\nd\ne\nf');
    manual.toViewModel(4);
    manual.handleKey({ kind: 'up' });
    expect(manual.toViewModel(2)).toMatchObject({
      lines: ['b', 'c'],
      follow: false,
    });
    manual.handleKey({ kind: 'page-down' });
    expect(manual.toViewModel(2)).toMatchObject({
      lines: ['c', 'd'],
      follow: false,
    });

    const following = createModel();
    following.setOutput('a\nb\nc\nd\ne\nf');
    expect(following.toViewModel(2).lines).toEqual(['e', 'f']);
    expect(following.toViewModel(4)).toMatchObject({
      lines: ['c', 'd', 'e', 'f'],
      follow: true,
    });
  });

  it('clamps with the standard formula and never returns more than viewportRows lines', () => {
    const model = createModel();
    model.setOutput('a\nb\nc\nd\ne');

    expect(model.toViewModel(2).lines).toHaveLength(2);
    expect(model.toViewModel(0).lines).toEqual([]);
    expect(model.toViewModel(-1).lines).toEqual([]);
  });
});
