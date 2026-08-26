import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import ConversationToc, {
  type ConversationTocItem,
} from '../src/components/chat/ConversationToc.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { conversation: { toc: 'Conversation outline' } } },
});

const items: ConversationTocItem[] = [
  { id: 'user-1', role: 'user', no: 1, title: 'Define the feature' },
  { id: 'user-2', role: 'user', no: 2, title: 'Choose the timeline' },
  { id: 'user-3', role: 'user', no: 3, title: 'Verify keyboard access' },
];

const source = readFileSync(
  join(import.meta.dirname, '../src/components/chat/ConversationToc.vue'),
  'utf8',
);

function mountToc(activeTurnId = 'user-2'): VueWrapper {
  return mount(ConversationToc, {
    attachTo: document.body,
    props: { items, activeTurnId },
    global: { plugins: [i18n] },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ConversationToc', () => {
  it('renders a connected user-prompt timeline with one current location', () => {
    const wrapper = mountToc();
    const rows = wrapper.findAll<HTMLButtonElement>('.toc-row');

    expect(rows).toHaveLength(3);
    expect(wrapper.findAll('.toc-node')).toHaveLength(3);
    expect(rows[0]!.attributes('aria-current')).toBeUndefined();
    expect(rows[1]!.attributes('aria-current')).toBe('location');
    expect(source).toMatch(/\.toc-row::before\s*\{/u);
  });

  it('keeps the timeline visible at the chat edge beside the sidebar', async () => {
    expect(source).toMatch(
      /\.conversation-toc\s*\{[\s\S]*?left:\s*var\(--space-4\)/u,
    );
    expect(source).toMatch(
      /\.toc-scroll\s*\{[^}]*padding:\s*var\(--space-2\)[^}]*border:\s*\.5px solid transparent[^}]*border-radius:\s*var\(--radius-lg\)/u,
    );
    const expandedSurface = source.match(
      /\.conversation-toc:hover \.toc-scroll,[\s\S]*?\.conversation-toc:focus-within \.toc-scroll\s*\{[^}]*\}/u,
    )?.[0];
    expect(expandedSurface).toContain('background: var(--color-surface-raised)');
    expect(expandedSurface).toContain('border-color: var(--color-line)');
    expect(expandedSurface).toContain('box-shadow: var(--shadow-menu)');
    expect(source).toMatch(
      /\.toc-row\s*\{[^}]*padding:\s*var\(--space-1\) var\(--space-2\)/u,
    );
    expect(source).toMatch(
      /\.toc-row:hover\s*\{\s*background:\s*var\(--color-hover\)/u,
    );
    const wrapper = mountToc();
    const nav = wrapper.get<HTMLElement>('.conversation-toc').element;
    const parent = document.createElement('div');
    Object.defineProperty(nav, 'offsetParent', { configurable: true, value: parent });
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 288, width: 24 }),
    );
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 272, width: 1_168 }),
    );

    await nextTick();

    expect(wrapper.get('.conversation-toc').classes()).not.toContain('toc-clipped');
  });

  it('hides the timeline before it overlaps the chat reading column', async () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(): void {}
      disconnect(): void {}
    });
    const wrapper = mountToc();
    const nav = wrapper.get<HTMLElement>('.conversation-toc').element;
    const parent = document.createElement('div');
    const content = document.createElement('div');
    content.className = 'content-wrap';
    parent.append(content);
    Object.defineProperty(nav, 'offsetParent', { configurable: true, value: parent });
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 16, width: 40 }),
    );
    vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 800 }),
    );
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 48, width: 752 }),
    );

    await nextTick();
    expect(resize).toBeDefined();
    resize?.([], {} as ResizeObserver);
    await nextTick();

    expect(wrapper.get('.conversation-toc').classes()).toContain('toc-clipped');
  });

  it('selects the prompt represented by a node', async () => {
    const wrapper = mountToc();

    await wrapper.findAll('.toc-row')[2]!.trigger('click');

    expect(wrapper.emitted('select')).toEqual([['user-3']]);
  });

  it('keeps the collapsed timeline free of padded row cards', () => {
    expect(source).not.toMatch(
      /^\.toc-row\.active\s*\{[^}]*background:\s*var\(--color-selected\)/mu,
    );
    expect(source).toMatch(
      /\.conversation-toc:hover \.toc-row\.active,[\s\S]*?\.conversation-toc:focus-within \.toc-row\.active\s*\{[^}]*background:\s*var\(--color-selected\)/u,
    );
  });

  it('moves one roving focus target with arrow, Home, and End keys', async () => {
    const wrapper = mountToc();
    const rows = wrapper.findAll<HTMLButtonElement>('.toc-row');

    rows[1]!.element.focus();
    await rows[1]!.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]!.element);

    await rows[2]!.trigger('keydown', { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]!.element);

    await rows[0]!.trigger('keydown', { key: 'End' });
    expect(document.activeElement).toBe(rows[2]!.element);
  });

  it('keeps the active prompt visible inside a long outline', async () => {
    const scrollIntoView = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      disconnect(): void {}
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const wrapper = mountToc('user-1');
    scrollIntoView.mockClear();

    await wrapper.setProps({ activeTurnId: 'user-3' });

    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    vi.unstubAllGlobals();
  });
});
