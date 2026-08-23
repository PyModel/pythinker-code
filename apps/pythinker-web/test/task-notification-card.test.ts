import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import NotificationCard from '../src/components/chat/NotificationCard.vue';
import enConversation from '../src/i18n/locales/en/conversation';

const i18n = createI18n({
  legacy: false,
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { conversation: enConversation } },
});

describe('NotificationCard', () => {
  it('renders notification and output data as text', () => {
    const wrapper = mount(NotificationCard, {
      props: {
        items: [
          {
            id: 'task:task_1:completed',
            category: 'task',
            type: 'task.completed',
            sourceKind: 'background_task',
            sourceId: 'task_1',
            title: '<img src=x onerror=alert(1)>',
            severity: 'info',
            body: '42 passed',
            outputFile: { path: '/tmp/test.log', bytes: 128 },
            outputPreview: {
              text: '<script>unsafe()</script>',
              bytes: 12,
              totalBytes: 24,
              truncated: true,
            },
            raw: '<notification>raw</notification>',
          },
        ],
      },
      global: { plugins: [i18n] },
    });

    expect(wrapper.text()).toContain('Background task completed · task_1');
    expect(wrapper.text()).toContain('/tmp/test.log');
    expect(wrapper.text()).toContain('Output truncated');
    expect(wrapper.text()).toContain('<script>unsafe()</script>');
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(false);
  });
});
