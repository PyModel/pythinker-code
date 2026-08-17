import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import ConversationPane from '../src/components/ConversationPane.vue';
import Composer from '../src/components/Composer.vue';
import { messages } from '../src/i18n/locales';
import type { ChatTurn, ConversationStatus } from '../src/types';

const sourcePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const conversationPaneSource = readFileSync(sourcePath('../src/components/ConversationPane.vue'), 'utf8');
const touchedSources = {
  'ConversationPane.vue': conversationPaneSource,
  'i18n/locales/index.ts': readFileSync(sourcePath('../src/i18n/locales/index.ts'), 'utf8'),
  'i18n/locales/en/suggestions.ts': readFileSync(sourcePath('../src/i18n/locales/en/suggestions.ts'), 'utf8'),
  'test/empty-suggestions.test.ts': readFileSync(sourcePath('./empty-suggestions.test.ts'), 'utf8'),
};

// These literals predate starter suggestions in ConversationPane.vue.
const preExistingColorLiterals = new Set([
  '#000',
  ['rgba', '(0, 0, 0, 0.28)'].join(''),
  ['rgba', '(0, 0, 0, 0.14)'].join(''),
  ['rgba', '(0, 0, 0, 0.12)'].join(''),
  ['rgba', '(0, 0, 0, 0.18)'].join(''),
]);
const rawColorPattern = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;

const status: ConversationStatus = {
  model: 'pythinker-test',
  modelId: 'pythinker-test',
  ctxUsed: 0,
  ctxMax: 0,
  permission: 'manual',
  branch: 'main',
  cwd: '/repo',
  isGitRepo: true,
};

const turn: ChatTurn = {
  id: 'turn_1',
  role: 'user',
  text: 'A message already exists',
};

class MockResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function createTestI18n() {
  return createI18n({
    legacy: false,
    locale: 'en',
    messages,
    missingWarn: false,
    fallbackWarn: false,
  });
}

function createComposerStub(loadForEdit: (value: string) => void) {
  return defineComponent({
    name: 'ComposerStub',
    setup(_, { expose }) {
      expose({ loadForEdit });
      return () => h('div', { class: 'composer-stub' });
    },
  });
}

function mountPane(extraProps: Record<string, unknown> = {}, composer = createComposerStub(() => {})) {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);

  return mount(ConversationPane, {
    attachTo: document.body,
    props: {
      mobile: true,
      turns: [],
      tasks: [],
      status,
      sessionLoading: false,
      running: false,
      ...extraProps,
    },
    global: {
      plugins: [createTestI18n()],
      stubs: {
        ChatHeader: true,
        ChatPane: true,
        ChatDock: true,
        DynamicWorkflowCard: true,
        Composer: composer,
      },
    },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ConversationPane starter suggestions', () => {
  it('renders four suggestions only for an empty session', () => {
    const empty = mountPane();
    expect(empty.findAll('.empty-suggestion')).toHaveLength(4);
    expect(empty.findAll('.empty-suggestion-title').map((node) => node.text())).toEqual([
      'Explain this repository',
      'Find a good first task',
      'Run the project checks',
      'Review the working tree',
    ]);

    const existing = mountPane({ turns: [turn] });
    expect(existing.findAll('.empty-suggestion')).toHaveLength(0);
  });

  it('loads the clicked prompt through the empty composer', async () => {
    const loadForEdit = vi.fn();
    const wrapper = mountPane({}, createComposerStub(loadForEdit));

    await wrapper.get('.empty-suggestion').trigger('click');

    expect(loadForEdit).toHaveBeenCalledWith(
      'Explain this repository. Show the main packages and how they work together.',
    );
  });

  it('does not submit or send a message when a suggestion is clicked', async () => {
    const wrapper = mountPane({}, Composer);
    const suggestion = wrapper.get('.empty-suggestion');

    await suggestion.trigger('click');
    await nextTick();

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.findComponent(Composer).emitted('submit')).toBeUndefined();
  });

  it('focuses the real composer after loading a suggestion', async () => {
    const wrapper = mountPane({}, Composer);

    await wrapper.get('.empty-suggestion').trigger('click');
    await nextTick();

    const textarea = wrapper.get('textarea.ph').element as HTMLTextAreaElement;
    expect(textarea.value).toBe(
      'Explain this repository. Show the main packages and how they work together.',
    );
    expect(document.activeElement).toBe(textarea);
  });
});

describe('starter suggestion styling and source guards', () => {
  it('uses flat button styling with no base border, background, or shadow', () => {
    const gridRule = conversationPaneSource.match(/\.empty-suggestions\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const baseRule = conversationPaneSource.match(/\.empty-suggestion\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(gridRule).toMatch(/grid-template-columns:\s*repeat\(auto-fit,/);
    expect(gridRule).toMatch(/calc\(var\(--ui-font-size\) \* 20\)/);
    expect(baseRule).not.toBe('');
    expect(baseRule).toMatch(/border:\s*0;/);
    expect(baseRule).toMatch(/background:\s*none;/);
    expect(baseRule).toMatch(/box-shadow:\s*none;/);
    expect(baseRule).not.toMatch(/border-radius/);
    expect(baseRule).toMatch(/animation:\s*suggestion-rise 200ms/);
    expect(baseRule).toMatch(/animation-delay:\s*calc\(var\(--suggestion-index\) \* 45ms\)/);
  });

  it('disables suggestion entry animation in the existing reduced-motion block', () => {
    const reducedMotionStart = conversationPaneSource.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    const reducedMotionEnd = conversationPaneSource.indexOf('.empty-add-workspace', reducedMotionStart);
    const reducedMotionBlock = conversationPaneSource.slice(reducedMotionStart, reducedMotionEnd);

    expect(reducedMotionBlock).toContain('.empty-suggestion');
    expect(reducedMotionBlock).toMatch(/\.empty-suggestion[^}]*animation:\s*none;/s);
  });

  it('keeps touched files free of dark utilities and new raw color literals', () => {
    const darkUtility = ['dark', ':'].join('');

    for (const [file, source] of Object.entries(touchedSources)) {
      expect(source, file).not.toContain(darkUtility);
      const literals = source.match(rawColorPattern) ?? [];
      expect(literals.filter((literal) => !preExistingColorLiterals.has(literal)), file).toEqual([]);
    }
  });
});
