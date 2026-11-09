// apps/pythinker-web/test/remote-control-panel.test.ts
// Settings → Remote Control: the switch drives the server tunnel, the link
// shows as a QR code, and a terminal-started tunnel is shown but not toggled.

import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppRemoteControlStatus } from '../src/api/types';
import RemoteControlPanel from '../src/components/settings/RemoteControlPanel.vue';
import webI18n from '../src/i18n';

const { api, copyTextToClipboard } = vi.hoisted(() => ({
  api: { getRemoteControl: vi.fn(), setRemoteControl: vi.fn() },
  copyTextToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/api', () => ({ getPythinkerWebApi: () => api }));
vi.mock('../src/lib/clipboard', () => ({ copyTextToClipboard }));
vi.mock('qrcode', () => ({ default: { toDataURL: async (text: string) => `data:qr,${text}` } }));

const URL = 'https://relay.example.test/devices/abc/?rc=1';
const off: AppRemoteControlStatus = { enabled: false, state: 'off', startedInTerminal: false };
const on: AppRemoteControlStatus = { enabled: true, state: 'on', url: URL, startedInTerminal: false };

async function render() {
  const wrapper = mount(RemoteControlPanel, { global: { plugins: [webI18n] } });
  await flushPromises();
  return wrapper;
}

describe('RemoteControlPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('turns the tunnel on and shows the link as a QR code', async () => {
    api.getRemoteControl.mockResolvedValue(off);
    api.setRemoteControl.mockResolvedValue(on);
    const wrapper = await render();
    expect(wrapper.find('.rc-qr').exists()).toBe(false);

    await wrapper.find('[role="switch"]').trigger('click');
    await flushPromises();

    expect(api.setRemoteControl).toHaveBeenCalledWith(true);
    expect(wrapper.find('.rc-qr').attributes('src')).toBe(`data:qr,${URL}`);
    expect(wrapper.find('.rc-url').text()).toBe(URL);

    await wrapper.find('.rc-actions button').trigger('click');
    expect(copyTextToClipboard).toHaveBeenCalledWith(URL);
  });

  it('shows a tunnel started from the terminal without letting the page stop it', async () => {
    api.getRemoteControl.mockResolvedValue({ ...on, startedInTerminal: true });
    const wrapper = await render();

    expect(wrapper.find('.rc-qr').exists()).toBe(true);
    expect(wrapper.find('.rc-hint').text()).toContain('terminal');
    expect(wrapper.find('[role="switch"]').attributes('disabled')).toBeDefined();
  });

  it('shows why the tunnel could not start', async () => {
    api.getRemoteControl.mockResolvedValue(off);
    api.setRemoteControl.mockRejectedValue(new Error('Remote Control requires a loopback host.'));
    const wrapper = await render();

    await wrapper.find('[role="switch"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('.rc-error').text()).toBe('Remote Control requires a loopback host.');
    expect(wrapper.find('.rc-qr').exists()).toBe(false);
  });
});
