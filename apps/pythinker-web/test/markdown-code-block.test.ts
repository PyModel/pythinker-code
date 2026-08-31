import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import webI18n from '../src/i18n';
import Markdown from '../src/components/chat/Markdown.vue';

vi.mock('markstream-vue', () => {
  const noop = (): void => undefined;
  return {
    MarkdownRender: defineComponent({
      name: 'MarkdownRenderStub',
      props: ['content'],
      setup(props) {
        return () => String(props.content ?? '');
      },
    }),
    enableKatex: noop,
    enableMermaid: noop,
    setKaTeXWorker: noop,
    clearKaTeXWorker: noop,
    setMermaidWorker: noop,
    clearMermaidWorker: noop,
  };
});
vi.mock('markstream-vue/workers/katexRenderer.worker?worker&type=module', () => ({
  default: class {
    terminate(): void {}
  },
}));
vi.mock('markstream-vue/workers/mermaidParser.worker?worker&type=module', () => ({
  default: class {
    terminate(): void {}
  },
}));

const markdownSource = readFileSync(
  join(import.meta.dirname, '../src/components/chat/Markdown.vue'),
  'utf8',
);

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

function mountMarkdown(text: string): VueWrapper {
  wrapper = mount(Markdown, {
    props: { text },
    attachTo: document.body,
    global: { plugins: [webI18n] },
  });
  return wrapper;
}

/** A stand-in for one markstream-rendered code block, shadow root included. */
function buildCodeBlock(lines: number): HTMLElement {
  const container = document.createElement('div');
  container.className = 'code-block-container';
  const header = document.createElement('div');
  header.className = 'code-block-header';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'code-action-btn';
  header.append(copy);
  container.append(header);

  const host = document.createElement('diffs-container');
  const root = host.attachShadow({ mode: 'open' });
  const pre = document.createElement('pre');
  pre.setAttribute('data-overflow', 'scroll');
  for (let i = 0; i < lines; i++) {
    const line = document.createElement('span');
    line.setAttribute('data-line', String(i + 1));
    root.append(line);
  }
  root.append(pre);
  container.append(host);
  return container;
}

/** Let the markdown root's MutationObserver + its nextTick pass run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await nextTick();
  await nextTick();
}

const DIFF_TEXT = '```diff\n@@ -1 +1 @@\n-old\n+new\n```\n';

describe('markdown diff block toggles', () => {
  it('toggles line numbers on a diff block and sizes its gutter', async () => {
    const view = mountMarkdown(DIFF_TEXT);
    await settle();

    const numsButton = view
      .findAll('.diff-bar button')
      .find((b) => b.attributes('aria-label') === 'Show line numbers');
    expect(numsButton).toBeDefined();
    expect(numsButton!.attributes('aria-pressed')).toBe('false');
    expect(view.get('.diff-wrap').classes()).not.toContain('md-code-nums');

    await numsButton!.trigger('click');
    await settle();

    expect(view.get('.diff-wrap').classes()).toContain('md-code-nums');
    expect(
      view.findAll('.diff-bar button')
        .find((b) => b.attributes('aria-label') === 'Hide line numbers')
        ?.attributes('aria-pressed'),
    ).toBe('true');
    const pre = view.get<HTMLElement>('.diff-pre').element;
    expect(pre.style.getPropertyValue('--md-nums-gutter')).toBe('4ch');
  });

  it('toggles word wrap on a diff block', async () => {
    const view = mountMarkdown(DIFF_TEXT);
    await settle();

    const wrapButton = view
      .findAll('.diff-bar button')
      .find((b) => b.attributes('aria-label') === 'Enable word wrap');
    expect(wrapButton).toBeDefined();
    expect(view.get('.diff-wrap').classes()).not.toContain('md-code-wrap');

    await wrapButton!.trigger('click');
    await settle();

    expect(view.get('.diff-wrap').classes()).toContain('md-code-wrap');
    expect(
      view.findAll('.diff-bar button')
        .find((b) => b.attributes('aria-label') === 'Disable word wrap')
        ?.attributes('aria-pressed'),
    ).toBe('true');
  });

  it('styles the diff gutter, the wrap effect and the code selection colours', () => {
    expect(markdownSource).toMatch(
      /\.diff-wrap\.md-code-nums \.diff-line:not\(\.diff-hunk\)::before \{[^}]*counter\(md-diff-line\)/u,
    );
    expect(markdownSource).toMatch(
      /\.diff-wrap\.md-code-wrap \.diff-pre \{[^}]*white-space: pre-wrap/u,
    );
    expect(markdownSource).toMatch(
      /\.md \.diff-wrap ::selection \{[^}]*background: var\(--color-code-selection\)[^}]*color: var\(--color-code-selection-text\)/u,
    );
  });
});

describe('markdown code block header toggles', () => {
  it('injects wrap + line-number buttons into a rendered code block header', async () => {
    const view = mountMarkdown('plain text');
    await settle();

    const root = view.get('.md').element;
    root.append(buildCodeBlock(12));
    await settle();

    const nums = root.querySelector<HTMLButtonElement>('button.md-code-nums-toggle');
    const wrap = root.querySelector<HTMLButtonElement>('button.md-code-wrap-toggle');
    expect(nums).not.toBeNull();
    expect(wrap).not.toBeNull();
    // The line-number toggle is inserted before the word-wrap toggle.
    expect(nums!.compareDocumentPosition(wrap!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nums!.className).toContain('code-action-btn');
    expect(nums!.getAttribute('aria-pressed')).toBe('false');
    expect(nums!.getAttribute('aria-label')).toBe('Show line numbers');
    expect(wrap!.getAttribute('aria-label')).toBe('Enable word wrap');
  });

  it('pushes wrap + line-number state through the shadow boundary', async () => {
    const view = mountMarkdown('plain text');
    await settle();

    const root = view.get('.md').element;
    const container = buildCodeBlock(12);
    root.append(container);
    await settle();

    const shadow = container.querySelector('diffs-container')!.shadowRoot!;
    const pre = shadow.querySelector<HTMLElement>('pre[data-overflow]')!;
    expect(pre.getAttribute('data-md-nums')).toBe('off');
    expect(pre.getAttribute('data-overflow')).toBe('scroll');

    container.querySelector<HTMLButtonElement>('button.md-code-nums-toggle')!.click();
    expect(pre.getAttribute('data-md-nums')).toBe('on');
    expect(pre.style.getPropertyValue('--md-nums-gutter')).toBe('4ch');
    expect(container.querySelector('button.md-code-nums-toggle')!.getAttribute('aria-pressed'))
      .toBe('true');

    container.querySelector<HTMLButtonElement>('button.md-code-wrap-toggle')!.click();
    expect(pre.getAttribute('data-overflow')).toBe('wrap');
  });

  it('keeps the gutter stylesheet in the shadow root across a re-render', async () => {
    const view = mountMarkdown('plain text');
    await settle();

    const root = view.get('.md').element;
    const container = buildCodeBlock(4);
    root.append(container);
    await settle();

    const shadow = container.querySelector('diffs-container')!.shadowRoot!;
    const style = shadow.querySelector('style[data-md-code-css]');
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain('var(--color-code-selection)');
    expect(style!.textContent).toContain('counter(md-code-line)');

    // The renderer rebuilds the shadow tree; the stylesheet must come back.
    style!.remove();
    await settle();
    await settle();
    expect(shadow.querySelector('style[data-md-code-css]')).not.toBeNull();
  });

  it('styles the injected header toggles and the header title', () => {
    expect(markdownSource).toMatch(
      /\.md :deep\(\.code-block-header \.code-header-title\) \{[^}]*font-size: var\(--text-sm\)/u,
    );
    expect(markdownSource).toMatch(
      /\.md :deep\(\.code-block-header \.code-action-btn:hover \*\) \{[^}]*color: var\(--color-text\)/u,
    );
    expect(markdownSource).toMatch(
      /\.md :deep\(\.code-block-container\.md-code-wrap pre\) \{[^}]*white-space: pre-wrap/u,
    );
  });
});
