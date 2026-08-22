import { describe, expect, it, vi } from 'vitest';

import {
  AuthenticationMethodSelectorComponent,
  PlatformSelectorComponent,
} from '#/tui/components/dialogs/platform-selector';

const SGR = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'gu');

describe('PlatformSelectorComponent', () => {
  it('renders the Pi authentication-method selector and returns the selected method', () => {
    const onSelect = vi.fn();
    const component = new AuthenticationMethodSelectorComponent({
      onSelect,
      onCancel: vi.fn(),
    });
    const output = component.render(84).join('\n').replaceAll(SGR, '');

    expect(output).toContain('Select authentication method:');
    expect(output).toContain('→ Sign in with an account');
    expect(output).toContain('  Sign in with an API key');

    component.handleInput('\u001B[B');
    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith('api_key');
  });

  it('renders all supplied providers with Pi status, search, and paging', () => {
    const onSelect = vi.fn();
    const component = new PlatformSelectorComponent({
      providers: [
        { value: 'amazon-bedrock', label: 'Amazon Bedrock', status: 'unconfigured' },
        { value: 'anthropic', label: 'Anthropic', status: 'configured' },
        { value: 'azure', label: 'Azure OpenAI', status: 'unconfigured' },
        { value: 'baseten', label: 'Baseten', status: 'unconfigured' },
        { value: 'cerebras', label: 'Cerebras', status: 'unconfigured' },
        { value: 'cloudflare-ai', label: 'Cloudflare AI Gateway', status: 'unconfigured' },
        { value: 'cloudflare-workers', label: 'Cloudflare Workers AI', status: 'unconfigured' },
        { value: 'deepseek', label: 'DeepSeek', status: 'unconfigured' },
        { value: 'fireworks', label: 'Fireworks', status: 'unconfigured' },
      ],
      onSelect,
      onCancel: vi.fn(),
    });
    const output = component.render(84).join('\n').replaceAll(SGR, '');

    expect(output).toContain('Select provider to configure:');
    expect(output).toContain('>');
    expect(output).toContain('→ Amazon Bedrock • unconfigured');
    expect(output).toContain('Anthropic ✓ configured');
    expect(output).toContain('(1/9)');

    component.handleInput('d');
    component.handleInput('e');
    component.handleInput('e');
    component.handleInput('p');
    const filtered = component.render(84).join('\n').replaceAll(SGR, '');
    expect(filtered).toContain('> deep');
    expect(filtered).toContain('DeepSeek');
    expect(filtered).not.toContain('Amazon Bedrock');

    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith('deepseek');
  });

  it('keeps configured providers selectable so their API key can be replaced', () => {
    const onSelect = vi.fn();
    const component = new PlatformSelectorComponent({
      providers: [{ value: 'anthropic', label: 'Anthropic', status: 'configured' }],
      onSelect,
      onCancel: vi.fn(),
    });

    component.handleInput('\r');

    expect(onSelect).toHaveBeenCalledWith('anthropic');
  });
});
