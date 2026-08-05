import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';

import { EffortSelectorComponent } from '#/tui/components/dialogs/effort-selector';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (s: string): string => s.replaceAll(ANSI, '');
const ESC = String.fromCodePoint(27);
const DOWN = `${ESC}[B`;

function make(levels: readonly string[] = ['off', 'low', 'medium', 'high'], currentValue = 'medium') {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const component = new EffortSelectorComponent({
    levels,
    currentValue,
    modelName: 'Kimi K2',
    onSelect,
    onCancel,
  });
  return { component, onSelect, onCancel };
}

describe('EffortSelectorComponent', () => {
  it('uses remapped Select navigation and honors an unbound Down key', () => {
    const { component, onSelect } = make(['low', 'medium'], 'low');
    component.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([{ context: 'Select', bindings: { 'alt+j': 'select:next', down: null } }]),
    ]);

    component.handleInput(DOWN);
    component.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith('low');

    component.handleInput('alt+j');
    component.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith('medium');
  });

  it('renders title, hint, levels, and the current marker', () => {
    const { component } = make();
    const out = component.render(80).map(strip).join('\n');

    expect(out).toContain('Thinking effort');
    expect(out).toContain('Kimi K2');
    expect(out).toContain('↑↓ navigate · Enter select · Esc cancel');
    expect(out).toContain('medium ← current');
    // The cursor starts on the current level.
    expect(out).toMatch(/❯ medium/);
  });

  it('selects the level under the cursor with Enter', () => {
    const { component, onSelect } = make();
    component.handleInput(DOWN); // medium -> high
    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith('high');
  });

  it('keeps PageUp and PageDown local to the effort list', () => {
    const { component, onSelect } = make(
      Array.from({ length: 10 }, (_, index) => `level-${String(index)}`),
      'level-0',
    );

    component.handleInput(`${ESC}[6~`);
    component.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith('level-8');

    component.handleInput(`${ESC}[5~`);
    component.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith('level-0');
  });

  it('cancels with Esc without selecting', () => {
    const { component, onSelect, onCancel } = make();
    component.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('never renders a line wider than the terminal', () => {
    const { component } = make(['off', 'low', 'medium', 'high', 'xhigh', 'max'], 'max');
    for (const width of [20, 40, 80]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });
});
