import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import WorkspaceGuideArrow from '../src/components/ui/WorkspaceGuideArrow.vue';

describe('WorkspaceGuideArrow', () => {
  it('renders the curved svg arrow and optional label', () => {
    const wrapper = mount(WorkspaceGuideArrow, {
      props: { label: 'Working directory' },
    });

    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.find('.ws-guide-arrow__label').text()).toBe('Working directory');
    expect(wrapper.classes()).toContain('dir-left');
  });

  it('supports the right direction class', () => {
    const wrapper = mount(WorkspaceGuideArrow, {
      props: { direction: 'right' },
    });

    expect(wrapper.classes()).toContain('dir-right');
  });

  it('omits the label element when no label is passed', () => {
    const wrapper = mount(WorkspaceGuideArrow);

    expect(wrapper.find('.ws-guide-arrow__label').exists()).toBe(false);
  });
});
