import type { BaseRenderable, KeyEvent } from '@opentui/core';
import chalk from 'chalk';
import { describe, expect, it, vi } from 'vitest';

import { KeybindingResolver, parseKeybindingBlocks } from '#/tui/keybindings';
import type { DialogViewModel } from '../../../src/tui/presentation/dialog-list-model';
import { renderDialogListRows } from '../../../src/tui/runtime/dialogs/dialog-list-rows';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/gu, '');
}

function withAnsiColors<T>(fn: () => T): T {
  const previousChalkLevel = chalk.level;
  chalk.level = 3;
  try {
    return fn();
  } finally {
    chalk.level = previousChalkLevel;
  }
}

function descendants(root: BaseRenderable): readonly BaseRenderable[] {
  return root.getChildren().flatMap((child) => [child, ...descendants(child)]);
}

function baseViewModel(overrides: Partial<DialogViewModel> = {}): DialogViewModel {
  return {
    title: 'Pick a theme',
    rows: [
      { id: 'a', label: 'Auto' },
      { id: 'b', label: 'Dark', current: true },
      { id: 'c', label: 'Light', disabled: true },
    ],
    selectedIndex: 1,
    ...overrides,
  };
}

describe('renderDialogListRows', () => {
  it('styles selected, current, and disabled row semantics', () => {
    const rows = withAnsiColors(() => renderDialogListRows(baseViewModel(), 40));
    const border = '─'.repeat(40);

    expect(rows.join('\n')).toContain('\u001B');
    expect(rows[5] ?? '').toContain('\u001B[1m');
    expect(rows[4] ?? '').not.toContain('\u001B[1m');
    expect(rows.map(stripAnsi)).toEqual([
      border,
      'Pick a theme  (type to search)',
      '↑↓ navigate · Enter select · Esc cancel',
      '',
      '  Auto',
      '❯ Dark ← current',
      '  Light (disabled)',
      border,
    ]);
  });

  it('renders a non-empty query as a separate search row', () => {
    const border = '─'.repeat(80);
    expect(renderDialogListRows(baseViewModel({ query: 'da' }), 80).map(stripAnsi)).toEqual([
      border,
      'Pick a theme',
      '↑↓ navigate · Enter select · Esc cancel · Backspace clear',
      '',
      'Search: da',
      '  Auto',
      '❯ Dark ← current',
      '  Light (disabled)',
      border,
    ]);
  });

  it('renders the empty state inside the standard dialog chrome', () => {
    const border = '─'.repeat(40);
    expect(
      renderDialogListRows(
        { title: 'Pick a theme', rows: [], selectedIndex: 0, hint: 'No matches' },
        40,
      ).map(stripAnsi),
    ).toEqual([
      border,
      'Pick a theme  (type to search)',
      '↑↓ navigate · Enter select · Esc cancel',
      '',
      'No matches',
      border,
    ]);
  });

  it('renders the empty filtered state with its search row', () => {
    const border = '─'.repeat(80);
    expect(
      renderDialogListRows(
        {
          title: 'Pick a theme',
          rows: [],
          selectedIndex: 0,
          query: 'missing',
          hint: 'No matches',
        },
        80,
      ).map(stripAnsi),
    ).toEqual([
      border,
      'Pick a theme',
      '↑↓ navigate · Enter select · Esc cancel · Backspace clear',
      '',
      'Search: missing',
      'No matches',
      border,
    ]);
  });

  it('truncates every line to the given width', () => {
    const rows = renderDialogListRows(
      baseViewModel({ title: 'A very long dialog title that will not fit' }),
      10,
    );
    for (const line of rows) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(10);
    }
  });
});

const ffiEnabled =
  process.execArgv.some((arg) => arg.includes('experimental-ffi')) ||
  (process.env['NODE_OPTIONS'] ?? '').includes('experimental-ffi');

// OpenTUI's test renderer requires experimental FFI; these tests skip without it.
describe.skipIf(!ffiEnabled)('DialogListView', () => {
  it('renders the same ordered row semantics without ANSI text content', async () => {
    const { TextRenderable } = await import('@opentui/core');
    const { testRender } = await import('@opentui/solid');
    const { DialogListView } = await import('../../../src/tui/runtime/dialogs/dialog-list-view');
    const viewModel = baseViewModel();
    const previousChalkLevel = chalk.level;
    chalk.level = 3;

    try {
      const setup = await testRender(
        () => <DialogListView viewModel={viewModel} width={40} />,
        { width: 40, height: 10 },
      );
      try {
        await setup.renderOnce();
        const frame = setup.captureCharFrame();
        const textContent = descendants(setup.renderer.root)
          .filter((node) => node instanceof TextRenderable)
          .map((node) => node.plainText)
          .join('\n');
        const legacyRows = renderDialogListRows(viewModel, 40).map(stripAnsi);

        expect(textContent).not.toContain('\u001B');
        expect(frame).toContain('❯ Dark');
        expect(frame).not.toContain('❯ Auto');
        let previousIndex = -1;
        for (const row of legacyRows.filter((row) => row !== '')) {
          const index = frame.indexOf(row, previousIndex + 1);
          expect(index).toBeGreaterThan(previousIndex);
          previousIndex = index;
        }
      } finally {
        setup.renderer.destroy();
      }
    } finally {
      chalk.level = previousChalkLevel;
    }
  }, 30_000);

  it('renders the same empty-state hint as the legacy rows', async () => {
    const { testRender } = await import('@opentui/solid');
    const { DialogListView } = await import('../../../src/tui/runtime/dialogs/dialog-list-view');
    const viewModel = baseViewModel({ rows: [], selectedIndex: 0, hint: 'No matches' });
    const legacyRows = withAnsiColors(() =>
      renderDialogListRows(viewModel, 40).map(stripAnsi),
    );

    const setup = await testRender(
      () => <DialogListView viewModel={viewModel} width={40} />,
      { width: 40, height: 6 },
    );
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain(legacyRows[4]);
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('applies a different native color to the selected row', async () => {
    const { TextRenderable } = await import('@opentui/core');
    const { testRender } = await import('@opentui/solid');
    const { DialogListView } = await import('../../../src/tui/runtime/dialogs/dialog-list-view');

    const setup = await testRender(
      () => <DialogListView viewModel={baseViewModel()} width={40} />,
      { width: 40, height: 8 },
    );
    try {
      await setup.renderOnce();
      const textNodes = descendants(setup.renderer.root).filter(
        (node) => node instanceof TextRenderable,
      );
      const selectedRow = textNodes.find((node) => node.plainText.includes('Dark'));
      const unselectedRow = textNodes.find((node) => node.plainText.includes('Auto'));

      expect(selectedRow).toBeDefined();
      expect(unselectedRow).toBeDefined();
      expect(selectedRow?.fg.equals(unselectedRow?.fg)).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);
});

describe.skipIf(!ffiEnabled)('ChoicePickerView', () => {
  it('matches pi-tui Select actions through OpenTUI keyboard events', async () => {
    const { testRender } = await import('@opentui/solid');
    const { ChoicePickerView } = await import(
      '../../../src/tui/runtime/dialogs/choice-picker-view'
    );
    const cases = [
      { binding: 'x', rawInput: 'x', key: 'x', modifiers: undefined },
      { binding: 'ctrl+k', rawInput: '\x0B', key: 'k', modifiers: { ctrl: true } },
      { binding: 'alt+m', rawInput: '\u001Bm', key: 'm', modifiers: { meta: true } },
      { binding: 'shift+tab', rawInput: '\u001B[Z', key: 'TAB', modifiers: { shift: true } },
      { binding: 'super+w', rawInput: '\u001B[119;9u', key: 'w', modifiers: { super: true } },
      { binding: 'enter', rawInput: '\r', key: 'RETURN', modifiers: undefined },
    ] as const;

    for (const testCase of cases) {
      const bindings = parseKeybindingBlocks([
        { context: 'Select', bindings: { [testCase.binding]: 'select:accept' } },
      ]);
      const piResolver = new KeybindingResolver(bindings);
      let piSelected = false;
      expect(
        piResolver.dispatch(testCase.rawInput, ['Select'], {
          'select:accept': () => {
            piSelected = true;
          },
        }),
      ).toBe(true);
      expect(piSelected).toBe(true);

      const selected: DialogViewModel['rows'][number][] = [];
      const setup = await testRender(
        () => (
          <ChoicePickerView
            options={{ title: 'Pick a theme', rows: baseViewModel().rows }}
            width={40}
            bindings={bindings}
            context="Select"
            onSelect={(row) => {
              selected.push(row);
            }}
            onCancel={() => undefined}
          />
        ),
        { width: 40, height: 8, kittyKeyboard: true },
      );

      try {
        await setup.renderOnce();
        setup.mockInput.pressKey(testCase.key, testCase.modifiers);
        await setup.waitFor(() => selected.length === 1);
        expect(selected[0]?.id).toBe('a');
      } finally {
        setup.renderer.destroy();
      }
    }
  }, 30_000);

  it('consumes Select and Global null bindings but leaves unknown OpenTUI events untouched', async () => {
    const { testRender, useKeyboard } = await import('@opentui/solid');
    const { ChoicePickerView } = await import(
      '../../../src/tui/runtime/dialogs/choice-picker-view'
    );
    const events: KeyEvent[] = [];
    const Probe = () => {
      useKeyboard((key) => {
        events.push(key);
      });
      return (
        <ChoicePickerView
          options={{ title: 'Pick a theme', rows: baseViewModel().rows }}
          width={40}
          bindings={parseKeybindingBlocks([
            { context: 'Select', bindings: { q: null } },
            { context: 'Global', bindings: { w: null } },
          ])}
          context="Select"
          onSelect={() => undefined}
          onCancel={() => undefined}
        />
      );
    };
    const setup = await testRender(Probe, {
      width: 40,
      height: 8,
      kittyKeyboard: true,
    });

    try {
      await setup.renderOnce();
      setup.mockInput.pressKey('q');
      await setup.waitFor(() => events.length === 1);
      expect(events[0]?.defaultPrevented).toBe(true);
      expect(events[0]?.propagationStopped).toBe(true);

      setup.mockInput.pressKey('w');
      await setup.waitFor(() => events.length === 2);
      expect(events[1]?.defaultPrevented).toBe(true);
      expect(events[1]?.propagationStopped).toBe(true);
      await setup.renderOnce();
      expect(setup.captureCharFrame()).not.toContain('Search: w');

      setup.mockInput.pressKey('F1');
      await setup.waitFor(() => events.length === 3);
      expect(events[2]?.defaultPrevented).toBe(false);
      expect(events[2]?.propagationStopped).toBe(false);
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('uses a handled Global Select fallback action', async () => {
    const { testRender } = await import('@opentui/solid');
    const { ChoicePickerView } = await import(
      '../../../src/tui/runtime/dialogs/choice-picker-view'
    );
    let cancellations = 0;
    const setup = await testRender(
      () => (
        <ChoicePickerView
          options={{ title: 'Pick a theme', rows: baseViewModel().rows }}
          width={40}
          bindings={parseKeybindingBlocks([
            { context: 'Global', bindings: { q: 'select:cancel' } },
          ])}
          onSelect={() => undefined}
          onCancel={() => {
            cancellations += 1;
          }}
        />
      ),
      { width: 40, height: 8, kittyKeyboard: true },
    );

    try {
      await setup.renderOnce();
      setup.mockInput.pressKey('q');
      await setup.waitFor(() => cancellations === 1);
      expect(setup.captureCharFrame()).not.toContain('Search: q');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('falls back to local search for an unsupported Select chord', async () => {
    const { testRender } = await import('@opentui/solid');
    const { ChoicePickerView } = await import(
      '../../../src/tui/runtime/dialogs/choice-picker-view'
    );
    const setup = await testRender(
      () => (
        <ChoicePickerView
          options={{ title: 'Pick a theme', rows: baseViewModel().rows }}
          width={40}
          bindings={parseKeybindingBlocks([
            { context: 'Select', bindings: { 'x y': 'command:search' } },
          ])}
          onSelect={() => undefined}
          onCancel={() => undefined}
        />
      ),
      { width: 40, height: 8, kittyKeyboard: true },
    );

    try {
      await setup.renderOnce();
      setup.mockInput.pressKey('x');
      await setup.waitForFrame((frame) => frame.includes('Search: x'));
      setup.mockInput.pressKey('y');
      await setup.waitForFrame((frame) => frame.includes('Search: xy'));
      expect(setup.captureCharFrame()).toContain('Search: xy');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('reactively navigates, filters, and selects through OpenTUI keyboard input', async () => {
    const { testRender } = await import('@opentui/solid');
    const { ChoicePickerView } = await import(
      '../../../src/tui/runtime/dialogs/choice-picker-view'
    );
    const selected: DialogViewModel['rows'][number][] = [];
    const setup = await testRender(
      () => (
        <ChoicePickerView
          options={{ title: 'Pick a theme', rows: baseViewModel().rows }}
          width={40}
          onSelect={(row) => {
            selected.push(row);
          }}
          onCancel={() => undefined}
        />
      ),
      { width: 40, height: 8, kittyKeyboard: true },
    );

    try {
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain('❯ Auto');

      setup.mockInput.pressArrow('down');
      await setup.waitForFrame((frame) => frame.includes('❯ Dark'));

      await setup.mockInput.typeText('da');
      await setup.waitForFrame((frame) => frame.includes('Search: da'));
      const filteredFrame = setup.captureCharFrame();
      expect(filteredFrame).toContain('❯ Dark');
      expect(filteredFrame).not.toContain('Auto');

      setup.mockInput.pressEnter();
      await setup.waitFor(() => selected.length === 1);
      expect(selected[0]?.id).toBe('b');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('clears search before canceling on Escape', async () => {
    const { testRender } = await import('@opentui/solid');
    const { ChoicePickerView } = await import(
      '../../../src/tui/runtime/dialogs/choice-picker-view'
    );
    let cancellations = 0;
    const setup = await testRender(
      () => (
        <ChoicePickerView
          options={{ title: 'Pick a theme', rows: baseViewModel().rows }}
          width={40}
          onSelect={() => undefined}
          onCancel={() => {
            cancellations += 1;
          }}
        />
      ),
      { width: 40, height: 8 },
    );

    try {
      await setup.renderOnce();
      await setup.mockInput.typeText('da');
      await setup.waitForFrame((frame) => frame.includes('Search: da'));

      setup.mockInput.pressEscape();
      await vi.waitFor(() => {
        const frame = setup.captureCharFrame();
        expect(frame).toContain('❯ Auto');
        expect(frame).not.toContain('Search: da');
      });
      expect(cancellations).toBe(0);

      setup.mockInput.pressEscape();
      await vi.waitFor(() => {
        expect(cancellations).toBe(1);
      });
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('handles Home, End, PageUp, and PageDown navigation', async () => {
    const { testRender } = await import('@opentui/solid');
    const { ChoicePickerView } = await import(
      '../../../src/tui/runtime/dialogs/choice-picker-view'
    );
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: String(index),
      label: `Row ${index}`,
    }));
    const setup = await testRender(
      () => (
        <ChoicePickerView
          options={{ title: 'Rows', rows, pageSize: 2 }}
          width={40}
          onSelect={() => undefined}
          onCancel={() => undefined}
        />
      ),
      { width: 40, height: 7 },
    );

    try {
      await setup.renderOnce();
      setup.mockInput.pressKey('END');
      await setup.waitForFrame((frame) => frame.includes('❯ Row 5'));

      setup.mockInput.pressKey('\u001B[5~');
      await setup.waitForFrame((frame) => frame.includes('❯ Row 3'));

      setup.mockInput.pressKey('HOME');
      await setup.waitForFrame((frame) => frame.includes('❯ Row 0'));

      setup.mockInput.pressKey('\u001B[6~');
      await setup.waitForFrame((frame) => frame.includes('❯ Row 2'));
      expect(setup.captureCharFrame()).toContain('❯ Row 2');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);

  it('moves up and backspaces an active search', async () => {
    const { testRender } = await import('@opentui/solid');
    const { ChoicePickerView } = await import(
      '../../../src/tui/runtime/dialogs/choice-picker-view'
    );
    const setup = await testRender(
      () => (
        <ChoicePickerView
          options={{
            title: 'Rows',
            rows: [
              { id: 'alpha', label: 'Alpha' },
              { id: 'beta', label: 'Beta' },
            ],
          }}
          width={40}
          onSelect={() => undefined}
          onCancel={() => undefined}
        />
      ),
      { width: 40, height: 7 },
    );

    try {
      await setup.renderOnce();
      setup.mockInput.pressArrow('down');
      await setup.waitForFrame((frame) => frame.includes('❯ Beta'));
      setup.mockInput.pressArrow('up');
      await setup.waitForFrame((frame) => frame.includes('❯ Alpha'));

      await setup.mockInput.typeText('z');
      await setup.waitForFrame((frame) => frame.includes('No matches'));
      setup.mockInput.pressBackspace();
      await setup.waitForFrame((frame) => frame.includes('❯ Alpha'));
      expect(setup.captureCharFrame()).toContain('❯ Alpha');
    } finally {
      setup.renderer.destroy();
    }
  }, 30_000);
});
