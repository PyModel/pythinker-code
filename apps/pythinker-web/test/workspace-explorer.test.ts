import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/i18n';
import Sidebar from '../src/components/Sidebar.vue';
import WorkspaceExplorer from '../src/components/WorkspaceExplorer.vue';
import type { FsEntry } from '../src/api/types';
import type { Session, WorkspaceGroup } from '../src/types';

const { listDirectory, searchFiles } = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  searchFiles: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getPythinkerWebApi: () => ({ listDirectory, searchFiles }),
}));

const workspace = {
  id: 'workspace-1',
  name: 'example-project',
  root: '/work/example-project',
};

function entry(path: string, kind: FsEntry['kind']): FsEntry {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    kind,
    modifiedAt: '2026-08-30T12:00:00.000Z',
  };
}

function mountExplorer(sessionId: string | null = 'session-1') {
  return mount(WorkspaceExplorer, {
    props: { active: true, workspace, sessionId },
    global: { plugins: [i18n] },
  });
}

beforeEach(() => {
  listDirectory.mockReset();
  searchFiles.mockReset();
});

afterEach(() => vi.useRealTimers());

describe('WorkspaceExplorer', () => {
  it('opens as a dedicated files sidebar and returns to tasks', async () => {
    listDirectory.mockResolvedValue({ items: [], truncated: false });

    const wrapper = mountExplorer();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Open Editors');
    expect(wrapper.text()).toContain('Back');
    expect(wrapper.get('.ui-input[placeholder="Search files…"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('example-project');
    expect(wrapper.get('button[aria-label="Refresh files"] .ui-icon').exists()).toBe(true);
    const closeButton = wrapper.get('button[aria-label="Back"]');

    await closeButton.trigger('click');
    expect(wrapper.emitted('close')).toEqual([[]]);
  });

  it('moves focus to Back when the files sidebar opens', async () => {
    listDirectory.mockResolvedValue({ items: [], truncated: false });
    const host = document.createElement('div');
    document.body.append(host);
    const wrapper = mount(WorkspaceExplorer, {
      attachTo: host,
      props: { active: true, workspace, sessionId: 'session-1' },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    (wrapper.vm as unknown as { focus: () => void }).focus();
    expect(document.activeElement).toBe(wrapper.get('button[aria-label="Back"]').element);

    wrapper.unmount();
    host.remove();
  });

  it('searches the whole workspace and opens a matching file', async () => {
    vi.useFakeTimers();
    listDirectory.mockResolvedValue({ items: [], truncated: false });
    searchFiles.mockResolvedValue({
      items: [{
        path: 'src/index.ts',
        name: 'index.ts',
        kind: 'file',
        score: 1,
        matchPositions: [0],
      }],
      truncated: false,
    });
    const wrapper = mountExplorer();
    await flushPromises();

    await wrapper.get('input[placeholder="Search files…"]').setValue('index');
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();

    expect(searchFiles).toHaveBeenCalledWith('workspace-1', { query: 'index', limit: 100 });
    expect(wrapper.get('[data-search-path="src/index.ts"]').text()).toContain('index.ts');
    await wrapper.get('[data-search-path="src/index.ts"]').trigger('click');
    expect(wrapper.emitted('openFile')).toEqual([[{ path: 'src/index.ts' }]]);
  });

  it('loads directories first, expands them, and opens files', async () => {
    listDirectory.mockImplementation(async (_sessionId: string, input: { path: string }) => ({
      items: input.path === '.'
        ? [entry('README.md', 'file'), entry('src', 'directory')]
        : [entry('src/index.ts', 'file')],
      truncated: false,
    }));

    const wrapper = mountExplorer();
    await flushPromises();

    expect(listDirectory).toHaveBeenCalledWith('session-1', {
      path: '.',
      includeGitStatus: true,
    });
    expect(wrapper.findAll('[data-testid="workspace-tree-entry"]').map((row) => row.text()))
      .toEqual(['src', 'README.md']);

    await wrapper.get('[data-path="src"]').trigger('click');
    await flushPromises();
    expect(listDirectory).toHaveBeenLastCalledWith('session-1', {
      path: 'src',
      includeGitStatus: true,
    });

    await wrapper.get('[data-path="src/index.ts"]').trigger('click');
    expect(wrapper.emitted('openFile')).toEqual([[{ path: 'src/index.ts' }]]);
    expect(wrapper.get('[data-path="src/index.ts"]').text()).toContain('index.ts');
  });

  it('shows explicit unavailable, empty, and retry states', async () => {
    const unavailable = mountExplorer(null);
    expect(unavailable.text()).toContain('Open a conversation in this workspace to browse files.');
    expect((unavailable.get('input[placeholder="Search files…"]').element as HTMLInputElement).disabled)
      .toBe(true);
    expect(listDirectory).not.toHaveBeenCalled();
    expect(searchFiles).not.toHaveBeenCalled();

    listDirectory.mockResolvedValueOnce({ items: [], truncated: false });
    const empty = mountExplorer();
    await flushPromises();
    expect(empty.text()).toContain('This workspace has no files.');

    listDirectory.mockRejectedValueOnce(new Error('offline'));
    const failed = mountExplorer();
    await flushPromises();
    expect(failed.text()).toContain('Could not load workspace files.');
    expect(failed.get('button[data-retry-path="."]').text()).toContain('Retry');

    unavailable.unmount();
    empty.unmount();
    failed.unmount();
  });
});

describe('Sidebar files mode', () => {
  it('activates the selected workspace session before browsing and restores keyboard focus', async () => {
    listDirectory.mockResolvedValue({ items: [], truncated: false });
    const otherWorkspace = {
      id: 'workspace-2',
      name: 'other-project',
      root: '/work/other-project',
      shortPath: '/work/other-project',
      sessionCount: 1,
    };
    const sessions: Session[] = [
      { id: 'session-1', title: 'Active task', time: 'now', busy: false, workspaceId: workspace.id },
      { id: 'session-2', title: 'Other task', time: 'now', busy: false, workspaceId: otherWorkspace.id },
    ];
    const groups: WorkspaceGroup[] = [
      {
        workspace: { ...workspace, shortPath: workspace.root, sessionCount: 1 },
        sessions: [sessions[0]!],
        hasMore: false,
        loadingMore: false,
        initialCount: 1,
      },
      {
        workspace: otherWorkspace,
        sessions: [sessions[1]!],
        hasMore: false,
        loadingMore: false,
        initialCount: 1,
      },
    ];
    const host = document.createElement('div');
    document.body.append(host);
    const wrapper = mount(Sidebar, {
      attachTo: host,
      props: {
        activeWorkspace: groups[0]!.workspace,
        activeWorkspaceId: workspace.id,
        sessions,
        groups,
        activeId: 'session-1',
        workspaceSortMode: 'manual',
      },
      global: { plugins: [i18n] },
    });
    await flushPromises();

    await wrapper.get('[data-workspace-files-id="workspace-2"]').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('select')).toEqual([['session-2']]);
    expect((wrapper.get('input[placeholder="Search files…"]').element as HTMLInputElement).disabled)
      .toBe(true);
    expect(document.activeElement).toBe(wrapper.get('button[aria-label="Back"]').element);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    await flushPromises();
    expect(document.body.querySelector('.ui-dialog')).toBeNull();

    await wrapper.setProps({ activeId: 'session-2' });
    await flushPromises();
    expect((wrapper.get('input[placeholder="Search files…"]').element as HTMLInputElement).disabled)
      .toBe(false);
    expect(listDirectory).toHaveBeenCalledWith('session-2', {
      path: '.',
      includeGitStatus: true,
    });

    await wrapper.get('button[aria-label="Back"]').trigger('click');
    await flushPromises();
    expect(document.activeElement)
      .toBe(wrapper.get('[data-workspace-files-id="workspace-2"]').element);

    wrapper.unmount();
    host.remove();
  });
});
