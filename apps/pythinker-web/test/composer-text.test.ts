import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ComposerText from '../src/components/chat/ComposerText.vue';
import { serializeMention } from '../src/lib/mentions';

describe('ComposerText', () => {
  it('opens file pills and keeps folder pills inert', async () => {
    const openFile = vi.fn();
    const text = [
      serializeMention({ kind: 'file', name: 'main.ts', path: '/src/main.ts' }),
      serializeMention({ kind: 'folder', name: 'src', path: '/src/' }),
    ].join(' ');
    const wrapper = mount(ComposerText, { props: { text, openFile } });

    const pills = wrapper.findAll('.mention-pill');
    expect(pills).toHaveLength(2);
    expect(pills[0]!.attributes('role')).toBe('button');
    expect(pills[1]!.attributes('role')).toBeUndefined();
    await pills[0]!.trigger('click');
    await pills[0]!.trigger('keydown', { key: 'Enter' });
    await pills[1]!.trigger('click');
    expect(openFile).toHaveBeenCalledTimes(2);
    expect(openFile).toHaveBeenLastCalledWith({ path: '/src/main.ts' });
  });
});
