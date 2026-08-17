import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Composer from '../src/components/Composer.vue';
import type { AppModel } from '../src/api/types';

const sourcePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const composerSource = readFileSync(sourcePath('../src/components/Composer.vue'), 'utf8');

function mountComposer(props: Record<string, unknown> = {}) {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    messages: {
      en: {
        composer: {
          editQueued: 'Edit queued',
          interrupt: 'Interrupt',
          interruptTitle: 'Interrupt',
          placeholder: 'Message Pythinker',
          queueLabel: 'Queue',
          previewAttachment: 'Preview {name}',
          remove: 'Remove',
          removeNamed: 'Remove {name}',
          send: 'Send',
          steerNow: 'Steer now',
          steerTitle: 'Steer now',
        },
        commands: {
          goal: { desc: 'Start a goal' },
          dynamicWorkflow: { desc: 'Run with dynamic workflow' },
          btw: { desc: 'Ask side chat' },
          compact: { desc: 'Compact context' },
        },
        status: {
          modelLabel: 'Model',
          modelTooltip: 'Switch model',
          starredModels: 'Starred',
          moreModels: 'More models…',
          thinkingLabel: 'thinking',
          effortRow: 'Effort',
          effortLevels: {
            off: 'Off',
            minimal: 'Minimal',
            low: 'Low',
            medium: 'Medium',
            high: 'High',
            xhigh: 'xHigh',
            max: 'Max',
          },
        },
      },
    },
    missingWarn: false,
    fallbackWarn: false,
  });

  return mount(Composer, {
    props,
    global: {
      plugins: [i18n],
    },
  });
}

/** The dropdown opens on the root menu; step into the model list. */
async function openModelList(wrapper: ReturnType<typeof mountComposer>): Promise<void> {
  const modelRow = wrapper.findAll('.md-row-nav').find((row) => row.text().includes('Model'));
  await modelRow!.trigger('click');
}

function waitForCompositionEndTimer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.innerHTML = '';
  try { localStorage.clear(); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

describe('Composer styling', () => {
  it('places the composer border flush against the message list', () => {
    const composerRule = composerSource.match(/(?:^|\n)\.composer\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(composerRule.trim()).not.toBe('');

    const padding = composerRule.match(/padding:\s*([^;]+);/)?.[1] ?? '';
    expect(padding).toMatch(/^0(?:\s|$)/);
    expect(padding).not.toMatch(/^7px(?:\s|$)/);
    expect(padding).toMatch(/var\(--dock-inline-left, 16px\)$/);
  });

  it('styles attachments as a horizontal row of square tiles', () => {
    const stripRule = composerSource.match(/(?:^|\n)\.att-strip\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(stripRule.trim()).not.toBe('');
    expect(stripRule).toMatch(/flex-wrap:\s*nowrap;/);
    expect(stripRule).toMatch(/overflow-x:\s*auto;/);

    const removeRule = composerSource.match(/(?:^|\n)\.att-rm\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(removeRule.trim()).not.toBe('');
    expect(removeRule).toMatch(/opacity:\s*0;/);
    expect(removeRule).not.toMatch(/display:\s*none;/);

    const chipRule = composerSource.match(/(?:^|\n)\.att-chip\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(chipRule.trim()).not.toBe('');
    expect(chipRule).toMatch(/width:\s*56px;/);
  });
});

describe('Composer IME input', () => {
  it('does not submit when Enter confirms active composition', async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('textarea');

    await textarea.setValue('ni');
    await textarea.trigger('compositionstart');
    await textarea.trigger('keydown', { key: 'Enter', isComposing: true });

    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('does not submit the Enter that immediately follows compositionend', async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('textarea');

    await textarea.setValue('hello');
    await textarea.trigger('compositionstart');
    await textarea.trigger('compositionend');
    await textarea.trigger('keydown', { key: 'Enter', isComposing: false });

    expect(wrapper.emitted('submit')).toBeUndefined();

    await waitForCompositionEndTimer();
    await textarea.trigger('keydown', { key: 'Enter', isComposing: false });

    expect(wrapper.emitted('submit')).toEqual([[{ text: 'hello', attachments: [] }]]);
  });
});

describe('Composer history recall', () => {
  it('walks sent messages with ArrowUp/ArrowDown and restores the draft', async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('textarea');
    const el = textarea.element as HTMLTextAreaElement;

    await textarea.setValue('first');
    await textarea.trigger('keydown', { key: 'Enter' });
    await textarea.setValue('second');
    await textarea.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('submit')).toHaveLength(2);
    expect(el.value).toBe('');

    // ArrowUp recalls the most recent, then the older one.
    await textarea.trigger('keydown', { key: 'ArrowUp' });
    expect(el.value).toBe('second');
    await textarea.trigger('keydown', { key: 'ArrowUp' });
    expect(el.value).toBe('first');

    // ArrowDown walks forward, then restores the (empty) live draft.
    await textarea.trigger('keydown', { key: 'ArrowDown' });
    expect(el.value).toBe('second');
    await textarea.trigger('keydown', { key: 'ArrowDown' });
    expect(el.value).toBe('');
  });

  it('keeps walking past a multi-line entry (caret lands off the first line)', async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('textarea');
    const el = textarea.element as HTMLTextAreaElement;

    // Three sends; the middle one is multi-line. After recalling it the caret
    // sits on its LAST line, so the old "ArrowUp only on the first line" gate
    // trapped it there and you could never reach the oldest entry.
    await textarea.setValue('oldest');
    await textarea.trigger('keydown', { key: 'Enter' });
    await textarea.setValue('multi\nline');
    await textarea.trigger('keydown', { key: 'Enter' });
    await textarea.setValue('newest');
    await textarea.trigger('keydown', { key: 'Enter' });

    await textarea.trigger('keydown', { key: 'ArrowUp' });
    expect(el.value).toBe('newest');
    await textarea.trigger('keydown', { key: 'ArrowUp' });
    expect(el.value).toBe('multi\nline');
    // The fix: still recalls the oldest even though the caret is on the last
    // line of the multi-line entry.
    await textarea.trigger('keydown', { key: 'ArrowUp' });
    expect(el.value).toBe('oldest');
  });
});

describe('Composer draft persistence', () => {
  it('saves the unsent draft per session and restores it on switch', async () => {
    const wrapper = mountComposer({ sessionId: 'sess_A' });
    const textarea = wrapper.get('textarea');
    const el = textarea.element as HTMLTextAreaElement;

    await textarea.setValue('draft for A');
    expect(localStorage.getItem('pythinker-web.draft.sess_A')).toBe('draft for A');

    // Switch to another session → box clears (B has no draft), A is preserved.
    await wrapper.setProps({ sessionId: 'sess_B' });
    expect(el.value).toBe('');
    await textarea.setValue('draft for B');

    // Back to A → its draft comes back.
    await wrapper.setProps({ sessionId: 'sess_A' });
    expect(el.value).toBe('draft for A');
    // B's draft is still stored too.
    expect(localStorage.getItem('pythinker-web.draft.sess_B')).toBe('draft for B');
  });

  it('restores a saved draft on mount and clears it after sending', async () => {
    localStorage.setItem('pythinker-web.draft.sess_X', 'unfinished');
    const wrapper = mountComposer({ sessionId: 'sess_X' });
    const textarea = wrapper.get('textarea');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('unfinished');

    await textarea.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('submit')).toHaveLength(1);
    // Draft cleared once sent.
    expect(localStorage.getItem('pythinker-web.draft.sess_X')).toBe(null);
  });

  it('stays empty when a new session is created right after sending from the empty state', async () => {
    const wrapper = mountComposer({ sessionId: undefined });
    const textarea = wrapper.get('textarea');
    const el = textarea.element as HTMLTextAreaElement;

    await textarea.setValue('hello');
    await textarea.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('submit')).toHaveLength(1);
    expect(el.value).toBe('');

    // Parent creates a new session and passes its id down to the composer.
    await wrapper.setProps({ sessionId: 'sess_new' });
    await flushPromises();

    expect(el.value).toBe('');
    expect(localStorage.getItem('pythinker-web.draft.sess_new')).toBe(null);
  });
});

describe('Composer height', () => {
  it('does not write an autosized textarea height as text grows', async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('textarea');
    const el = textarea.element as HTMLTextAreaElement;
    el.style.height = '180px';

    await textarea.setValue('one line\nsecond line\nthird line');

    expect(el.style.height).toBe('');
  });
});

describe('Composer attachment preview', () => {
  it('opens a pasted image preview from the attachment thumbnail', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:preview'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
    const wrapper = mountComposer({
      uploadImage: vi.fn(async () => ({ fileId: 'file_1', name: 'shot.png', mediaType: 'image/png' })),
    });
    const file = new File(['png'], 'shot.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [], files: [file] },
    });

    document.dispatchEvent(paste);
    await flushPromises();

    const chips = wrapper.findAll('.att-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]!.find('.att-name').exists()).toBe(false);
    expect(chips[0]!.get('.att-preview').attributes('aria-label')).toContain('shot.png');

    await wrapper.find('.att-preview').trigger('click');

    expect(wrapper.find('.att-lightbox').exists()).toBe(true);
    expect(wrapper.find('.att-lightbox-media').attributes('src')).toBe('blob:preview');

    await wrapper.find('.att-rm').trigger('click');
    expect(wrapper.findAll('.att-chip')).toHaveLength(0);

    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreateObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevokeObjectURL,
      configurable: true,
    });
  });

  it('keeps the error icon when an attachment upload fails', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:error-preview'),
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
    });
    const wrapper = mountComposer({ uploadImage: vi.fn().mockRejectedValue(new Error('upload failed')) });
    const file = new File(['png'], 'broken.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { items: [], files: [file] },
    });

    document.dispatchEvent(paste);
    await flushPromises();

    expect(wrapper.get('.att-chip').find('.att-err-icon').exists()).toBe(true);

    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreateObjectURL,
      configurable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevokeObjectURL,
      configurable: true,
    });
  });
});

describe('Composer slash command input', () => {
  it('emits /goal with the typed objective instead of sending it as chat', async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('textarea');

    await textarea.setValue('/goal workflow review the changed files');
    await textarea.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('command')).toEqual([['/goal workflow review the changed files']]);
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('emits /workflow with the typed task instead of sending it as chat', async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('textarea');

    await textarea.setValue('/workflow inspect flaky tests');
    await textarea.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('command')).toEqual([['/workflow inspect flaky tests']]);
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('keeps input-capable slash commands in the composer when selected from the menu', async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get('textarea');

    await textarea.setValue('/go');
    await textarea.trigger('keydown', { key: 'Enter' });

    expect((textarea.element as HTMLTextAreaElement).value).toBe('/goal ');
    expect(wrapper.emitted('command')).toBeUndefined();
  });
});

describe('Composer model dropdown', () => {
  const models: AppModel[] = [
    { id: 'pythinker/k2', provider: 'pythinker', model: 'k2', displayName: 'Pythinker K2', maxContextSize: 128000 },
    { id: 'openai/gpt-5', provider: 'openai', model: 'gpt-5', displayName: 'GPT-5', maxContextSize: 256000 },
    { id: 'openai/gpt-4o', provider: 'openai', model: 'gpt-4o', displayName: 'GPT-4o', maxContextSize: 128000 },
  ];

  it('shows starred models from other providers in the quick-switch dropdown', async () => {
    const wrapper = mountComposer({
      status: { model: 'Pythinker K2', modelId: 'pythinker/k2', ctxUsed: 0, ctxMax: 128000, permission: 'manual' },
      models,
      starredIds: ['openai/gpt-5'],
    });

    await wrapper.find('.model-pill').trigger('click');
    await openModelList(wrapper);

    const rows = wrapper.findAll('.md-row');
    expect(rows.length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain('Starred');
    expect(wrapper.text()).toContain('GPT-5');
    expect(wrapper.text()).toContain('openai');
  });

  it('emits selectModel when a starred model is chosen', async () => {
    const wrapper = mountComposer({
      status: { model: 'Pythinker K2', modelId: 'pythinker/k2', ctxUsed: 0, ctxMax: 128000, permission: 'manual' },
      models,
      starredIds: ['openai/gpt-5'],
    });

    await wrapper.find('.model-pill').trigger('click');
    await openModelList(wrapper);
    const starredRow = wrapper.findAll('.md-row').find((row) => row.text().includes('GPT-5'));
    expect(starredRow).toBeDefined();
    await starredRow!.trigger('click');

    expect(wrapper.emitted('selectModel')).toEqual([['openai/gpt-5']]);
  });

  it('bounds the quick-switch dropdown to the measured space above its pill', async () => {
    const wrapper = mountComposer({
      status: { model: 'Model 0', modelId: 'pythinker/model-0', ctxUsed: 0, ctxMax: 128000, permission: 'manual' },
      models: Array.from({ length: 17 }, (_, index) => ({
        id: `pythinker/model-${index}`,
        provider: 'pythinker',
        model: `model-${index}`,
        displayName: `Model ${index}`,
        maxContextSize: 128000,
      })),
    });
    const pill = wrapper.get('.model-pill');
    const rect = vi.spyOn(pill.element, 'getBoundingClientRect');

    // A pill near the top of the viewport used to get a 160px menu that reached
    // above the viewport edge, so its upper entries could not be scrolled to.
    rect.mockReturnValue({ top: 20 } as DOMRect);
    await pill.trigger('click');
    expect(wrapper.get('.model-dropdown').element.style.maxHeight).toBe('4px');

    rect.mockReturnValue({ top: 300 } as DOMRect);
    await pill.trigger('click');
    await pill.trigger('click');
    expect(wrapper.get('.model-dropdown').element.style.maxHeight).toBe('284px');

    // A tall window used to let the menu grow to the full viewport height.
    rect.mockReturnValue({ top: 1180 } as DOMRect);
    await pill.trigger('click');
    await pill.trigger('click');
    expect(wrapper.get('.model-dropdown').element.style.maxHeight).toBe('360px');
  });

  it('opens on a two-row root menu and drills into the effort list', async () => {
    const wrapper = mountComposer({
      status: { model: 'Pythinker K2', modelId: 'pythinker/k2', ctxUsed: 0, ctxMax: 128000, permission: 'manual' },
      models: [
        {
          id: 'pythinker/k2',
          provider: 'pythinker',
          model: 'k2',
          displayName: 'Pythinker K2',
          maxContextSize: 128000,
          capabilities: ['thinking'],
        },
      ],
      thinking: 'medium',
    });

    await wrapper.find('.model-pill').trigger('click');
    expect(wrapper.findAll('.md-row-nav')).toHaveLength(2);
    expect(wrapper.text()).toContain('Pythinker K2');
    expect(wrapper.text()).toContain('Medium');
    // The model list stays behind the Model row.
    expect(wrapper.text()).not.toContain('More models…');

    const effortRow = wrapper.findAll('.md-row-nav').find((row) => row.text().includes('Effort'));
    await effortRow!.trigger('click');

    const levels = wrapper.findAll('.md-row').map((row) => row.text());
    expect(levels).toEqual(['Effort', 'Off', 'Low', 'Medium', 'High']);

    const high = wrapper.findAll('.md-row').find((row) => row.text() === 'High');
    await high!.trigger('click');
    expect(wrapper.emitted('setThinking')).toEqual([['high']]);
  });

  it('replaces the binary thinking toggle with the effort list', () => {
    expect(composerSource).not.toContain('toggleThinking');
    expect(composerSource).not.toContain('md-row-toggle');
    expect(composerSource).toContain('selectEffort');
  });
});

describe('Composer context indicator', () => {
  const status = { model: 'Pythinker K2', modelId: 'pythinker/k2', ctxUsed: 0, ctxMax: 128000, permission: 'manual' };

  it('shows the ctx-group by default when status is available', () => {
    const wrapper = mountComposer({ status });

    expect(wrapper.find('.ctx-group').exists()).toBe(true);
  });

  it('hides the ctx-group when hideContext is true', () => {
    const wrapper = mountComposer({ status, hideContext: true });

    expect(wrapper.find('.ctx-group').exists()).toBe(false);
  });

  it('still shows the model pill when ctx-group is hidden', () => {
    const wrapper = mountComposer({ status, hideContext: true });

    expect(wrapper.find('.model-pill').exists()).toBe(true);
  });
});
