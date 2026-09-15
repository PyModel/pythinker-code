import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AgentThinking, { type ThinkingVariant } from '../src/components/ui/AgentThinking.vue';

describe('AgentThinking', () => {
  it('renders 16 dots in the 4x4 matrix with status role', () => {
    const wrapper = mount(AgentThinking, {
      props: { label: 'Reasoning' },
    });

    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.attributes('aria-label')).toBe('Reasoning');
    const dots = wrapper.findAll('.agent-thinking__matrix > i');
    expect(dots).toHaveLength(16);
    expect(wrapper.find('.agent-thinking__label').text()).toBe('Reasoning');
  });

  it.each(['scan', 'orbit', 'twinkle', 'pulse', 'wave'] as ThinkingVariant[])(
    'supports the %s variant',
    (variant) => {
      const wrapper = mount(AgentThinking, {
        props: { variant },
      });
      expect(wrapper.get('.agent-thinking__matrix').attributes('data-variant')).toBe(variant);
    },
  );

  it('hides the four corner dots when rounded is true', () => {
    const wrapper = mount(AgentThinking, {
      props: { rounded: true },
    });

    const dots = wrapper.findAll('.agent-thinking__matrix > i');
    const gapIndexes = new Set([0, 3, 12, 15]);
    for (let i = 0; i < 16; i++) {
      if (gapIndexes.has(i)) {
        expect(dots[i].classes()).toContain('is-gap');
      } else {
        expect(dots[i].classes()).not.toContain('is-gap');
      }
    }
  });

  it('hides the label when showLabel is false', () => {
    const wrapper = mount(AgentThinking, {
      props: { showLabel: false },
    });

    expect(wrapper.find('.agent-thinking__label').exists()).toBe(false);
  });

  it.each(['sm', 'md', 'lg'] as const)('applies the %s size class', (size) => {
    const wrapper = mount(AgentThinking, {
      props: { size },
    });
    expect(wrapper.classes()).toContain(`agent-thinking--${size}`);
  });
});
