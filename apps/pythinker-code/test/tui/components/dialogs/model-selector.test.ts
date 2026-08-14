import type { ModelAlias } from '@pymodel/pythinker-code-sdk';
import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';

import { ModelSelectorComponent } from '#/tui/components/dialogs/model-selector';
import { parseKeybindingBlocks } from '#/tui/keybindings';
import { currentTheme } from '#/tui/theme';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (s: string): string => s.replaceAll(ANSI, '');
const ESC = String.fromCodePoint(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const LEFT = `${ESC}[D`;
const RIGHT = `${ESC}[C`;

function model(
  displayName: string,
  capabilities: string[] = ['thinking'],
  supportEfforts?: string[],
): ModelAlias {
  return {
    provider: 'moonshot-cn',
    model: displayName.toLowerCase().replaceAll(' ', '-'),
    maxContextSize: 200_000,
    displayName,
    capabilities,
    supportEfforts,
  } as unknown as ModelAlias;
}

function text(component: ModelSelectorComponent, width = 120): string {
  return component.render(width).map(strip).join('\n');
}

describe('ModelSelectorComponent', () => {
  it('reports whether resolver, paging, search, or unrelated input was consumed', () => {
    const picker = new ModelSelectorComponent({
      models: {
        first: model('First Model'),
        second: model('Second Model'),
      },
      currentValue: 'first',
      currentEffort: 'medium',
      searchable: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(picker.handleInput(RIGHT)).toBe(true);
    expect(picker.handleInput(`${ESC}[5~`)).toBe(true);
    expect(picker.handleInput(`${ESC}[6~`)).toBe(true);
    expect(picker.handleInput('s')).toBe(true);
    expect(picker.handleInput('\u0000')).toBe(false);
  });

  it('uses remapped effort controls and renders the effective shortcut', () => {
    const onSelect = vi.fn();
    const picker = new ModelSelectorComponent({
      models: { pythinker: model('Kimi K2', ['thinking']) },
      currentValue: 'pythinker',
      currentEffort: 'medium',
      onSelect,
      onCancel: vi.fn(),
    });
    picker.setKeybindings(
      parseKeybindingBlocks([
        {
          context: 'ModelPicker',
          bindings: { right: null, 'alt+l': 'modelPicker:increaseEffort' },
        },
        { context: 'Select', bindings: { enter: 'select:accept' } },
      ]),
    );

    picker.handleInput(RIGHT);
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'pythinker', effort: 'medium' });
    picker.handleInput('\u001Bl');
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'pythinker', effort: 'high' });
    const output = text(picker);
    expect(output).toContain('alt+l');
    expect(output).not.toContain('→');
  });

  it('lays out the provider as a right column and marks the current model', () => {
    const picker = new ModelSelectorComponent({
      models: { pythinker: model('Kimi K2') },
      currentValue: 'pythinker',
      currentEffort: 'medium',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = text(picker);
    // Model name on the left, provider on the right, with the current marker.
    expect(out).toMatch(/❯ Kimi K2\s+moonshot-cn ← current/u);
    expect(out).not.toContain('Kimi K2 (moonshot-cn)');
  });

  it('moves the effort draft with Left/Right (no wraparound)', () => {
    const onSelect = vi.fn();
    const picker = new ModelSelectorComponent({
      models: { pythinker: model('Kimi K2', ['thinking']) },
      currentValue: 'pythinker',
      currentEffort: 'medium',
      onSelect,
      onCancel: vi.fn(),
    });

    // The current model reflects its live effort.
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'pythinker', effort: 'medium' });

    // Right arrow moves one level up (medium -> high).
    picker.handleInput(RIGHT);
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'pythinker', effort: 'high' });

    // Another Right is a no-op at the top end (no wraparound).
    picker.handleInput(RIGHT);
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'pythinker', effort: 'high' });

    // Left walks back down (high -> medium -> low -> off), then stops.
    picker.handleInput(LEFT);
    picker.handleInput(LEFT);
    picker.handleInput(LEFT);
    picker.handleInput(LEFT);
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'pythinker', effort: 'off' });
  });

  it('shows the Left/Right hint only when the model has multiple levels', () => {
    const toggleable = new ModelSelectorComponent({
      models: { pythinker: model('Kimi K2', ['thinking']) },
      currentValue: 'pythinker',
      currentEffort: 'high',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(text(toggleable)).toContain('Thinking  (←→ to switch)');

    const unsupported = new ModelSelectorComponent({
      models: { plain: model('Kimi Plain', ['tool_use']) },
      currentValue: 'plain',
      currentEffort: 'off',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(text(unsupported)).not.toContain('←→ to switch');
  });

  it('offers the fallback low/med/high levels without supportEfforts metadata', () => {
    const picker = new ModelSelectorComponent({
      models: { pythinker: model('Kimi K2', ['thinking']) },
      currentValue: 'pythinker',
      currentEffort: 'medium',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = text(picker);
    expect(out).toContain('off');
    expect(out).toContain('low');
    expect(out).toContain('[ med ]');
    expect(out).toContain('high');
  });

  it('uses the model-declared supportEfforts in canonical order', () => {
    const onSelect = vi.fn();
    const picker = new ModelSelectorComponent({
      models: { kimi: model('Kimi K2', ['thinking'], ['max', 'low', 'high']) },
      currentValue: 'kimi',
      currentEffort: 'high',
      onSelect,
      onCancel: vi.fn(),
    });

    const out = text(picker);
    expect(out).toContain('[ high ]');
    expect(out).toContain('max');
    expect(out).not.toContain('med');

    // Right moves high -> max within the declared set.
    picker.handleInput(RIGHT);
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'kimi', effort: 'max' });
  });

  it('forces always-on models onto a level and unsupported models off', () => {
    const onSelect = vi.fn();
    const picker = new ModelSelectorComponent({
      models: {
        always: model('Kimi Thinking', ['always_thinking'], ['high', 'max']),
        plain: model('Kimi Plain', ['tool_use']),
      },
      currentValue: 'always',
      currentEffort: 'high',
      onSelect,
      onCancel: vi.fn(),
    });

    // Always-on: no Off segment at all.
    const alwaysOut = text(picker);
    expect(alwaysOut).toContain('[ high ]');
    expect(alwaysOut).not.toContain('off');
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'always', effort: 'high' });

    // Unsupported: single muted "Off (Unsupported)" control.
    picker.handleInput(DOWN);
    const plainOut = text(picker);
    expect(plainOut).toContain('Off (Unsupported)');
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'plain', effort: 'off' });
  });

  it('clamps the live effort when it is not in the current model’s set', () => {
    const onSelect = vi.fn();
    const picker = new ModelSelectorComponent({
      models: { kimi: model('Kimi K2', ['thinking'], ['low', 'high']) },
      currentValue: 'kimi',
      currentEffort: 'max',
      onSelect,
      onCancel: vi.fn(),
    });

    // max is not supported by this model — clamped down to high.
    expect(text(picker)).toContain('[ high ]');
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenLastCalledWith({ alias: 'kimi', effort: 'high' });
  });

  it('renders the unsupported thinking control muted', () => {
    const picker = new ModelSelectorComponent({
      models: { plain: model('Kimi Plain', ['tool_use']) },
      currentValue: 'plain',
      currentEffort: 'off',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const raw = picker.render(120).join('\n');
    expect(raw).toContain(currentTheme.fg('textMuted', '  Off (Unsupported)'));
  });

  it('keeps the effort draft when moving across models', () => {
    const onSelect = vi.fn();
    const picker = new ModelSelectorComponent({
      models: {
        plain: model('Kimi Plain', ['tool_use']),
        thinking: model('Kimi Thinking', ['thinking']),
      },
      currentValue: 'plain',
      currentEffort: 'off',
      onSelect,
      onCancel: vi.fn(),
    });

    picker.handleInput(DOWN); // -> thinking model (defaults to first non-off level)
    picker.handleInput(RIGHT); // low -> medium
    picker.handleInput(UP); // -> plain
    picker.handleInput(DOWN); // -> thinking (the medium override persists)
    picker.handleInput('\r');

    expect(onSelect).toHaveBeenCalledWith({ alias: 'thinking', effort: 'medium' });
  });

  it('defaults a capable model to its first level but keeps the current model state', () => {
    const onSelect = vi.fn();
    const picker = new ModelSelectorComponent({
      models: {
        current: model('Pythinker Current', ['thinking']),
        other: model('Pythinker Other', ['thinking'], ['medium', 'high']),
      },
      currentValue: 'current',
      currentEffort: 'off', // thinking deliberately off on the active model
      onSelect,
      onCancel: vi.fn(),
    });

    // The active model reflects its live (off) state.
    expect(text(picker)).toContain('[ off ]');
    picker.handleInput(DOWN); // -> the other thinking-capable model
    // A capable, non-active model defaults to its first non-off level.
    expect(text(picker)).toContain('[ med ]');
    picker.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ alias: 'other', effort: 'medium' });
  });

  it('fuzzy-filters by typing and reports a match count', () => {
    const onCancel = vi.fn();
    const picker = new ModelSelectorComponent({
      models: { k2: model('Kimi K2'), turbo: model('Kimi Turbo') },
      currentValue: 'k2',
      currentEffort: 'high',
      searchable: true,
      onSelect: vi.fn(),
      onCancel,
    });

    picker.handleInput('t');
    picker.handleInput('u');
    const out = text(picker);
    expect(out).toContain('Search: tu');
    expect(out).toContain('Kimi Turbo');
    expect(out).not.toContain('Kimi K2');
    expect(out).toContain('1 / 2');

    // First Esc clears the query, second Esc cancels.
    picker.handleInput(ESC);
    expect(onCancel).not.toHaveBeenCalled();
    picker.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows a "more" indicator when the list overflows a page', () => {
    const models: Record<string, ModelAlias> = {};
    for (let i = 0; i < 12; i++) models[`m${String(i)}`] = model(`Model ${String(i)}`);
    const picker = new ModelSelectorComponent({
      models,
      currentValue: 'm0',
      currentEffort: 'high',
      searchable: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    // Default page size is 8, so 4 of the 12 models sit below the fold.
    expect(text(picker)).toContain('▼ 4 more');
  });

  it('never renders a line wider than the terminal', () => {
    const picker = new ModelSelectorComponent({
      models: {
        long: model('A Very Long Model Display Name That Should Be Truncated Hard'),
        cjk: model('An extremely long model display name that must be truncated correctly'),
      },
      currentValue: 'long',
      currentEffort: 'high',
      searchable: true,
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    for (const width of [20, 40, 80, 120]) {
      for (const line of picker.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it('collapses duplicate aliases for the same underlying model and prefers the canonical alias', () => {
    const onSelect = vi.fn();
    const terra: ModelAlias = {
      provider: 'terra',
      model: 'terra-13b',
      maxContextSize: 200_000,
      displayName: 'Terra 13B',
      capabilities: ['thinking'],
    } as unknown as ModelAlias;
    const picker = new ModelSelectorComponent({
      models: {
        'terra/custom': terra,
        'terra/terra-13b': terra,
      },
      currentValue: 'terra/custom',
      selectedValue: 'terra/custom',
      currentEffort: 'medium',
      onSelect,
      onCancel: vi.fn(),
    });

    const lines = text(picker).split('\n').filter((line) => line.includes('Terra 13B'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('← current');

    picker.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ alias: 'terra/terra-13b', effort: 'medium' });
  });
});
