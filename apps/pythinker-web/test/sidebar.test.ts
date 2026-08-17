import { existsSync, readFileSync } from 'node:fs';
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

const sidebarPath = ['src/components/Sidebar.vue', 'apps/pythinker-web/src/components/Sidebar.vue'].find(existsSync);
if (!sidebarPath) throw new Error('Sidebar.vue source was not found');

const sidebarSource = readFileSync(sidebarPath, 'utf8');
const styleMatch = sidebarSource.match(/<style scoped>([\s\S]*?)<\/style>/u);

if (!styleMatch?.[1]) throw new Error('Sidebar.vue must have a scoped style block');

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
  it('collapses non-active workspaces and expands the active workspace by default', async () => {
    const wrapper = mountSidebar();
    const sessionGroups = wrapper.findAll('.group-sessions');

    expect(sessionGroups).toHaveLength(2);
    expect((sessionGroups[0]!.element as HTMLElement).style.display).toBe('');
    expect((sessionGroups[1]!.element as HTMLElement).style.display).toBe('none');

    await wrapper.setProps({ activeWorkspaceId: groups[1]!.workspace.id });

    expect((sessionGroups[0]!.element as HTMLElement).style.display).toBe('none');
    expect((sessionGroups[1]!.element as HTMLElement).style.display).toBe('');
  });

  it('keeps a manually expanded non-active workspace expanded', async () => {
    const wrapper = mountSidebar();
    const sessionGroups = wrapper.findAll('.group-sessions');

    expect((sessionGroups[1]!.element as HTMLElement).style.display).toBe('none');
    await wrapper.findAll('.gh')[1]!.trigger('click');
    expect((sessionGroups[1]!.element as HTMLElement).style.display).toBe('');

    await wrapper.setProps({ activeWorkspaceId: groups[1]!.workspace.id });
    await wrapper.setProps({ activeWorkspaceId: groups[0]!.workspace.id });
    expect((sessionGroups[1]!.element as HTMLElement).style.display).toBe('');
  });

  it('colours only the active workspace folder blue', () => {
    const folderRule = styleMatch[1].match(/(?:^|\n)\.gh-folder\s*\{([^}]*)\}/u);

    expect(styleMatch[1]).toContain('.gh.on .gh-folder');
    expect(folderRule).not.toBeNull();
    expect(folderRule![1]).not.toContain('var(--blue)');
  });

  it('keeps workspace header actions keyboard focusable while hidden', () => {
    const addRule = styleMatch[1].match(/(?:^|\n)\.gh-add\s*\{([^}]*)\}/u);
    const moreRule = styleMatch[1].match(/(?:^|\n)\.gh-more\s*\{([^}]*)\}/u);
    const revealRule = styleMatch[1].match(
      /(?:^|\n)\.gh:hover \.gh-more,\s*\n\.gh:hover \.gh-add,\s*\n\.gh-more:focus-visible,\s*\n\.gh-add:focus-visible,\s*\n\.gh-more\.open\s*\{([^}]*)\}/u,
    );

    expect(addRule?.[1]).toBeTruthy();
    expect(moreRule?.[1]).toBeTruthy();
    expect(revealRule?.[1]).toBeTruthy();
    expect(addRule![1]).not.toContain('display: none');
    expect(moreRule![1]).not.toContain('display: none');
    expect(addRule![1]).toContain('opacity: 0');
    expect(addRule![1]).toContain('pointer-events: none');
    expect(moreRule![1]).toContain('opacity: 0');
    expect(moreRule![1]).toContain('pointer-events: none');
    expect(revealRule![1]).toContain('opacity: 1');
  });

  it('keeps the macOS brand row clear of the traffic lights', () => {
    const darwinHeaderRule = styleMatch[1].match(
      /(?:^|\n):global\(html\[data-desktop-platform='darwin'\] \.ch\)\s*\{([^}]*)\}/u,
    );

    expect(darwinHeaderRule?.[1]).toBeTruthy();
    expect(darwinHeaderRule![1]).toContain('padding-top: 20px');
    expect(darwinHeaderRule![1]).not.toContain('-webkit-app-region: drag');
  });

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
    // The footer control wears the same pill as New Session; `.settings-row.end`
    // is what carries that styling.
    expect(settings.classes()).toContain('end');
    await settings.trigger('click');
    expect(wrapper.emitted('openSettings')).toHaveLength(1);
  });

  it('starts a new session when the brand is clicked', async () => {
    const wrapper = mountSidebar();
    const brand = wrapper.get('.ch .ch-brand');
    expect(brand.attributes('aria-label')).toBe('New Session');
    await brand.trigger('click');
    expect(wrapper.emitted('create')).toHaveLength(1);
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
