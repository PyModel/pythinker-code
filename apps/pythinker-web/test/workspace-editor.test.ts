// Scenario: useWorkspaceEditor — open/read/save lifecycle and conflict flow.
// Responsibilities: etag tracking, dirty flag, FS_CONFLICT handling, force overwrite.
// Wiring: the composable is real; the daemon api singleton is stubbed.
// Run: pnpm --filter @pymodel/pythinker-web exec vitest run test/workspace-editor.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { DaemonApiError } from '../src/api/errors';

const apiMock = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getPythinkerWebApi: () => apiMock,
}));

// useEditorTheme instantiates useIsDark at module scope, which needs matchMedia.
vi.mock('../src/composables/useIsDark', () => ({
  useIsDark: () => ({ value: false }),
}));

import {
  closeFileEditor,
  installEditorSessionSource,
  markEditorDirty,
  openFileEditor,
  overwriteFileEditor,
  reloadFileEditor,
  registerEditorContentGetter,
  saveFileEditor,
  useWorkspaceEditorState,
} from '../src/composables/useWorkspaceEditor';
import { toMonacoHex } from '../src/composables/useEditorTheme';

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
  it('releases the saving flag when a reload supersedes an in-flight save', async () => {
    // Regression: the `finally` only cleared `saving` when the request was still
    // the newest, so a reload mid-save latched it true and disabled Save for the
    // rest of the session.
    apiMock.readFile.mockResolvedValue(readFileResult());
    await openFileEditor({ path: 'a.txt' });
    registerEditorContentGetter(() => 'two');
    markEditorDirty();

    let releaseWrite: (value: { path: string; size: number; etag: string; created: boolean }) => void =
      () => undefined;
    apiMock.writeFile.mockReturnValue(
      new Promise((resolve) => {
        releaseWrite = resolve;
      }),
    );
    const saving = saveFileEditor();
    expect(state.saving).toBe(true);

    await reloadFileEditor();
    releaseWrite({ path: 'a.txt', size: 3, etag: 'etag-2', created: false });
    await saving;

    expect(state.saving).toBe(false);

    apiMock.writeFile.mockResolvedValue({ path: 'a.txt', size: 3, etag: 'etag-3', created: false });
    await saveFileEditor();
    expect(apiMock.writeFile).toHaveBeenCalledTimes(2);
  });

  it('writes back to the session the buffer was opened from, not the active one', async () => {
    // Regression: save read the *current* active session, so switching sessions
    // with the editor open wrote the buffer into the new session's workspace.
    apiMock.readFile.mockResolvedValue(readFileResult());
    await openFileEditor({ path: 'a.txt' });
    registerEditorContentGetter(() => 'two');
    markEditorDirty();
    apiMock.writeFile.mockResolvedValue({ path: 'a.txt', size: 3, etag: 'etag-2', created: false });

    installEditorSessionSource(() => 's2');
    await saveFileEditor();

    expect(apiMock.writeFile).toHaveBeenCalledWith('s1', expect.anything());
  });
});

// Monaco's own validation regex, copied from
// monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js.
// `ColorMap.getId` throws `Illegal value for token color` on any miss, which
// takes down setTheme() and with it the whole editor.
const MONACO_COLOR = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;

describe('toMonacoHex', () => {
  it('converts the rgba() design tokens Monaco would reject', () => {
    expect(MONACO_COLOR.test('rgba(0, 0, 0, .6)')).toBe(false);
    expect(toMonacoHex('rgba(0, 0, 0, .6)', '#000000')).toBe('#00000099');
    expect(toMonacoHex('rgba(23, 131, 255, .18)', '#000000')).toBe('#1783ff2e');
    expect(toMonacoHex('rgb(23, 131, 255)', '#000000')).toBe('#1783ff');
  });

  it('passes hex through and expands the short forms', () => {
    expect(toMonacoHex('#1783ff', '#000000')).toBe('#1783ff');
    expect(toMonacoHex('#1783ff80', '#000000')).toBe('#1783ff80');
    expect(toMonacoHex('#abc', '#000000')).toBe('#aabbcc');
  });

  it('falls back rather than handing Monaco something it throws on', () => {
    expect(toMonacoHex('color-mix(in srgb, red 50%, blue)', '#123456')).toBe('#123456');
    expect(toMonacoHex('', '#123456')).toBe('#123456');
    expect(toMonacoHex('rebeccapurple', '#123456')).toBe('#123456');
  });

  it('produces a value Monaco accepts for every palette token in style.css', () => {
    // Same cwd-agnostic root resolution as css-custom-properties.test.ts.
    const src = ['src', 'apps/pythinker-web/src'].find(existsSync);
    if (src === undefined) throw new Error('the web app source directory was not found');
    const css = readFileSync(`${src}/style.css`, 'utf8');
    const declared = [...css.matchAll(/--(?:p-selection|p-bg|color-[a-z-]+):\s*([^;]+);/g)].map(
      (match) => match[1]!.trim(),
    );
    expect(declared.length).toBeGreaterThan(0);
    for (const value of declared) {
      const hex = toMonacoHex(value, '#000000');
      expect(MONACO_COLOR.test(hex), `${value} -> ${hex}`).toBe(true);
      expect(MONACO_COLOR.test(hex.slice(1, 7)), `${value} token rule`).toBe(true);
    }
  });
});
