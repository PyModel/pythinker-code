import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ActionToast from '../src/components/ui/ActionToast.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: { en: { common: { dismiss: 'Dismiss' } } },
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ActionToast', () => {
  it('positions compact toasts above the composer and spaces inline actions', () => {
    const webRoot = process.cwd().endsWith('apps/pythinker-web')
      ? process.cwd()
      : join(process.cwd(), 'apps/pythinker-web');
    const toast = readFileSync(join(webRoot, 'src/components/ui/ActionToast.vue'), 'utf8');
    const app = readFileSync(join(webRoot, 'src/App.vue'), 'utf8');
    const conversation = readFileSync(
      join(webRoot, 'src/components/chat/ConversationPane.vue'),
      'utf8',
    );

    expect(toast).toMatch(/\.ui-action-toast-host\s*\{[^}]*position:\s*absolute;[^}]*right:\s*max\([^}]*var\(--read-max\)[^}]*\);[^}]*bottom:\s*calc\(var\(--dock-h, 76px\) \+ var\(--space-2\)\);/su);
    expect(toast).toMatch(/\.ui-action-toast__body :deep\(button\)\s*\{[^}]*margin-inline:\s*var\(--space-1\);/su);
    expect(app).toContain('<Teleport defer to=".con">');
    expect(app).not.toContain('action-toast-stack');
    expect(conversation).toContain("import ActionToast from '../ui/ActionToast.vue';");
    expect(conversation).toContain('<ActionToast\n      v-if="abortToastVisible"');
    expect(conversation).toContain(':duration="ABORT_TOAST_DURATION"');
    expect(conversation).not.toContain('class="abort-toast"');
  });

  it('auto-dismisses after its duration and pauses while hovered', async () => {
    vi.useFakeTimers();
    const wrapper = mount(ActionToast, {
      props: { duration: 1000, dismissToken: 'archive' },
      slots: { default: 'Session archived' },
      global: { plugins: [i18n] },
    });

    await vi.advanceTimersByTimeAsync(400);
    await wrapper.get('.ui-action-toast').trigger('pointerenter');
    await vi.advanceTimersByTimeAsync(1000);
    expect(wrapper.emitted('dismiss')).toBeUndefined();

    await wrapper.get('.ui-action-toast').trigger('pointerleave');
    await vi.advanceTimersByTimeAsync(600);
    expect(wrapper.emitted('dismiss')).toEqual([['archive']]);
  });
});
