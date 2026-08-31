import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/i18n';
import WorkspaceExplorer from '../src/components/WorkspaceExplorer.vue';
import type { FsEntry } from '../src/api/types';

const { listDirectory } = vi.hoisted(() => ({
  listDirectory: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getPythinkerWebApi: () => ({ listDirectory }),
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
});

describe('WorkspaceExplorer', () => {
  it('uses the folder action to close without an Open Editors section', async () => {
    listDirectory.mockResolvedValue({ items: [], truncated: false });

    const wrapper = mountExplorer();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Open Editors');
    const closeButton = wrapper.get('button[aria-label="Close Explorer"]');
    expect(closeButton.find('.ui-icon').exists()).toBe(true);

    await closeButton.trigger('click');
    expect(wrapper.emitted('close')).toEqual([[]]);
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
    expect(listDirectory).not.toHaveBeenCalled();

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
