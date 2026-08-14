import type { ModelAlias } from '@pymodel/pythinker-code-sdk';
import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TabbedModelSelectorComponent } from '#/tui/components/dialogs/tabbed-model-selector';
import { parseKeybindingBlocks } from '#/tui/keybindings';
import { darkColors } from '#/tui/theme/colors';

const ESC = String.fromCodePoint(27);
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replaceAll(SGR, '');
const TAB = '\t';
const SHIFT_TAB = `${ESC}[Z`;
const RIGHT = `${ESC}[C`;
const selectionBackgroundSgr = (): string =>
  chalk.bgHex(darkColors.selectionBg)('x').split('x')[0]!;
const inverseTextSgr = (): string =>
  chalk.hex(darkColors.inverseText)('x').split('x')[0]!;

function model(displayName: string, provider: string): ModelAlias {
  return {
    provider,
    model: displayName.toLowerCase().replaceAll(' ', '-'),
    maxContextSize: 200_000,
    displayName,
    capabilities: ['thinking'],
  } as unknown as ModelAlias;
}

function make(): {
  component: TabbedModelSelectorComponent;
  onSelect: ReturnType<typeof vi.fn>;
} {
  const onSelect = vi.fn();
  const component = new TabbedModelSelectorComponent({
    models: {
      k2: model('Kimi K2', 'moonshot-cn'),
      gpt: model('GPT-5', 'openai'),
    },
    currentValue: 'k2',
    currentEffort: 'off',
    onSelect,
    onCancel: vi.fn(),
  });
  component.focused = true;
  return { component, onSelect };
}

describe('TabbedModelSelectorComponent', () => {
  let previousLevel: typeof chalk.level;
  beforeAll(() => {
    previousLevel = chalk.level;
    chalk.level = 3;
  });
  afterAll(() => {
    chalk.level = previousLevel;
  });

  it('renders an "All" + per-provider tab strip', () => {
    const out = strip(make().component.render(120).join('\n'));
    expect(out).toContain('All');
    expect(out).toContain('moonshot-cn');
    expect(out).toContain('openai');
  });

  it('highlights the active tab with the contrast-safe selection pair', () => {
    const raw = make().component.render(120).join('\n');
    expect(raw).toContain(selectionBackgroundSgr());
    expect(raw).toContain(inverseTextSgr());
  });

  it('opens on the current model provider by default', () => {
    const { component } = make();
    const out = strip(component.render(120).join('\n'));
    expect(component.activeTabId()).toBe('moonshot-cn');
    expect(out).toContain('Kimi K2');
    expect(out).not.toContain('GPT-5');
    expect(out).toMatch(/❯ Kimi K2\s+moonshot-cn ← current/u);
  });

  it('opens the matching provider when the current canonical alias is stale', () => {
    const component = new TabbedModelSelectorComponent({
      models: {
        minimax: model('MiniMax M3', 'minimax-anthropic'),
        sol: model('GPT-5.6-Sol', 'openai-codex'),
      },
      currentValue: 'openai-codex/codex-auto-review',
      currentEffort: 'max',
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = strip(component.render(120).join('\n'));
    expect(component.activeTabId()).toBe('openai-codex');
    expect(out).toContain('GPT-5.6-Sol');
    expect(out).not.toContain('MiniMax M3');
    expect(out).not.toContain('← current');
  });

  it('cycles provider tabs with Tab and Shift-Tab', () => {
    const { component } = make();
    // tabs = [All, Pythinker Code, openai]; active starts on Pythinker Code.
    // One Tab → openai, whose list shows GPT-5 and not Kimi K2.
    component.handleInput(TAB);
    let out = strip(component.render(120).join('\n'));
    expect(out).toContain('GPT-5');
    expect(out).not.toContain('Kimi K2');

    component.handleInput(SHIFT_TAB);
    out = strip(component.render(120).join('\n'));
    expect(out).toContain('Kimi K2');
    expect(out).not.toContain('GPT-5');
  });

  it('uses remapped tab switching and renders the effective shortcut', () => {
    const { component } = make();
    component.setKeybindings(
      parseKeybindingBlocks([
        { context: 'Tabs', bindings: { tab: null, 'alt+l': 'tabs:next' } },
      ]),
    );

    component.handleInput(TAB);
    expect(strip(component.render(120).join('\n'))).toContain('Kimi K2');
    component.handleInput('\u001Bl');
    const output = strip(component.render(120).join('\n'));
    expect(output).toContain('GPT-5');
    expect(output).not.toContain('Kimi K2');
    expect(output).toContain('alt+l');
    expect(output).not.toContain('Tab toggle provider');
  });

  it('lets the active selector consume Left/Right before tab navigation', () => {
    const { component, onSelect } = make();

    component.handleInput(RIGHT); // off -> low for k2
    const output = strip(component.render(120).join('\n'));
    expect(component.activeTabId()).toBe('moonshot-cn');
    expect(output).toContain('Kimi K2');

    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ alias: 'k2', effort: 'low' });
  });

  it('frames the tab strip with a blank line above and below it', () => {
    const lines = make().component.render(120).map(strip);
    const hintIdx = lines.findIndex((l) => l.includes('navigate') && l.includes('Esc cancel'));
    const stripIdx = lines.findIndex((l) => l.includes('All') && l.includes('openai'));
    expect(hintIdx).toBeGreaterThanOrEqual(0);
    expect(lines[hintIdx + 1]).toBe(''); // blank between hint and tabs
    expect(stripIdx).toBe(hintIdx + 2);
    expect(lines[stripIdx + 1]).toBe(''); // blank between tabs and list
  });

  it('mentions the Tab provider switch first in the hint line', () => {
    const lines = make().component.render(120).map(strip);
    const hint = lines.find((l) => l.includes('navigate') && l.includes('Esc cancel'));
    expect(hint).toBeDefined();
    expect(hint).toContain('Tab toggle provider');
    // It comes first, before the navigation hint.
    expect(hint!.indexOf('Tab toggle provider')).toBeLessThan(hint!.indexOf('↑↓ navigate'));
  });

  it('deduplicates the same underlying model in both the All tab and provider tab', () => {
    const onSelect = vi.fn();
    const terra = model('Terra 13B', 'terra');
    const component = new TabbedModelSelectorComponent({
      models: {
        'terra/custom': terra,
        'terra/terra-13b': terra,
        gpt: model('GPT-5', 'openai'),
      },
      currentValue: 'terra/custom',
      selectedValue: 'terra/custom',
      currentEffort: 'medium',
      onSelect,
      onCancel: vi.fn(),
    });
    component.focused = true;

    const providerLines = strip(component.render(120).join('\n'))
      .split('\n')
      .filter((line) => line.includes('Terra 13B'));
    expect(providerLines).toHaveLength(1);

    component.handleInput(SHIFT_TAB);
    const allLines = strip(component.render(120).join('\n'))
      .split('\n')
      .filter((line) => line.includes('Terra 13B'));
    expect(allLines).toHaveLength(1);

    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith({ alias: 'terra/terra-13b', effort: 'low' });
  });
});
