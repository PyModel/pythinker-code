// Scenario: useWorkspaceEditor — open/read/save lifecycle and conflict flow.
// Responsibilities: etag tracking, dirty flag, FS_CONFLICT handling, force overwrite.
// Wiring: the composable is real; the daemon api singleton is stubbed.
// Run: pnpm --filter @pymodel/pythinker-web exec vitest run test/workspace-editor.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DaemonApiError } from '../src/api/errors';

const apiMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getPythinkerWebApi: () => apiMock,
}));

import {
  closeFileEditor,
  installEditorSessionSource,
  markEditorDirty,
  openFileEditor,
  overwriteFileEditor,
  registerEditorContentGetter,
  saveFileEditor,
  useWorkspaceEditorState,
} from '../src/composables/useWorkspaceEditor';

function readFileResult(overrides?: Partial<{ etag: string; encoding: string; isBinary: boolean }>): {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
  size: number;
  truncated: boolean;
  etag: string;
  mime: string;
  languageId?: string;
  lineCount?: number;
  isBinary: boolean;
} {
  return {
    path: 'a.txt',
    content: 'one',
    encoding: 'utf-8',
    size: 3,
    truncated: false,
    etag: 'etag-1',
    mime: 'text/plain',
    isBinary: false,
    ...overrides,
  };
}

function conflictError(): DaemonApiError {
  return new DaemonApiError({ code: 40928, msg: 'file changed', requestId: 'r1' });
}

describe('useWorkspaceEditor', () => {
  const state = useWorkspaceEditorState();

  beforeEach(() => {
    apiMock.readFile.mockReset();
    apiMock.writeFile.mockReset();
    installEditorSessionSource(() => 's1');
  });

  afterEach(() => {
    closeFileEditor();
    installEditorSessionSource(() => null);
  });

  it('opens a file: loads utf-8 metadata and resets on close', async () => {
    apiMock.readFile.mockResolvedValue(readFileResult({ languageId: 'typescript' }));
    await openFileEditor({ path: 'src/a.ts' });
    expect(state.open).toBe(true);
    expect(state.path).toBe('src/a.ts');
    expect(state.loading).toBe(false);
    expect(state.loadError).toBeNull();
    expect(state.languageId).toBe('typescript');

    closeFileEditor();
    expect(state.open).toBe(false);
    expect(state.path).toBeNull();
  });

  it('flags binary payloads as a load error instead of opening a buffer', async () => {
    apiMock.readFile.mockResolvedValue(readFileResult({ encoding: 'base64', isBinary: true }));
    await openFileEditor({ path: 'bin.dat' });
    expect(state.loadError).not.toBeNull();
  });

  it('save sends base_etag, stores the fresh one, and clears dirty', async () => {
    apiMock.readFile.mockResolvedValue(readFileResult());
    await openFileEditor({ path: 'a.txt' });
    registerEditorContentGetter(() => 'two');
    markEditorDirty();
    apiMock.writeFile.mockResolvedValue({ path: 'a.txt', size: 3, etag: 'etag-2', created: false });

    await saveFileEditor();

    expect(apiMock.writeFile).toHaveBeenCalledWith('s1', {
      path: 'a.txt',
      content: 'two',
      baseEtag: 'etag-1',
    });
    expect(state.dirty).toBe(false);
    expect(state.conflict).toBe(false);
    expect(state.savedAt).not.toBeNull();
  });

  it('maps an FS_CONFLICT failure to the conflict banner and blocks saves until overwrite', async () => {
    apiMock.readFile.mockResolvedValue(readFileResult());
    await openFileEditor({ path: 'a.txt' });
    registerEditorContentGetter(() => 'local edit');
    markEditorDirty();
    apiMock.writeFile.mockRejectedValue(conflictError());

    await saveFileEditor();
    expect(state.conflict).toBe(true);
    expect(state.dirty).toBe(true);

    apiMock.writeFile.mockClear();
    await saveFileEditor();
    expect(apiMock.writeFile).not.toHaveBeenCalled();

    apiMock.writeFile.mockResolvedValue({ path: 'a.txt', size: 10, etag: 'etag-3', created: false });
    await overwriteFileEditor();
    expect(apiMock.writeFile).toHaveBeenCalledWith('s1', {
      path: 'a.txt',
      content: 'local edit',
    });
    expect(state.conflict).toBe(false);
    expect(state.dirty).toBe(false);
  });

  it('reports a load error when no session is active', async () => {
    installEditorSessionSource(() => null);
    await openFileEditor({ path: 'a.txt' });
    expect(state.open).toBe(true);
    expect(state.loadError).not.toBeNull();
    expect(apiMock.readFile).not.toHaveBeenCalled();
  });
});
