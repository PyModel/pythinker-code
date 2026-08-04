import { describe, expect, it } from 'vitest';

import {
  DialogListModel,
  type DialogRow,
} from '../../../src/tui/presentation/dialog-list-model';

const navigationRows: DialogRow[] = [
  { id: 'start', label: 'Start', disabled: true },
  { id: 'one', label: 'One' },
  { id: 'disabled-a', label: 'Disabled A', disabled: true },
  { id: 'disabled-b', label: 'Disabled B', disabled: true },
  { id: 'two', label: 'Two' },
  { id: 'end', label: 'End', disabled: true },
];

function selectedId(model: DialogListModel): string | undefined {
  const view = model.toViewModel();
  return view.rows[view.selectedIndex]?.id;
}

describe('DialogListModel', () => {
  it('filters by case-insensitive ordered subsequences and preserves input order', () => {
    const rows: DialogRow[] = [
      { id: 'sol', label: 'GPT-5.6 Sol' },
      { id: 'other', label: 'Other model' },
      { id: 'mini', label: 'GPT Mini' },
    ];
    const model = new DialogListModel({ title: 'Models', rows });

    for (const char of 'gpt') {
      model.handleKey({ kind: 'char', char });
    }
    expect(model.toViewModel().rows).toEqual([rows[0], rows[2]]);

    model.handleKey({ kind: 'escape' });
    for (const char of 'gtp') {
      model.handleKey({ kind: 'char', char });
    }
    expect(model.toViewModel().rows).toEqual([]);
  });

  it('uses AND semantics for whitespace and slash-separated query tokens', () => {
    const rows: DialogRow[] = [
      { id: 'claude-model', label: 'Model', description: 'Claude Sonnet' },
      { id: 'claude-chat', label: 'Chat', description: 'Claude Sonnet' },
      { id: 'openai-model', label: 'Model', description: 'OpenAI' },
    ];
    const model = new DialogListModel({ title: 'Models', rows });

    for (const char of 'model/claude') {
      model.handleKey({ kind: 'char', char });
    }
    expect(model.toViewModel().rows).toEqual([rows[0]]);
  });

  it('keeps selection in the filtered rows and on an enabled row', () => {
    const rows: DialogRow[] = [
      { id: 'alpha-disabled', label: 'Alpha', disabled: true },
      { id: 'beta', label: 'Beta' },
      { id: 'alpha-enabled', label: 'Alpha Two' },
    ];
    const model = new DialogListModel({ title: 'Rows', rows });

    for (const char of 'alp') {
      model.handleKey({ kind: 'char', char });
    }
    expect(selectedId(model)).toBe('alpha-enabled');
    expect(model.toViewModel().selectedIndex).toBe(1);
  });

  it('constructs with the first enabled row selected, or zero when none exists', () => {
    expect(selectedId(new DialogListModel({ title: 'Rows', rows: navigationRows }))).toBe('one');

    const disabledRows: DialogRow[] = [
      { id: 'a', label: 'A', disabled: true },
      { id: 'b', label: 'B', disabled: true },
    ];
    expect(
      new DialogListModel({ title: 'Rows', rows: disabledRows }).toViewModel().selectedIndex,
    ).toBe(0);
    expect(new DialogListModel({ title: 'Rows', rows: [] }).toViewModel().selectedIndex).toBe(0);
  });

  it('moves up and down to enabled rows without wrapping', () => {
    const model = new DialogListModel({ title: 'Rows', rows: navigationRows });

    expect(model.handleKey({ kind: 'up' })).toEqual({ type: 'consumed' });
    expect(selectedId(model)).toBe('one');
    model.handleKey({ kind: 'down' });
    expect(selectedId(model)).toBe('two');
    model.handleKey({ kind: 'down' });
    expect(selectedId(model)).toBe('two');
    model.handleKey({ kind: 'up' });
    expect(selectedId(model)).toBe('one');
  });

  it('moves home and end to the first and last enabled rows', () => {
    const model = new DialogListModel({ title: 'Rows', rows: navigationRows });

    expect(model.handleKey({ kind: 'end' })).toEqual({ type: 'consumed' });
    expect(selectedId(model)).toBe('two');
    expect(model.handleKey({ kind: 'home' })).toEqual({ type: 'consumed' });
    expect(selectedId(model)).toBe('one');

    const disabledRows: DialogRow[] = [
      { id: 'a', label: 'A', disabled: true },
      { id: 'b', label: 'B', disabled: true },
    ];
    const disabledModel = new DialogListModel({ title: 'Rows', rows: disabledRows });
    disabledModel.handleKey({ kind: 'end' });
    expect(disabledModel.toViewModel().selectedIndex).toBe(1);
    disabledModel.handleKey({ kind: 'home' });
    expect(disabledModel.toViewModel().selectedIndex).toBe(0);
  });

  it('pages by clamping and scanning in the primary then fallback direction', () => {
    const rows: DialogRow[] = [
      { id: 'zero', label: 'Zero' },
      { id: 'one', label: 'One', disabled: true },
      { id: 'two', label: 'Two', disabled: true },
      { id: 'three', label: 'Three' },
      { id: 'four', label: 'Four', disabled: true },
      { id: 'five', label: 'Five', disabled: true },
    ];
    const model = new DialogListModel({ title: 'Rows', rows, pageSize: 2 });

    model.handleKey({ kind: 'page-down' });
    expect(selectedId(model)).toBe('three');
    model.handleKey({ kind: 'page-down' });
    expect(selectedId(model)).toBe('three');
    model.handleKey({ kind: 'page-up' });
    expect(selectedId(model)).toBe('zero');

    const disabledModel = new DialogListModel({
      title: 'Rows',
      rows: rows.map((row) => ({ ...row, disabled: true })),
      pageSize: 2,
    });
    disabledModel.handleKey({ kind: 'page-down' });
    expect(disabledModel.toViewModel().selectedIndex).toBe(0);
  });

  it('appends characters, recomputes filtering, and resets selection', () => {
    const rows: DialogRow[] = [
      { id: 'disabled', label: 'Gamma', disabled: true },
      { id: 'gamma', label: 'Gamma Enabled' },
      { id: 'alpha', label: 'Alpha' },
    ];
    const model = new DialogListModel({ title: 'Rows', rows });
    model.handleKey({ kind: 'end' });

    expect(model.handleKey({ kind: 'char', char: 'g' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel().query).toBe('g');
    expect(selectedId(model)).toBe('gamma');
  });

  it('backspaces one character, resets selection, and consumes an empty-query no-op', () => {
    const model = new DialogListModel({ title: 'Rows', rows: navigationRows });

    expect(model.handleKey({ kind: 'backspace' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel().query).toBeUndefined();
    model.handleKey({ kind: 'char', char: 't' });
    model.handleKey({ kind: 'char', char: 'w' });
    model.handleKey({ kind: 'backspace' });
    expect(model.toViewModel().query).toBe('t');
    expect(selectedId(model)).toBe('two');
  });

  it('clears an active query on first escape and cancels without mutation on second escape', () => {
    const model = new DialogListModel({ title: 'Rows', rows: navigationRows });
    model.handleKey({ kind: 'char', char: 't' });

    expect(model.handleKey({ kind: 'escape' })).toEqual({ type: 'consumed' });
    expect(model.toViewModel().query).toBeUndefined();
    expect(selectedId(model)).toBe('one');
    const beforeCancel = model.toViewModel();
    expect(model.handleKey({ kind: 'escape' })).toEqual({ type: 'cancel' });
    expect(model.toViewModel()).toEqual(beforeCancel);
  });

  it('selects an enabled row and consumes enter for empty or disabled selections', () => {
    const enabledModel = new DialogListModel({ title: 'Rows', rows: navigationRows });
    expect(enabledModel.handleKey({ kind: 'enter' })).toEqual({
      type: 'select',
      row: navigationRows[1],
    });

    const emptyModel = new DialogListModel({ title: 'Rows', rows: [] });
    expect(emptyModel.handleKey({ kind: 'enter' })).toEqual({ type: 'consumed' });

    const disabledModel = new DialogListModel({
      title: 'Rows',
      rows: [{ id: 'disabled', label: 'Disabled', disabled: true }],
    });
    expect(disabledModel.handleKey({ kind: 'enter' })).toEqual({ type: 'consumed' });
  });

  it('returns the current page with a relative selection and view metadata', () => {
    const rows: DialogRow[] = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      label: `Row ${index}`,
    }));
    const model = new DialogListModel({ title: 'Paged rows', rows, pageSize: 3 });

    for (let index = 0; index < 7; index += 1) {
      model.handleKey({ kind: 'down' });
    }
    expect(model.toViewModel()).toEqual({
      title: 'Paged rows',
      rows: rows.slice(6, 9),
      selectedIndex: 1,
      query: undefined,
      hint: undefined,
    });

    const emptyModel = new DialogListModel({
      title: 'Empty',
      rows,
      emptyHint: 'Nothing found',
    });
    emptyModel.handleKey({ kind: 'char', char: 'z' });
    expect(emptyModel.toViewModel()).toEqual({
      title: 'Empty',
      rows: [],
      selectedIndex: 0,
      query: 'z',
      hint: 'Nothing found',
    });
  });

  it('preserves row object references in views and selection results', () => {
    const row: DialogRow & { provider: string } = {
      id: 'model',
      label: 'Model',
      provider: 'example',
    };
    const model = new DialogListModel({ title: 'Rows', rows: [row] });

    expect(model.toViewModel().rows[0]).toBe(row);
    const result = model.handleKey({ kind: 'enter' });
    expect(result).toEqual({ type: 'select', row });
    expect((result as { type: 'select'; row: typeof row }).row.provider).toBe('example');
  });
});
