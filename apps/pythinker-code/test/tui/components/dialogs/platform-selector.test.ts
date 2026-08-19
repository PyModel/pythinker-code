import { describe, expect, it, vi } from 'vitest';

import { OPENAI_CODEX_OAUTH_PLATFORM_ID } from '@pymodel/pythinker-code-oauth';

import { PlatformSelectorComponent } from '#/tui/components/dialogs/platform-selector';

const SGR = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'gu');

describe('PlatformSelectorComponent', () => {
  it('offers OpenAI Codex OAuth without a managed account entry', () => {
    const onSelect = vi.fn();
    const component = new PlatformSelectorComponent({ onSelect, onCancel: vi.fn() });
    const output = component.render(100).join('\n').replaceAll(SGR, '');

    expect(output).toContain('OpenAI Codex (OAuth)');
    expect(output).not.toContain('Pythinker (OAuth)');

    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith(OPENAI_CODEX_OAUTH_PLATFORM_ID);
  });
});
