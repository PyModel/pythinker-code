import { CURSOR_MARKER } from '@earendil-works/pi-tui';
import chalk from 'chalk';
import { beforeAll, describe, expect, it } from 'vitest';

import { QuestionDialogComponent } from '#/tui/components/dialogs/question-dialog';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';
import type { PendingQuestion } from '#/tui/reverse-rpc/types';
import { currentTheme } from '#/tui/theme';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

// Collapse all whitespace runs so wrapped content can be matched against its
// original (single-line) form without caring where the line break landed.
function flatten(text: string): string {
  return strip(text).replaceAll(/\s+/g, ' ').trim();
}

beforeAll(() => {
  chalk.level = 3;
});

function makePending(
  questions: PendingQuestion['data']['questions'],
  requestId = 'q_1',
): PendingQuestion {
  return {
    data: {
      id: requestId,
      tool_call_id: 'tc_1',
      questions,
    },
  };
}

function makeDialog(
  pending: PendingQuestion,
  onToggleToolOutput?: () => void,
): {
  dialog: QuestionDialogComponent;
  collected: string[][];
  methods: Array<string | undefined>;
  annotations: Array<Record<string, { preview?: string; notes?: string }> | undefined>;
} {
  const collected: string[][] = [];
  const methods: Array<string | undefined> = [];
  const annotations: Array<Record<string, { preview?: string; notes?: string }> | undefined> = [];
  const dialog = new QuestionDialogComponent(
    pending,
    (response) => {
      collected.push(response.answers);
      methods.push(response.method);
      annotations.push(response.annotations);
    },
    6,
    onToggleToolOutput,
  );
  return { dialog, collected, methods, annotations };
}

describe('QuestionDialogComponent', () => {
  it('single-select answers auto-advance and only submit from the review tab', () => {
    const pending = makePending([
      {
        question: 'Q1?',
        multi_select: false,
        options: [{ label: 'A1' }, { label: 'B1' }],
      },
      {
        question: 'Q2?',
        multi_select: false,
        options: [{ label: 'A2' }, { label: 'B2' }],
      },
    ]);
    const { dialog, collected, methods } = makeDialog(pending);

    dialog.handleInput('2');
    expect(collected).toEqual([]);
    expect(strip(dialog.render(80).join('\n'))).toMatch(/Q2\?/);

    dialog.handleInput('\r');
    expect(collected).toEqual([]);

    const reviewRaw = dialog.render(80).join('\n');
    const review = strip(reviewRaw);
    expect(review).toContain('Review your answer before submit');
    expect(review).toContain('Ready to submit your answers?');
    expect(review).not.toContain('? Ready to submit your answers?');
    expect(review).not.toContain('Please answer all questions before submitting.');
    expect(reviewRaw).toContain(
      currentTheme.boldFg('text', ' Review your answer before submit'),
    );
    expect(reviewRaw).toContain(currentTheme.fg('text', ' Ready to submit your answers?'));
    expect(review).toContain('B1');
    expect(review).toContain('A2');

    dialog.handleInput('1');
    expect(collected).toEqual([['B1', 'A2']]);
    expect(methods).toEqual(['enter']);
  });

  it('last single-select question goes straight to review instead of wrapping back', () => {
    const pending = makePending([
      {
        question: 'Q1?',
        multi_select: false,
        options: [{ label: 'A1' }, { label: 'B1' }],
      },
      {
        question: 'Q2?',
        multi_select: false,
        options: [{ label: 'A2' }, { label: 'B2' }],
      },
    ]);
    const { dialog, collected } = makeDialog(pending);

    dialog.handleInput('\t');
    dialog.handleInput('2');

    const review = strip(dialog.render(80).join('\n'));
    expect(review).toContain('Review your answer before submit');
    expect(review).toContain('Some questions are still unanswered.');
    expect(review).toContain('B2');
    expect(review).toContain('Not answered');
    expect(collected).toEqual([]);
  });

  it('renders optional body text above options', () => {
    const pending = makePending([
      {
        question: 'Approve this plan?',
        body: '# Plan\n\n1. Make the focused change.',
        multi_select: false,
        allow_other: false,
        options: [{ label: 'Approve' }, { label: 'Reject' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    const out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('# Plan');
    expect(out).toContain('1. Make the focused change.');
    expect(out).toContain('Approve');
    expect(out).not.toContain('Other');
  });

  it('renders the focused option preview and updates it with the cursor', () => {
    const pending = makePending([
      {
        question: 'Choose an implementation?',
        multi_select: false,
        options: [
          {
            label: 'Postgres',
            description: 'Relational storage',
            preview: 'CREATE TABLE example (id integer);',
          },
          {
            label: 'SQLite',
            description: 'Embedded storage',
            preview: 'const database = new Database("example.db");',
          },
        ],
      },
    ]);
    const { dialog } = makeDialog(pending);

    const initial = strip(dialog.render(100).join('\n'));
    expect(initial).toContain('CREATE TABLE example (id integer);');
    expect(initial).not.toContain('Other');
    expect(
      initial
        .split('\n')
        .some((line) => line.includes('Postgres') && line.includes('Preview')),
    ).toBe(true);
    expect(strip(dialog.render(60).join('\n'))).toContain(
      'CREATE TABLE example (id integer);',
    );

    dialog.handleInput('\u001B[B');
    const moved = strip(dialog.render(100).join('\n'));
    expect(moved).toContain('const database = new Database("example.db");');
    expect(moved).not.toContain('CREATE TABLE example (id integer);');
  });

  it('submits the selected preview and trimmed notes as annotations', () => {
    const pending = makePending([
      {
        question: 'Choose an implementation?',
        multi_select: false,
        options: [
          { label: 'Postgres', preview: 'CREATE TABLE example (id integer);' },
          { label: 'SQLite', preview: 'new Database("example.db")' },
        ],
      },
    ]);
    const { dialog, annotations } = makeDialog(pending);
    dialog.setKeybindings(parseKeybindingBlocks([]));

    dialog.handleInput('n');
    for (const char of '  Keep deployment simple.  ') dialog.handleInput(char);
    expect(strip(dialog.render(80).join('\n'))).toContain('Notes:   Keep deployment simple.  ');
    dialog.handleInput('\r');
    dialog.handleInput('2');
    dialog.handleInput('1');

    expect(annotations).toEqual([
      {
        'Choose an implementation?': {
          preview: 'new Database("example.db")',
          notes: 'Keep deployment simple.',
        },
      },
    ]);
  });

  it('multi-select uses space and number keys to toggle choices', () => {
    const pending = makePending([
      {
        question: 'Pick many?',
        multi_select: true,
        options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
      },
    ]);
    const { dialog, collected } = makeDialog(pending);

    dialog.handleInput(' ');
    dialog.handleInput('\u001B[B');
    dialog.handleInput('\u001B[B');
    dialog.handleInput('3');
    dialog.handleInput('\t');

    const review = strip(dialog.render(80).join('\n'));
    expect(review).toContain('A, C');
    expect(review).not.toContain('Not answered');
    expect(collected).toEqual([]);
  });

  it.each([' ', '2'])('deselects committed multi-select Other with %j', (toggle) => {
    const pending = makePending([
      {
        question: 'Pick many?',
        multi_select: true,
        options: [{ label: 'A' }],
      },
    ]);
    const { dialog } = makeDialog(pending);

    dialog.handleInput('2');
    for (const character of 'Custom value') dialog.handleInput(character);
    dialog.handleInput('\r');
    dialog.handleInput(toggle);
    dialog.handleInput('\t');

    const review = strip(dialog.render(80).join('\n'));
    expect(review).toContain('Not answered');
    expect(review).not.toContain('Custom value');
  });

  it('review shows an unanswered warning and still allows submit', () => {
    const pending = makePending([
      {
        question: 'Q1?',
        multi_select: false,
        options: [{ label: 'A1' }, { label: 'B1' }],
      },
      {
        question: 'Q2?',
        multi_select: false,
        options: [{ label: 'A2' }, { label: 'B2' }],
      },
    ]);
    const { dialog, collected } = makeDialog(pending);

    dialog.handleInput('\t');
    dialog.handleInput('2');

    const before = strip(dialog.render(80).join('\n'));
    expect(before).toContain('Not answered');
    expect(before).toContain('Some questions are still unanswered.');

    dialog.handleInput('\r');
    expect(collected).toHaveLength(1);
    expect(collected[0]?.[0]).toBeUndefined();
    expect(collected[0]?.[1]).toBe('B2');
  });

  it('review cancel dismisses the whole request', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog, collected } = makeDialog(pending);

    dialog.handleInput('\t');
    dialog.handleInput('2');

    expect(collected).toEqual([[]]);
  });

  it('single-select Other input is inline and auto-advances after commit', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        other_label: 'Custom',
        other_description: 'Type your own answer',
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog, collected, methods } = makeDialog(pending);

    dialog.handleInput('3');
    let out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('→ [3] Custom:');
    expect(out).not.toContain('Type your own answer');

    dialog.handleInput('H');
    dialog.handleInput('i');
    dialog.handleInput('\r');

    out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('Review your answer before submit');
    expect(out).toContain('Ready to submit your answers?');
    expect(out).not.toContain('? Ready to submit your answers?');
    expect(out).toContain('Hi');

    dialog.handleInput('1');
    expect(collected).toEqual([['Hi']]);
    expect(methods).toEqual(['enter']);
  });

  it('Other input supports left/right cursor editing before commit', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        other_label: 'Custom',
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);

    dialog.handleInput('3');
    dialog.handleInput('H');
    dialog.handleInput('i');
    dialog.handleInput('\u001B[D');
    dialog.handleInput('!');
    dialog.handleInput('\r');

    const out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('H!i');
    expect(out).toContain('Review your answer before submit');
  });

  it('renders an IME cursor marker while editing Other when focused', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        other_label: 'Custom',
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);

    dialog.focused = true;
    dialog.handleInput('3');

    const out = dialog.render(80).join('\n');
    expect(out).toContain(CURSOR_MARKER);
  });

  it('keeps selected options green even when the cursor returns to them', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);

    dialog.handleInput('\r');
    dialog.handleInput('\u001B[D');

    const out = dialog.render(80).join('\n');
    expect(out).toContain(currentTheme.boldFg('success', '  → [1] A'));
    expect(out).not.toContain(currentTheme.fg('primary', '  → [1] A'));
  });

  it('stretches the border to the full available width', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);

    const lines = dialog.render(80);
    expect(strip(lines[0] ?? '')).toHaveLength(80);
    expect(strip(lines.at(-1) ?? '')).toHaveLength(80);
  });

  it('does not show the submit tab as completed when all questions are answered', () => {
    const pending = makePending([
      {
        question: 'Q1?',
        multi_select: false,
        options: [{ label: 'A1' }, { label: 'B1' }],
      },
      {
        question: 'Q2?',
        multi_select: false,
        options: [{ label: 'A2' }, { label: 'B2' }],
      },
    ]);
    const { dialog } = makeDialog(pending);

    dialog.handleInput('\r');
    dialog.handleInput('\r');

    const out = strip(dialog.render(80).join('\n'));
    expect(out).toContain(' Submit ');
    expect(out).not.toContain('(✓) Submit');
    expect(out).not.toContain('(○) Submit');
  });

  it('renders the active tab with a highlighted background instead of the circle marker', () => {
    const pending = makePending([
      {
        question: 'Q1?',
        header: 'First',
        multi_select: false,
        options: [{ label: 'A1' }, { label: 'B1' }],
      },
      {
        question: 'Q2?',
        header: 'Second',
        multi_select: false,
        options: [{ label: 'A2' }, { label: 'B2' }],
      },
    ]);
    const { dialog } = makeDialog(pending);

    const out = dialog.render(80).join('\n');
    expect(out).toContain(
      chalk
        .bgHex(currentTheme.color('selectionBg'))
        .hex(currentTheme.color('inverseText'))
        .bold(' First '),
    );
    expect(out).not.toContain('(●) First');
  });

  it('preserves Other drafts across tabs and question navigation', () => {
    const pending = makePending([
      {
        question: 'Pick toppings?',
        multi_select: true,
        options: [{ label: 'Cheese' }, { label: 'Pepperoni' }],
      },
    ]);
    const { dialog } = makeDialog(pending);

    dialog.handleInput('3');
    dialog.handleInput('M');
    dialog.handleInput('u');
    dialog.handleInput('s');
    dialog.handleInput('h');
    dialog.handleInput('r');
    dialog.handleInput('o');
    dialog.handleInput('o');
    dialog.handleInput('m');
    dialog.handleInput('\t');

    let out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('Not answered');

    dialog.handleInput('\u001B[D');
    out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('Other: Mushroom');

    dialog.handleInput('\r');
    dialog.handleInput('\r');
    dialog.handleInput('\t');
    out = strip(dialog.render(80).join('\n'));
    expect(out).toContain('Mushroom');
  });

  it('escape dismisses with empty answers array', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog, collected } = makeDialog(pending);
    dialog.handleInput('\u001B');
    expect(collected).toEqual([[]]);
  });

  it('uses remapped confirmation actions for navigation, fields, and toggles', () => {
    const pending = makePending([
      {
        question: 'Pick toppings?',
        multi_select: true,
        options: [{ label: 'Cheese' }, { label: 'Olives' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'alt+n': 'confirm:next',
            'alt+p': 'confirm:previous',
            'alt+t': 'confirm:toggle',
            'alt+f': 'confirm:nextField',
          },
        },
      ]),
    );
    dialog.handleInput('\u001Bn');
    dialog.handleInput('\u001Bt');
    expect(strip(dialog.render(80).join('\n'))).toContain('[✓] Olives');
    dialog.handleInput('\u001Bf');
    expect(strip(dialog.render(80).join('\n'))).toContain('Review your answer before submit');
  });

  it('lets Other input own a printable remapped navigation key', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { x: 'confirm:next' } },
      ]),
    );
    dialog.handleInput('3');
    dialog.handleInput('x');
    expect(strip(dialog.render(80).join('\n'))).toContain('Other: x');
  });

  it('lets notes input own a printable remapped navigation key', () => {
    const pending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A', preview: 'Preview A' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { 'ctrl+e': 'confirm:toggleExplanation', x: 'confirm:next' },
        },
      ]),
    );
    dialog.handleInput('\u0005');
    dialog.handleInput('x');
    expect(strip(dialog.render(80).join('\n'))).toContain('Notes: x');
  });

  it('resolves a remapped n action before the local notes shortcut', () => {
    const pending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [
          { label: 'A', preview: 'Preview A' },
          { label: 'B', preview: 'Preview B' },
        ],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { n: 'confirm:next' } },
      ]),
    );
    dialog.handleInput('n');
    const rendered = strip(dialog.render(80).join('\n'));
    expect(rendered).toContain('Preview B');
    expect(rendered).not.toContain('press n to add notes');
    expect(rendered).not.toContain('type notes');
  });

  it('renders the local n notes hint when n is explicitly unbound', () => {
    const pending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A', preview: 'Preview A' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { n: null, 'ctrl+e': null },
        },
      ]),
    ]);
    expect(strip(dialog.render(80).join('\n'))).toContain('press n to add notes');
    dialog.handleInput('n');
    expect(strip(dialog.render(80).join('\n'))).toContain('type notes');
  });

  it('uses an alternate cancel binding in Other input while bare Escape preserves the draft', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const bindings = parseKeybindingBlocks([
      { context: 'Confirmation', bindings: { 'alt+x': 'confirm:no' } },
    ]);
    const preserved = makeDialog(pending);
    preserved.dialog.setKeybindings(bindings);
    preserved.dialog.handleInput('3');
    preserved.dialog.handleInput('d');
    preserved.dialog.handleInput('\u001B');
    preserved.dialog.handleInput('z');
    expect(strip(preserved.dialog.render(80).join('\n'))).toContain('Other: dz');
    expect(preserved.collected).toEqual([]);

    const cancelled = makeDialog(pending);
    cancelled.dialog.setKeybindings(bindings);
    cancelled.dialog.handleInput('3');
    cancelled.dialog.handleInput('d');
    cancelled.dialog.handleInput('\u001Bx');
    expect(cancelled.collected).toEqual([[]]);
  });

  it('uses an alternate cancel binding to leave notes while bare Escape preserves editing', () => {
    const pending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A', preview: 'Preview A' }],
      },
    ]);
    const bindings = parseKeybindingBlocks([
      {
        context: 'Confirmation',
        bindings: {
          'ctrl+e': 'confirm:toggleExplanation',
          'alt+x': 'confirm:no',
        },
      },
    ]);
    const preserved = makeDialog(pending);
    preserved.dialog.setKeybindings(bindings);
    preserved.dialog.handleInput('\u0005');
    preserved.dialog.handleInput('d');
    preserved.dialog.handleInput('\u001B');
    preserved.dialog.handleInput('z');
    expect(strip(preserved.dialog.render(80).join('\n'))).toContain('Notes: dz');

    const locallyCancelled = makeDialog(pending);
    locallyCancelled.dialog.setKeybindings(bindings);
    locallyCancelled.dialog.handleInput('\u0005');
    locallyCancelled.dialog.handleInput('d');
    locallyCancelled.dialog.handleInput('\u001Bx');
    const rendered = strip(locallyCancelled.dialog.render(80).join('\n'));
    expect(rendered).toContain('Notes: d');
    expect(rendered).not.toContain('type notes');
    expect(locallyCancelled.collected).toEqual([]);
  });

  it('executes a multi-key next-field chord from Other input', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { 'ctrl+k ctrl+n': 'confirm:nextField' },
        },
      ]),
    );
    dialog.handleInput('3');
    dialog.handleInput('d');
    dialog.handleInput('\u000B');
    dialog.handleInput('\u000E');
    expect(strip(dialog.render(80).join('\n'))).toContain('Review your answer before submit');
  });

  it('executes a multi-key next-field chord from notes input', () => {
    const pending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A', preview: 'Preview A' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'ctrl+e': 'confirm:toggleExplanation',
            'ctrl+k ctrl+n': 'confirm:nextField',
          },
        },
      ]),
    );
    dialog.handleInput('\u0005');
    dialog.handleInput('d');
    dialog.handleInput('\u000B');
    dialog.handleInput('\u000E');
    expect(strip(dialog.render(80).join('\n'))).toContain('Review your answer before submit');
  });

  it('executes a semantic next-field key ID from Other input', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { 'alt+f': 'confirm:nextField' },
        },
      ]),
    );
    dialog.handleInput('3');
    dialog.handleInput('d');
    dialog.handleInput('alt+f');
    expect(strip(dialog.render(80).join('\n'))).toContain('Review your answer before submit');
  });

  it('executes a semantic next-field key ID from notes input', () => {
    const pending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A', preview: 'Preview A' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'ctrl+e': 'confirm:toggleExplanation',
            'alt+f': 'confirm:nextField',
          },
        },
      ]),
    );
    dialog.handleInput('\u0005');
    dialog.handleInput('d');
    dialog.handleInput('alt+f');
    expect(strip(dialog.render(80).join('\n'))).toContain('Review your answer before submit');
  });

  it('uses semantic two-key chords in active and nested modes', () => {
    const activePending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [
          { label: 'A', preview: 'Preview A' },
          { label: 'B', preview: 'Preview B' },
        ],
      },
    ]);
    const active = makeDialog(activePending);
    active.dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { 'ctrl+k ctrl+n': 'confirm:next' },
        },
      ]),
    );
    active.dialog.handleInput('ctrl+k');
    active.dialog.handleInput('ctrl+n');
    expect(strip(active.dialog.render(80).join('\n'))).toContain('Preview B');

    const otherPending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const other = makeDialog(otherPending);
    other.dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { 'ctrl+k ctrl+f': 'confirm:nextField' },
        },
      ]),
    );
    other.dialog.handleInput('3');
    other.dialog.handleInput('d');
    other.dialog.handleInput('ctrl+k');
    other.dialog.handleInput('ctrl+f');
    expect(strip(other.dialog.render(80).join('\n'))).toContain(
      'Review your answer before submit',
    );
  });

  it('keeps unavailable printable chords intact in Other and notes input', () => {
    const otherPending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const other = makeDialog(otherPending);
    other.dialog.setKeybindings(
      parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { 'x y': 'confirm:next' } },
      ]),
    );
    other.dialog.handleInput('3');
    other.dialog.handleInput('x');
    other.dialog.handleInput('y');
    expect(strip(other.dialog.render(80).join('\n'))).toContain('Other: xy');

    const notesPending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A', preview: 'Preview A' }],
      },
    ]);
    const notes = makeDialog(notesPending);
    notes.dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'ctrl+e': 'confirm:toggleExplanation',
            'x y': 'confirm:next',
          },
        },
      ]),
    );
    notes.dialog.handleInput('\u0005');
    notes.dialog.handleInput('x');
    notes.dialog.handleInput('y');
    expect(strip(notes.dialog.render(80).join('\n'))).toContain('Notes: xy');
  });

  it('keeps unavailable chord prefixes out of active local controls', () => {
    const previewPending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A', preview: 'Preview A' }],
      },
    ]);
    const notes = makeDialog(previewPending);
    notes.dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { 'n x': 'permission:toggleDebug' },
        },
      ]),
    );
    notes.dialog.handleInput('n');
    expect(strip(notes.dialog.render(80).join('\n'))).toContain('type notes');

    const numericPending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const numeric = makeDialog(numericPending);
    numeric.dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { '2 x': 'permission:toggleDebug' },
        },
      ]),
    );
    numeric.dialog.handleInput('2');
    expect(strip(numeric.dialog.render(80).join('\n'))).toContain(
      'Review your answer before submit',
    );

  });

  it.each([
    ['Left', '\u001B[D', 'left x'],
    ['Right', '\u001B[C', 'right x'],
  ])('keeps an unavailable %s chord prefix out of local tab navigation', (_name, key, chord) => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { [chord]: 'permission:toggleDebug' },
        },
      ]),
    );
    dialog.handleInput(key);
    expect(strip(dialog.render(80).join('\n'))).toContain(
      'Review your answer before submit',
    );
  });

  it('keeps an unavailable longer Tab chord from shadowing default Tab navigation', () => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog } = makeDialog(pending);
    dialog.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: { 'tab x': 'permission:toggleDebug' },
        },
      ]),
    ]);
    dialog.handleInput('\t');
    expect(strip(dialog.render(80).join('\n'))).toContain(
      'Review your answer before submit',
    );
  });

  it('renders effective nested hints and omits unbound optional routes', () => {
    const otherPending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A' }],
      },
    ]);
    const notesPending = makePending([
      {
        question: 'Choose one?',
        multi_select: false,
        options: [{ label: 'A', preview: 'Preview A' }],
      },
    ]);
    const remapped = makeDialog(otherPending);
    remapped.dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'ctrl+e': 'confirm:toggleExplanation',
            'alt+b': 'confirm:previousField',
            'alt+f': 'confirm:nextField',
            'alt+x': 'confirm:no',
          },
        },
      ]),
    );
    remapped.dialog.handleInput('2');
    let hint = strip(remapped.dialog.render(80).join('\n'));
    expect(hint).toContain('type answer');
    expect(hint).toContain('↵ save');
    expect(hint).toContain('alt+b / alt+f switch');
    expect(hint).toContain('alt+x cancel');
    expect(hint).not.toContain('tab switch');
    expect(hint).not.toContain('esc cancel');

    const notes = makeDialog(notesPending);
    notes.dialog.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'Confirmation',
          bindings: {
            'ctrl+e': 'confirm:toggleExplanation',
            'alt+b': 'confirm:previousField',
            'alt+f': 'confirm:nextField',
            'alt+x': 'confirm:no',
          },
        },
      ]),
    );
    notes.dialog.handleInput('\u0005');
    hint = strip(notes.dialog.render(80).join('\n'));
    expect(hint).toContain('type notes');
    expect(hint).toContain('↵ save');
    expect(hint).toContain('alt+b / alt+f switch');
    expect(hint).toContain('alt+x return');
    expect(hint).not.toContain('esc return');

    const unbound = makeDialog(otherPending);
    unbound.dialog.setKeybindings(parseKeybindingBlocks([]));
    unbound.dialog.handleInput('2');
    hint = strip(unbound.dialog.render(80).join('\n'));
    expect(hint).toContain('type answer');
    expect(hint).toContain('↵ save');
    expect(hint).not.toContain('switch');
    expect(hint).not.toContain('cancel');
  });

  it('recovers bare Escape after default cancel bindings are explicitly removed', () => {
    const pending = makePending([
      { question: 'Pick one?', multi_select: false, options: [{ label: 'A' }] },
    ]);
    const bindings = [
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([
        { context: 'Confirmation', bindings: { n: null, escape: null } },
      ]),
    ];
    const active = makeDialog(pending);
    active.dialog.setKeybindings(bindings);
    active.dialog.handleInput('\u001B');
    expect(active.collected).toEqual([[]]);

    const other = makeDialog(pending);
    other.dialog.setKeybindings(bindings);
    other.dialog.handleInput('2');
    other.dialog.handleInput('\u001B');
    expect(other.collected).toEqual([[]]);

    const notes = makeDialog(
      makePending([
        {
          question: 'Choose one?',
          multi_select: false,
          options: [{ label: 'A', preview: 'Preview A' }],
        },
      ]),
    );
    notes.dialog.setKeybindings(bindings);
    notes.dialog.handleInput('\u0005');
    notes.dialog.handleInput('d');
    notes.dialog.handleInput('\u001B');
    const rendered = strip(notes.dialog.render(80).join('\n'));
    expect(rendered).toContain('Notes: d');
    expect(rendered).not.toContain('type notes');
    expect(notes.collected).toEqual([]);
  });

  it.each(['\u0003', '\u0004'])('ctrl shortcut %j dismisses question dialog', (key) => {
    const pending = makePending([
      {
        question: 'Pick one?',
        multi_select: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    ]);
    const { dialog, collected } = makeDialog(pending);
    dialog.handleInput(key);
    expect(collected).toEqual([[]]);
  });
  it('forwards ctrl+o to the global tool-output toggle without answering', () => {
    let toggles = 0;
    const pending = makePending([
      { question: 'Q?', multi_select: false, options: [{ label: 'A' }] },
    ]);
    const { dialog, collected } = makeDialog(pending, () => toggles++);
    dialog.handleInput('\u000F'); // Ctrl+O
    expect(toggles).toBe(1);
    expect(collected).toEqual([]);
  });

  describe('long-content wrapping', () => {
    const longQuestion =
      'Please confirm whether this dangerous shell command should really be executed in the current workspace, including all of its side effects on the filesystem and the network.';
    const longBody =
      'This single-line body description is intentionally written without any embedded newlines so the renderer is forced to wrap it across multiple rows instead of truncating with an ellipsis.';
    const longLabel =
      'Apply changes to every file under the current workspace including nested submodules and lockfiles';
    const longDescription =
      'This option will rewrite history on the remote branch and force-push, so collaborators will need to re-sync their local checkouts before continuing any work.';

    it('wraps the question text across multiple lines instead of truncating', () => {
      const pending = makePending([
        {
          question: longQuestion,
          multi_select: false,
          options: [{ label: 'Yes' }, { label: 'No' }],
        },
      ]);
      const { dialog } = makeDialog(pending);
      const rendered = dialog.render(40);
      const joined = rendered.map((line) => strip(line).trimEnd()).join('\n');
      const flat = flatten(rendered.join('\n'));

      expect(joined).not.toContain('…');
      // Question text should span multiple physical lines.
      expect(joined.split('\n').filter((l) => l.includes('?') || /Please|workspace|side/.test(l)).length).toBeGreaterThan(1);
      // And the full content should still be reconstructable.
      expect(flat).toContain(longQuestion);
    });

    it('wraps body lines that exceed the terminal width', () => {
      const pending = makePending([
        {
          question: 'Q?',
          body: longBody,
          multi_select: false,
          options: [{ label: 'A' }],
        },
      ]);
      const { dialog } = makeDialog(pending);
      const rendered = dialog.render(40);
      const joined = rendered.map((line) => strip(line).trimEnd()).join('\n');
      const flat = flatten(rendered.join('\n'));

      expect(joined).not.toContain('…');
      expect(flat).toContain(longBody);
    });

    it('wraps long option labels and descriptions', () => {
      const pending = makePending([
        {
          question: 'Q?',
          multi_select: false,
          options: [
            {
              label: longLabel,
              description: longDescription,
            },
          ],
        },
      ]);
      const { dialog } = makeDialog(pending);
      const rendered = dialog.render(40);
      const joined = rendered.map((line) => strip(line).trimEnd()).join('\n');
      const flat = flatten(rendered.join('\n'));

      expect(joined).not.toContain('…');
      expect(flat).toContain(longLabel);
      expect(flat).toContain(longDescription);
    });

    it('wraps long questions in the submit-tab review', () => {
      const pending = makePending([
        {
          question: longQuestion,
          multi_select: false,
          options: [{ label: 'Yes' }, { label: 'No' }],
        },
      ]);
      const { dialog } = makeDialog(pending);
      dialog.handleInput('1');
      const rendered = dialog.render(40);
      const joined = rendered.map((line) => strip(line).trimEnd()).join('\n');
      const flat = flatten(rendered.join('\n'));

      expect(joined).toContain('Review your answer before submit');
      expect(joined).not.toContain('…');
      expect(flat).toContain(longQuestion);
    });
  });

});
