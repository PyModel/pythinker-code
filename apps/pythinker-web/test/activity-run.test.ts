// Scenario: ActivityRun header status glyph across streaming / settled thinking.
// Responsibilities: a thinking step that reported a duration has ended, so the
// header must stop claiming "Thinking" and stop animating the bulb even while
// the surrounding run is still streaming.
// Wiring: the component is real; child tool/thinking bodies are stubbed away.
// Run: pnpm --filter @pymodel/pythinker-web exec vitest run test/activity-run.test.ts

import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import ActivityRun from '../src/components/chat/ActivityRun.vue';
import type { RunItem } from '../src/components/chatTurnRendering';
import enConversation from '../src/i18n/locales/en/conversation';
import enThinking from '../src/i18n/locales/en/thinking';
import enTools from '../src/i18n/locales/en/tools';

const i18n = createI18n({
  legacy: false,
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: { conversation: enConversation, thinking: enThinking, tools: enTools } },
});

const activityRunSource = readFileSync(
  join(import.meta.dirname, '../src/components/chat/ActivityRun.vue'),
  'utf8',
);

function thinking(overrides: Partial<Extract<RunItem, { kind: 'thinking' }>> = {}): RunItem {
  return { kind: 'thinking', thinking: 'weighing options', sourceIndex: 0, ...overrides };
}

function tool(overrides: Partial<Extract<RunItem, { kind: 'tool' }>> = {}): RunItem {
  return {
    kind: 'tool',
    sourceIndex: 0,
    tool: {
      id: 'tool_1',
      name: 'bash',
      arg: '{"cmd":"pwd"}',
      status: 'ok',
      output: [],
    },
    ...overrides,
  };
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
  it('centers the status glyph in a fixed slot without a downward offset', () => {
    const glyphRule = /\.ar-glyph\s*\{([^}]*)\}/.exec(activityRunSource)?.[1] ?? '';

    expect(glyphRule).toMatch(/width:\s*var\(--p-ic-sm\)/);
    expect(glyphRule).toMatch(/height:\s*var\(--p-ic-sm\)/);
    expect(glyphRule).toMatch(/justify-content:\s*center/);
    expect(glyphRule).toMatch(/line-height:\s*0/);
    expect(glyphRule).not.toMatch(/transform:\s*translateY/);
  });

  it('animates the bulb while the thinking tail is still streaming', () => {
    const wrapper = mountRun([thinking()], true);
    expect(wrapper.get('.ar-glyph').classes()).toContain('bulb');
  });

  it('shows a live thinking tail in the run header without a duplicate body row', () => {
    const wrapper = mountRun([tool(), thinking({ sourceIndex: 1 })], true);

    expect(wrapper.get('.ar-sum').text()).toContain('Thinking…');
    expect(wrapper.find('thinking-block-stub').exists()).toBe(false);
    expect(wrapper.find('tool-call-stub').exists()).toBe(true);
  });

  it('stops animating once the thinking step reports a duration', () => {
    // Regression: `statusItem` pinned to the last thinking item whenever the run
    // was streaming, so a settled step kept the "Thinking" glyph and the bulb
    // animation for as long as the run stayed open.
    const wrapper = mountRun([thinking({ durationMs: 4200 })], true);
    expect(wrapper.get('.ar-glyph').classes()).not.toContain('bulb');
  });
});
