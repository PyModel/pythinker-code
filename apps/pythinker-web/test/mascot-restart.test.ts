import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConversationPane from '../src/components/ConversationPane.vue';
import type { ConversationStatus } from '../src/types';

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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('empty-state mascot restart', () => {
  it('changes the mascot src every 20 seconds', async () => {
    const wrapper = mount(ConversationPane, {
      props: {
        turns: [],
        tasks: [],
        status,
        sessionLoading: false,
        running: false,
      },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', messages: { en: {} } })],
        stubs: {
          ChatHeader: true,
          ChatPane: true,
          Composer: true,
          DynamicWorkflowCard: true,
          ChatDock: true,
        },
      },
    });
    const mascot = wrapper.get('img.empty-mascot');
    const initialSrc = mascot.attributes('src');

    vi.advanceTimersByTime(20_000);
    await nextTick();

    expect(mascot.attributes('src')).not.toBe(initialSrc);
    expect(mascot.attributes('src')).toContain('/brand/mascot-idle.png');
    wrapper.unmount();
  });
});
