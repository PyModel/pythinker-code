import type { ExperimentalFeatureState } from '@pythoughts/pythinker-code-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  ExperimentsSelectorComponent,
  type ExperimentalFeatureDraftChange,
} from '#/tui/components/dialogs/experiments-selector';
import { defaultKeybindings, parseKeybindingBlocks } from '#/tui/keybindings';


const ANSI = /\u001B\[[0-9;]*m/g;
const ESC = String.fromCodePoint(27);
const ENTER = '\r';

function strip(text: string): string {
  return text.replaceAll(ANSI, '');
}

function feature(
  overrides: Partial<ExperimentalFeatureState> = {},
): ExperimentalFeatureState {
  return {
    id: 'micro_compaction',
    title: 'Micro compaction',
    description: 'Trim older tool results.',
    surface: 'core',
    env: 'PYTHINKER_CODE_EXPERIMENTAL_MICRO_COMPACTION',
    defaultEnabled: true,
    enabled: true,
    source: 'default',
    ...overrides,
  };
}

function text(component: ExperimentsSelectorComponent, width = 120): string {
  return component.render(width).map(strip).join('\n');
}

describe('ExperimentsSelectorComponent', () => {
  it('uses remapped Select navigation and honors an unbound Down key', () => {
    const onApply = vi.fn();
    const selector = new ExperimentsSelectorComponent({
      features: [
        feature({ id: 'agent_memory' }),
        feature({ id: 'vim_mode', title: 'Second feature' }),
      ],
      onApply,
      onCancel: vi.fn(),
    });
    selector.setKeybindings([
      ...defaultKeybindings(),
      ...parseKeybindingBlocks([{ context: 'Select', bindings: { 'alt+j': 'select:next', down: null } }]),
    ]);

    selector.handleInput(`${ESC}[B`);
    selector.handleInput(' ');
    selector.handleInput(ENTER);
    expect(onApply).toHaveBeenLastCalledWith([{ id: 'agent_memory', enabled: false }]);

    selector.handleInput('alt+j');
    selector.handleInput(' ');
    selector.handleInput(ENTER);
    expect(onApply).toHaveBeenLastCalledWith([
      { id: 'agent_memory', enabled: false },
      { id: 'vim_mode', enabled: false },
    ]);
  });

  it('renders searchable feature toggles with source details', () => {
    const selector = new ExperimentsSelectorComponent({
      features: [
        feature({ enabled: true, source: 'config', configValue: true }),
      ],
      onApply: vi.fn(),
      onCancel: vi.fn(),
    });

    const out = text(selector);

    expect(out).toContain(' Experimental features  (type to search)');
    expect(out).toContain(' ↑↓ navigate · Space toggle · Enter apply · Esc cancel');
    expect(out).toContain('  ❯ Micro compaction  enabled');
    expect(out).toContain('    id micro_compaction · config · PYTHINKER_CODE_EXPERIMENTAL_MICRO_COMPACTION');
    expect(out).toContain('    Trim older tool results.');
    expect(out).toContain(' [ Apply changes and reload ]  no changes');
  });

  it('drafts changes with Space and applies them with Enter', () => {
    const onApply = vi.fn<(changes: readonly ExperimentalFeatureDraftChange[]) => void>();
    const first = feature();
    const selector = new ExperimentsSelectorComponent({
      features: [first],
      onApply,
      onCancel: vi.fn(),
    });

    selector.handleInput(' ');

    expect(onApply).not.toHaveBeenCalled();
    expect(text(selector)).toContain('  ❯ Micro compaction  disabled');
    expect(text(selector)).toContain(
      '    id micro_compaction · default · PYTHINKER_CODE_EXPERIMENTAL_MICRO_COMPACTION · modified',
    );
    expect(text(selector)).toContain(' [ Apply changes and reload ]  1 change');

    selector.handleInput(ENTER);

    expect(onApply).toHaveBeenCalledWith([
      { id: 'micro_compaction', enabled: false },
    ]);
  });

  it('does not draft changes for env-locked features', () => {
    const onApply = vi.fn<(changes: readonly ExperimentalFeatureDraftChange[]) => void>();
    const selector = new ExperimentsSelectorComponent({
      features: [
        feature({
          enabled: true,
          source: 'env',
        }),
      ],
      onApply,
      onCancel: vi.fn(),
    });

    selector.handleInput(' ');
    selector.handleInput(ENTER);

    expect(text(selector)).toContain('  ❯ Micro compaction  enabled');
    expect(text(selector)).toContain(' [ Apply changes and reload ]  no changes');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('filters by typing and clears the query before cancelling', () => {
    const onCancel = vi.fn();
    const selector = new ExperimentsSelectorComponent({
      features: [feature()],
      onApply: vi.fn(),
      onCancel,
    });

    selector.handleInput('m');
    selector.handleInput('i');
    selector.handleInput('c');
    expect(text(selector)).toContain('Search: mic');
    expect(text(selector)).toContain('Micro compaction');

    selector.handleInput(ESC);
    expect(onCancel).not.toHaveBeenCalled();
    selector.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('keeps PageUp and PageDown local to the experiments list', () => {
    const onApply = vi.fn();
    const ids = [
      'agent_fork_context',
      'agent_memory',
      'agent_teams',
      'coordinator_mode',
      'lsp',
      'micro_compaction',
      'powershell',
      'task_graph',
      'token_budget',
      'vim_mode',
    ] as const;
    const selector = new ExperimentsSelectorComponent({
      features: ids.map((id) => feature({ id, title: id })),
      onApply,
      onCancel: vi.fn(),
    });

    selector.handleInput(`${ESC}[6~`);
    selector.handleInput(' ');
    selector.handleInput(ENTER);
    expect(onApply).toHaveBeenLastCalledWith([{ id: 'token_budget', enabled: false }]);

    selector.handleInput(`${ESC}[5~`);
    selector.handleInput(' ');
    selector.handleInput(ENTER);
    expect(onApply).toHaveBeenLastCalledWith([
      { id: 'agent_fork_context', enabled: false },
      { id: 'token_budget', enabled: false },
    ]);
  });
});
