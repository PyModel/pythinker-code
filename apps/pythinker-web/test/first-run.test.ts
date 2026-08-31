import { describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import { i18n } from '../src/i18n';
import FirstRun from '../src/components/settings/FirstRun.vue';

const { api } = vi.hoisted(() => ({
  api: {
    listProviders: vi.fn().mockResolvedValue([]),
    listCatalogProviders: vi.fn().mockResolvedValue([]),
    listModels: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockResolvedValue({}),
    getAuth: vi.fn().mockResolvedValue({ ready: false, defaultModel: null }),
    updateConfig: vi.fn(),
    addProvider: vi.fn(),
  },
}));
vi.mock('../src/api', () => ({ getPythinkerWebApi: () => api }));

function model(id: string, context: number, capabilities?: string[]) {
  return { id, provider: 'p', model: id, maxContextSize: context, capabilities };
}

interface FirstRunVm {
  onProviderAdded: () => Promise<void>;
  step: string;
}

async function mountConnected(models: ReturnType<typeof model>[], defaultModel: string | null) {
  api.listProviders.mockResolvedValue([
    { id: 'p', type: 'openai', hasApiKey: true, status: 'connected', models: models.map((m) => m.id) },
  ]);
  api.listModels.mockResolvedValue(models);
  api.getAuth.mockResolvedValue({ ready: true, defaultModel });
  const wrapper = mount(FirstRun, { global: { plugins: [i18n] } });
  await flushPromises();
  const vm = wrapper.vm as unknown as FirstRunVm;
  await vm.onProviderAdded();
  await flushPromises();
  return wrapper;
}

describe('FirstRun', () => {
  it('opens on the connect step with all three routes and no way forward', async () => {
    api.listProviders.mockResolvedValue([]);
    api.listModels.mockResolvedValue([]);
    api.getAuth.mockResolvedValue({ ready: false, defaultModel: null });
    const wrapper = mount(FirstRun, { global: { plugins: [i18n] } });
    await flushPromises();

    expect(wrapper.find('[data-testid="first-run-route-codex"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="first-run-route-catalog"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="first-run-route-manual"]').exists()).toBe(true);
    // Nothing is connected, so there is no way forward — the step a new install
    // used to get permanently stuck on now simply has no Continue.
    expect(wrapper.find('[data-testid="first-run-connect-continue"]').exists()).toBe(false);
  });

  it('advances to the model step once a provider yields a usable model', async () => {
    const wrapper = await mountConnected(
      [model('p/chat', 262144, ['tool_use']), model('p/embed', 8192, ['image_in'])],
      'p/chat',
    );

    expect(wrapper.find('[data-testid="first-run-model-p/chat"]').exists()).toBe(true);
    // A model that cannot run a turn is never offered as the default.
    expect(wrapper.find('[data-testid="first-run-model-p/embed"]').exists()).toBe(false);
  });

  it('marks the daemon-adopted default as the recommendation', async () => {
    const wrapper = await mountConnected(
      [model('p/small', 8192, ['tool_use']), model('p/big', 1_000_000, ['tool_use'])],
      'p/small',
    );

    // Ranking stays the server's job: whatever it adopted leads the list, even
    // when another model has a larger context window.
    const rows = wrapper.findAll('[data-testid^="first-run-model-"]');
    expect(rows[0]?.attributes('data-testid')).toBe('first-run-model-p/small');
    expect(rows[0]?.text()).toContain('Recommended');
  });

  it('will not advance past connect when nothing usable came back', async () => {
    // The daemon reports ready, but every model it offers is non-conversational.
    // Advancing here would hand the user a signed-in provider they cannot use.
    const wrapper = await mountConnected([model('p/embed', 8192, ['image_in'])], null);

    expect((wrapper.vm as unknown as FirstRunVm).step).toBe('connect');
    expect(wrapper.find('[data-testid="first-run-connect-continue"]').exists()).toBe(false);
  });

  it('reaches the model step when a usable model exists', async () => {
    const wrapper = await mountConnected([model('p/chat', 262144, ['tool_use'])], 'p/chat');

    expect((wrapper.vm as unknown as FirstRunVm).step).toBe('model');
  });
});
