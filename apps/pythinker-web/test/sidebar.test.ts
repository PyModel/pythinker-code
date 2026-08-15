import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { afterEach, describe, expect, it } from 'vitest';

import Sidebar from '../src/components/Sidebar.vue';
import enHeader from '../src/i18n/locales/en/header';
import enSettings from '../src/i18n/locales/en/settings';
import enSidebar from '../src/i18n/locales/en/sidebar';
import enWorkspace from '../src/i18n/locales/en/workspace';
import type { Session, WorkspaceGroup, WorkspaceView } from '../src/types';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      header: enHeader,
      settings: enSettings,
      sidebar: enSidebar,
      workspace: enWorkspace,
    },
  },
  missingWarn: false,
  fallbackWarn: false,
});

const workspace = (id: string, name: string): WorkspaceView => ({
  id,
  name,
  root: `/workspaces/${id}`,
  shortPath: `~/${id}`,
  sessionCount: 2,
});

const session = (id: string, title: string): Session => ({
  id,
  title,
  time: '1m',
  status: 'idle',
  busy: false,
});

const groups: WorkspaceGroup[] = [
  {
    workspace: workspace('ws-alpha', 'Alpha workspace'),
    sessions: [session('s-alpha', 'alpha task'), session('s-beta', 'beta task')],
  },
  {
    workspace: workspace('ws-other', 'Other workspace'),
    sessions: [session('s-gamma', 'gamma task'), session('s-delta', 'delta task')],
  },
];

function mountSidebar() {
  return mount(Sidebar, {
    props: {
      activeWorkspace: groups[0].workspace,
      activeWorkspaceId: groups[0].workspace.id,
      sessions: groups.flatMap((group) => group.sessions),
      groups,
      activeId: 's-alpha',
    },
    global: { plugins: [i18n] },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Sidebar reference layout', () => {
  it('renders the workspace header actions', () => {
    const wrapper = mountSidebar();
    const header = wrapper.find('.ws-head');

    expect(header.exists()).toBe(true);
    expect(header.text()).toContain('Workspaces');
    expect(header.findAll('button')).toHaveLength(3);
    expect(header.find('.ws-search-btn').exists()).toBe(true);
    expect(header.find('.ws-filter-btn').exists()).toBe(true);
    expect(header.find('.ws-add-btn').exists()).toBe(true);
  });

  it('emits workspace and settings actions from their new locations', async () => {
    const wrapper = mountSidebar();

    await wrapper.find('.ws-add-btn').trigger('click');
    expect(wrapper.emitted('addWorkspace')).toHaveLength(1);

    expect(wrapper.find('.ch .settings-btn').exists()).toBe(false);
    const settings = wrapper.find('.side-foot .settings-row');
    expect(settings.exists()).toBe(true);
    await settings.trigger('click');
    expect(wrapper.emitted('openSettings')).toHaveLength(1);
  });

  it('renders the New Session label without a workspace path row', () => {
    const wrapper = mountSidebar();

    expect(wrapper.find('.btn-new-chat').text()).toContain('New Session');
    expect(wrapper.find('.gh-path').exists()).toBe(false);
  });

  it('renders the panel glyph in the collapse button', () => {
    const wrapper = mountSidebar();
    const svg = wrapper.find('.collapse-btn svg');

    expect(svg.find('rect').exists()).toBe(true);
    expect(svg.html()).not.toContain('M11 6h9');
  });

  it('exposes a method to open workspace search', async () => {
    const wrapper = mountSidebar();

    await wrapper.vm.openSearch();
    await nextTick();

    expect(wrapper.find('.ws-search-input').exists()).toBe(true);
  });

  it('filters session rows from the workspace search input', async () => {
    const wrapper = mountSidebar();

    await wrapper.find('.ws-search-btn').trigger('click');
    const input = wrapper.find<HTMLInputElement>('.ws-search-input');
    expect(input.exists()).toBe(true);

    await input.setValue('alpha');

    expect(wrapper.findAll('.se')).toHaveLength(1);
    expect(wrapper.find('.se').text()).toContain('alpha task');
  });

  it('searches sessions beyond the visible ten', async () => {
    const searchGroup: WorkspaceGroup = {
      workspace: workspace('ws-search', 'Search workspace'),
      sessions: Array.from({ length: 12 }, (_, index) => session(`s-${index + 1}`, `session ${index + 1}`)),
    };
    const wrapper = mount(Sidebar, {
      props: {
        activeWorkspace: searchGroup.workspace,
        activeWorkspaceId: searchGroup.workspace.id,
        sessions: searchGroup.sessions,
        groups: [searchGroup],
        activeId: searchGroup.sessions[0].id,
      },
      global: { plugins: [i18n] },
    });

    await wrapper.find('.ws-search-btn').trigger('click');
    const input = wrapper.find<HTMLInputElement>('.ws-search-input');
    await input.setValue('12');

    expect(wrapper.findAll('.se')).toHaveLength(1);
    expect(wrapper.find('.se').text()).toContain('session 12');
  });
});
