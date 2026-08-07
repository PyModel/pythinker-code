import { describe, expect, it, vi } from 'vitest';

import { CATALOG_PLATFORM_VALUE_PREFIX } from '@pythoughts/pythinker-code-sdk';
import { PlatformSelectorComponent } from '#/tui/components/dialogs/platform-selector';
import { promptPlatformSelection } from '#/tui/commands/prompts';

const SGR = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'gu');

function rendered(component: PlatformSelectorComponent): string {
  return component.render(120).join('\n').replaceAll(SGR, '');
}

describe('PlatformSelectorComponent', () => {
  it('features the requested API connections and searches the full catalog', () => {
    const onSelect = vi.fn();
    const component = new PlatformSelectorComponent({
      catalog: {
        deepseek: {
          id: 'deepseek',
          name: 'DeepSeek',
          npm: '@ai-sdk/openai-compatible',
          api: 'https://api.deepseek.com',
        },
        'zai-coding-plan': {
          id: 'zai-coding-plan',
          name: 'Z.AI Coding Plan',
          npm: '@ai-sdk/openai-compatible',
          api: 'https://api.z.ai/api/coding/paas/v4',
        },
        'minimax-coding-plan': {
          id: 'minimax-coding-plan',
          name: 'MiniMax Coding Plan',
          npm: '@ai-sdk/anthropic',
          api: 'https://api.minimax.io/anthropic/v1',
        },
        'kimi-for-coding': {
          id: 'kimi-for-coding',
          name: 'Kimi For Coding',
          npm: '@ai-sdk/anthropic',
          api: 'https://api.kimi.com/coding/v1',
        },
        fireworks: {
          id: 'fireworks',
          name: 'Fireworks AI',
          npm: '@ai-sdk/openai-compatible',
          api: 'https://api.fireworks.example.test/v1',
        },
        vertex: {
          id: 'google-vertex-anthropic',
          name: 'Vertex Anthropic',
          npm: '@ai-sdk/google-vertex/anthropic',
        },
      },
      onSelect,
      onCancel: vi.fn(),
    });

    const output = rendered(component);
    expect(output).toContain('OpenAI Codex (OAuth)');
    expect(output).not.toContain('Kimi (OAuth)');
    expect(output.indexOf('OpenAI Codex (OAuth)')).toBeLessThan(output.indexOf('DeepSeek API'));
    expect(output).toContain('DeepSeek API');
    expect(output).toContain('GLM Coding Plan');
    expect(output).toContain('MiniMax Token Plan');
    expect(output).toContain('Kimi For Coding');
    expect(output.indexOf('DeepSeek API')).toBeLessThan(output.indexOf('Fireworks AI'));
    expect(output).not.toContain('Vertex Anthropic');

    component.handleInput('f');
    expect(rendered(component)).toContain('Search: f');
    expect(rendered(component)).toContain('Fireworks AI');
    component.handleInput('\r');
    expect(onSelect).toHaveBeenCalledWith(`${CATALOG_PLATFORM_VALUE_PREFIX}fireworks`);
  });

  it('omits featured providers that are missing or do not support one-key connections', () => {
    const component = new PlatformSelectorComponent({
      catalog: {
        deepseek: {
          id: 'deepseek',
          npm: '@ai-sdk/openai-compatible',
          api: 'https://api.deepseek.com',
        },
        'kimi-for-coding': {
          id: 'kimi-for-coding',
          npm: '@ai-sdk/google-vertex/anthropic',
          api: 'https://api.kimi.com/coding/v1',
        },
      },
      onSelect: vi.fn(),
      onCancel: vi.fn(),
    });

    const output = rendered(component);
    expect(output).toContain('DeepSeek API');
    const values = (
      component as unknown as { readonly opts: { readonly options: readonly { readonly value: string }[] } }
    ).opts.options.map((option) => option.value);
    expect(values).toContain(`${CATALOG_PLATFORM_VALUE_PREFIX}deepseek`);
    expect(values).not.toContain(`${CATALOG_PLATFORM_VALUE_PREFIX}zai-coding-plan`);
    expect(values).not.toContain(`${CATALOG_PLATFORM_VALUE_PREFIX}minimax-coding-plan`);
    expect(values).not.toContain(`${CATALOG_PLATFORM_VALUE_PREFIX}kimi-for-coding`);
  });

  it('loads the live catalog before returning a connection selection', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          deepseek: {
            id: 'deepseek',
            name: 'DeepSeek',
            npm: '@ai-sdk/openai-compatible',
            api: 'https://api.deepseek.com',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    let mounted: PlatformSelectorComponent | undefined;
    const host = {
      cancelInFlight: undefined,
      mountEditorReplacement: (component: PlatformSelectorComponent) => {
        mounted = component;
      },
      restoreEditor: vi.fn(),
      showLoginProgressSpinner: vi.fn(() => ({ stop: vi.fn() })),
      showStatus: vi.fn(),
    };

    try {
      const selection = promptPlatformSelection(host as never);
      await vi.waitFor(() => expect(mounted).toBeDefined());
      mounted!.handleInput('d');
      mounted!.handleInput('\r');

      await expect(selection).resolves.toMatchObject({
        platformId: `${CATALOG_PLATFORM_VALUE_PREFIX}deepseek`,
        catalog: { deepseek: { id: 'deepseek' } },
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
