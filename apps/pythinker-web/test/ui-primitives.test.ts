import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';

import Chip from '../src/components/ui/Chip.vue';
import MenuRow from '../src/components/ui/MenuRow.vue';
import Popover from '../src/components/ui/Popover.vue';
import SwitchToggle from '../src/components/ui/SwitchToggle.vue';

// Resolved from this file, not the cwd: the pre-push hook runs the suite from
// the repository root.
const uiDir = join(import.meta.dirname, '../src/components/ui');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('MenuRow', () => {
  it('renders its label and count when provided', () => {
    const wrapper = mount(MenuRow, {
      props: { count: 3 },
      slots: { label: 'Models' },
    });

    expect(wrapper.text()).toContain('Models');
    expect(wrapper.find('.count').text()).toBe('3');
  });

  it('omits the count element when count is not provided', () => {
    const wrapper = mount(MenuRow, { slots: { label: 'Models' } });

    expect(wrapper.find('.count').exists()).toBe(false);
  });

  it('applies the disabled state', () => {
    const wrapper = mount(MenuRow, {
      props: { disabled: true },
      slots: { label: 'Models' },
    });

    expect(wrapper.find('button').attributes('disabled')).toBeDefined();
    expect(wrapper.find('button').classes()).toContain('disabled');
  });
});

describe('SwitchToggle', () => {
  it('reflects aria-checked and emits on click', async () => {
    const wrapper = mount(SwitchToggle, { props: { modelValue: false } });

    expect(wrapper.attributes('aria-checked')).toBe('false');
    await wrapper.trigger('click');
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);

    await wrapper.setProps({ modelValue: true });
    expect(wrapper.attributes('aria-checked')).toBe('true');
  });

  it('emits on keyboard activation', async () => {
    const wrapper = mount(SwitchToggle, { props: { modelValue: false } });

    await wrapper.trigger('keydown', { key: 'Enter' });
    await wrapper.trigger('keydown', { key: ' ' });

    expect(wrapper.emitted('update:modelValue')).toEqual([[true], [true]]);
  });
});

describe('Chip', () => {
  it('renders neutral and active variants and emits on click', async () => {
    const neutral = mount(Chip, {
      props: { label: 'Neutral', variant: 'neutral' },
      slots: { icon: '<svg aria-hidden="true" />' },
    });
    const active = mount(Chip, {
      props: { label: 'Active', variant: 'active' },
      slots: { icon: '<svg aria-hidden="true" />' },
    });

    expect(neutral.classes()).toContain('neutral');
    expect(active.classes()).toContain('active');
    expect(active.text()).toContain('Active');

    await active.trigger('click');
    expect(active.emitted('click')).toHaveLength(1);
  });
});

describe('Popover', () => {
  it('opens and closes with the open prop', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const wrapper = mount(Popover, {
      attachTo: document.body,
      props: { anchor, open: false },
      slots: { default: 'Menu' },
    });

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    await wrapper.setProps({ open: true });
    expect(document.body.querySelector('[role="dialog"]')?.textContent).toBe('Menu');
    await wrapper.setProps({ open: false });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('flips above the anchor and clamps to the viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    const anchor = document.createElement('button');
    anchor.getBoundingClientRect = () => ({
      bottom: 720,
      height: 20,
      left: 700,
      right: 760,
      top: 700,
      width: 60,
      x: 700,
      y: 700,
      toJSON: () => ({}),
    });
    document.body.append(anchor);
    const wrapper = mount(Popover, {
      attachTo: document.body,
      props: { anchor, open: true },
      slots: { default: 'Menu' },
    });
    const panel = document.body.querySelector('[role="dialog"]') as HTMLElement;
    Object.defineProperty(panel, 'offsetWidth', { configurable: true, value: 100 });
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, value: 80 });

    await settle();

    expect(readFileSync(join(uiDir, 'Popover.vue'), 'utf8')).toMatch(/position:\s*fixed/u);
    expect(panel.style.top).toBe('616px');
    expect(panel.style.left).toBe('684px');
    wrapper.unmount();
  });

  it('closes on Escape', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const wrapper = mount(Popover, {
      attachTo: document.body,
      props: { anchor, open: true },
    });

    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes on outside pointerdown but not inside the panel', async () => {
    const anchor = document.createElement('button');
    const outside = document.createElement('div');
    document.body.append(anchor, outside);
    const wrapper = mount(Popover, {
      attachTo: document.body,
      props: { anchor, open: true },
      slots: { default: 'Menu' },
    });

    await settle();
    const panel = document.body.querySelector('[role="dialog"]') as HTMLElement;
    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper.emitted('close')).toBeUndefined();

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('moves focus into the panel when it opens', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    anchor.focus();
    const wrapper = mount(Popover, {
      attachTo: document.body,
      props: { anchor, open: false, label: 'Capabilities' },
      slots: { default: '<button type="button">First</button><button type="button">Second</button>' },
    });

    await wrapper.setProps({ open: true });
    await settle();

    const panel = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(panel.getAttribute('aria-label')).toBe('Capabilities');
    // The panel is teleported to the end of <body>: without this the first Tab
    // would walk the rest of the page instead of the panel contents.
    expect(document.activeElement).toBe(panel.querySelector('button'));
    wrapper.unmount();
  });

  it('focuses the panel itself when the slot has nothing focusable', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const wrapper = mount(Popover, {
      attachTo: document.body,
      props: { anchor, open: false },
      slots: { default: 'Menu' },
    });

    await wrapper.setProps({ open: true });
    await settle();

    expect(document.activeElement).toBe(document.body.querySelector('[role="dialog"]'));
    wrapper.unmount();
  });

  it('restores focus to the anchor only when the panel held focus', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    anchor.focus();
    const wrapper = mount(Popover, {
      attachTo: document.body,
      props: { anchor, open: false },
    });

    await wrapper.setProps({ open: true });
    await settle();
    const panel = document.body.querySelector('[role="dialog"]') as HTMLElement;
    panel.focus();
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(anchor);

    await wrapper.setProps({ open: true });
    await settle();
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(outside);
  });
});

describe('UI primitive theme guard', () => {
  it('keeps every source file free of forbidden color and dark-mode literals', () => {
    const files = sourceFiles(uiDir).toSorted();

    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/\bdark:/u);
      expect(source, file).not.toMatch(/#[\da-f]{3,8}\b/iu);
      expect(source, file).not.toMatch(/\brgba?\s*\(/iu);
    }
  });
});
