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
const paneSource = readFileSync(
  join(import.meta.dirname, '../src/components/chat/ConversationPane.vue'),
  'utf8',
);

function mountToc(
  activeTurnId = 'user-2',
  tocItems: ConversationTocItem[] = items,
): VueWrapper {
  return mount(ConversationToc, {
    attachTo: document.body,
    props: { items: tocItems, activeTurnId },
    global: { plugins: [i18n] },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ConversationToc', () => {
  it('renders a line marker for each user prompt with one current location', () => {
    const wrapper = mountToc();
    const rows = wrapper.findAll<HTMLButtonElement>('.toc-row');

    expect(rows).toHaveLength(3);
    expect(wrapper.findAll('.toc-marker')).toHaveLength(3);
    expect(wrapper.find('.toc-node').exists()).toBe(false);
    expect(rows[0]!.attributes('aria-current')).toBeUndefined();
    expect(rows[1]!.attributes('aria-current')).toBe('location');
    expect(source).not.toMatch(/\.toc-row::before\s*\{/u);

    const marker = source.match(/\.toc-marker\s*\{[^}]*\}/u)?.[0];
    expect(marker).toContain('width: var(--space-4)');
    expect(marker).toContain('height: var(--space-05)');
    expect(marker).toContain('background: var(--color-text-faint)');
    expect(source).toMatch(
      /\.toc-row\.active \.toc-marker\s*\{[^}]*background:\s*var\(--color-text-strong\)/u,
    );
    expect(source).toMatch(
      /\.toc-row\s*\{[^}]*grid-template-columns:\s*var\(--space-4\)[^}]*min-height:\s*calc\(var\(--space-2\) \+ var\(--space-05\)\)[^}]*padding:\s*0 var\(--space-1\)/u,
    );
  });

  it('centers the anchor and keeps its expanded list above the composer', () => {
    expect(source).toMatch(
      /\.conversation-toc\s*\{[\s\S]*?top:\s*50%;[\s\S]*?transform:\s*translateY\(-50%\)/u,
    );
    const scroll = source.match(/\.toc-scroll\s*\{[^}]*\}/u)?.[0];
    expect(scroll).toContain('max-height: min(');
    expect(scroll).toContain('50dvh');
    expect(scroll).toContain('var(--chat-dock-height, 0px)');
    expect(scroll).toContain('overflow-y: auto');
    expect(paneSource).toMatch(
      /<section class="con" :class="\{ mobile, 'toc-enabled': conversationToc \}" :style="chatLayoutStyle">/u,
    );
    expect(paneSource).toMatch(
      /@container \(max-width: 952px\)[\s\S]*?\.con\.toc-enabled:not\(\.mobile\) \.content-wrap\.align-center[\s\S]*?padding-left:\s*calc\(var\(--space-8\) \+ var\(--space-8\) \+ var\(--space-8\)\)/u,
    );
  });

  it('keeps the prompt anchor visible at the chat edge beside the sidebar', async () => {
    expect(source).toMatch(
      /\.conversation-toc\s*\{[\s\S]*?left:\s*var\(--space-4\)/u,
    );
    expect(source).toMatch(
      /\.toc-scroll\s*\{[^}]*padding:\s*var\(--space-1\)[^}]*border:\s*\.5px solid transparent[^}]*border-radius:\s*var\(--radius-lg\)/u,
    );
    const expandedSurface = source.match(
      /\.conversation-toc:hover \.toc-scroll,[\s\S]*?\.conversation-toc:focus-within \.toc-scroll\s*\{[^}]*\}/u,
    )?.[0];
    expect(expandedSurface).toContain('background: var(--color-surface-raised)');
    expect(expandedSurface).toContain('border-color: var(--color-line)');
    expect(expandedSurface).toContain('box-shadow: var(--shadow-menu)');
    expect(expandedSurface).toContain('padding: var(--space-2)');
    expect(source).toMatch(
      /\.conversation-toc:hover \.toc-marker,[\s\S]*?\.conversation-toc:focus-within \.toc-marker\s*\{\s*display:\s*none;\s*\}/u,
    );
    expect(source).toMatch(/\.toc-label\s*\{[^}]*display:\s*none;/u);
    expect(source).toMatch(
      /\.conversation-toc:hover \.toc-label,[\s\S]*?\.conversation-toc:focus-within \.toc-label\s*\{[^}]*display:\s*block;/u,
    );
    expect(source).toMatch(
      /\.conversation-toc:hover \.toc-row,[\s\S]*?\.conversation-toc:focus-within \.toc-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*min-height:\s*calc\(var\(--space-6\) \+ var\(--space-1\)\)[^}]*padding:\s*var\(--space-1\) var\(--space-2\)/u,
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

  it('keeps the line anchor visible when expanded labels overlap the reading column', async () => {
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

    expect(wrapper.get('.conversation-toc').classes()).not.toContain('toc-clipped');
  });

  it('selects the prompt represented by a line', async () => {
    const wrapper = mountToc();

    await wrapper.findAll('.toc-row')[2]!.trigger('click');

    expect(wrapper.emitted('select')).toEqual([['user-3']]);
  });

  it('highlights only the hovered or focused row with two prompts', async () => {
    const wrapper = mountToc('user-2', items.slice(0, 2));
    const rows = wrapper.findAll<HTMLButtonElement>('.toc-row');
    const firstRow = rows[0];
    const secondRow = rows[1];
    if (!firstRow || !secondRow) throw new Error('expected two prompt rows');

    expect(secondRow.classes()).toContain('highlighted');

    await firstRow.trigger('mouseenter');
    expect(firstRow.classes()).toContain('highlighted');
    expect(secondRow.classes()).not.toContain('highlighted');

    await firstRow.trigger('mouseleave');
    firstRow.element.focus();
    await nextTick();
    expect(firstRow.classes()).toContain('highlighted');
    expect(secondRow.classes()).not.toContain('highlighted');
  });

  it('keeps an explicitly selected prompt active while the anchor scrolls', () => {
    expect(paneSource).toMatch(
      /if \(following\.value && distanceFromBottom\(\) <= BOTTOM_THRESHOLD\)/u,
    );
    expect(paneSource).toMatch(
      /function scrollToTurn\(turnId: string\): void \{[\s\S]*?activeTurnId\.value = turnId;[\s\S]*?target\.scrollIntoView/u,
    );
  });

  it('keeps the collapsed prompt anchor free of padded row cards', () => {
    expect(source).not.toMatch(
      /^\.toc-row\.active\s*\{[^}]*background:\s*var\(--color-selected\)/mu,
    );
    expect(source).toMatch(
      /\.conversation-toc:hover \.toc-row\.highlighted,[\s\S]*?\.conversation-toc:focus-within \.toc-row\.highlighted\s*\{[^}]*background:\s*var\(--color-selected\)/u,
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
