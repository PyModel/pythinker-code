import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import DiffView from '../src/components/chat/DiffView.vue';
import enDiff from '../src/i18n/locales/en/diff';

const i18n = createI18n({ legacy: false, messages: { en: { diff: enDiff } } });
const highlightedCodeSource = readFileSync(
  join(import.meta.dirname, '../src/components/chat/HighlightedCode.vue'),
  'utf8',
);

let wrapper: VueWrapper | undefined;

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

function mountDiff(): VueWrapper {
  wrapper = mount(DiffView, {
    props: {
      changes: [],
      gitInfo: null,
      mode: 'detail',
      selectedDiffPath: 'first.unknown',
      fileDiff: [
        { type: 'hunk', text: '@@ -1 +1 @@' },
        { type: 'del', text: 'const oldValue = true;', oldNo: 1 },
        { type: 'add', text: 'const newValue = true;', newNo: 1 },
      ],
    },
    global: { plugins: [i18n] },
  });
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.unstubAllGlobals();
});

describe('DiffView', () => {
  it('resets horizontal scroll when a different file opens', async () => {
    const view = mountDiff();
    const scroller = view.get<HTMLElement>('.dv-lines-wrap').element;
    scroller.scrollLeft = 180;

    await view.setProps({ selectedDiffPath: 'second.unknown' });
    await nextTick();

    expect(scroller.scrollLeft).toBe(0);
  });

  it('wraps narrow diffs while keeping the line gutter sticky', () => {
    const view = mountDiff();

    expect(view.get('.hl-code').classes()).toContain('responsive-wrap');
    expect(highlightedCodeSource).toMatch(
      /@container[^{]*\(max-width:\s*560px\)[\s\S]*?\.hl-code\.responsive-wrap \.hl-text\s*\{[^}]*white-space:\s*pre-wrap[^}]*overflow-wrap:\s*anywhere/u,
    );
    expect(highlightedCodeSource).toMatch(
      /\.hl-code\.responsive-wrap \.hl-gutter\s*\{[^}]*position:\s*sticky/u,
    );
  });
});
