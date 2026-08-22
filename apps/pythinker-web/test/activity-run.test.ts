// Scenario: ActivityRun header status glyph across streaming / settled thinking.
// Responsibilities: a thinking step that reported a duration has ended, so the
// header must stop claiming "Thinking" and stop animating the bulb even while
// the surrounding run is still streaming.
// Wiring: the component is real; child tool/thinking bodies are stubbed away.
// Run: pnpm --filter @pymodel/pythinker-web exec vitest run test/activity-run.test.ts

import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';

import ActivityRun from '../src/components/chat/ActivityRun.vue';
import type { RunItem } from '../src/components/chatTurnRendering';
import enThinking from '../src/i18n/locales/en/thinking';
import enTools from '../src/i18n/locales/en/tools';

const i18n = createI18n({
  legacy: false,
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { thinking: enThinking, tools: enTools } },
});

function thinking(overrides: Partial<Extract<RunItem, { kind: 'thinking' }>> = {}): RunItem {
  return { kind: 'thinking', thinking: 'weighing options', sourceIndex: 0, ...overrides };
}

function mountRun(items: RunItem[], streaming: boolean) {
  return mount(ActivityRun, {
    props: { items, streaming },
    global: {
      plugins: [i18n],
      stubs: { ThinkingBlock: true, ToolCall: true, ThinkingBulb: true },
    },
  });
}

describe('ActivityRun header glyph', () => {
  it('animates the bulb while the thinking tail is still streaming', () => {
    const wrapper = mountRun([thinking()], true);
    expect(wrapper.get('.ar-glyph').classes()).toContain('bulb');
  });

  it('stops animating once the thinking step reports a duration', () => {
    // Regression: `statusItem` pinned to the last thinking item whenever the run
    // was streaming, so a settled step kept the "Thinking" glyph and the bulb
    // animation for as long as the run stayed open.
    const wrapper = mountRun([thinking({ durationMs: 4200 })], true);
    expect(wrapper.get('.ar-glyph').classes()).not.toContain('bulb');
  });
});
