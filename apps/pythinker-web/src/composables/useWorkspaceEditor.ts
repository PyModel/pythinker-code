// apps/pythinker-web/src/composables/useWorkspaceEditor.ts
// Workspace file editor state: open/read/save lifecycle for the right-side
// editor layer ('editor' detail target). Owns the etag-based optimistic
// concurrency flow (stale base_etag → conflict banner → reload / overwrite)
// and a content bridge registered by MonacoPane, so this module never imports
// monaco itself. Module-level singleton: App.vue, FilePreview, and EditorPanel
// share one instance.

import { reactive } from 'vue';
import { getPythinkerWebApi } from '../api';
import { isDaemonApiError } from '../api/errors';
import { i18n } from '../i18n';

const t = i18n.global.t;

const FS_CONFLICT_CODE = 40928;
// Matches the daemon's FS_READ_MAX_BYTES so large files load fully instead of
// silently truncating at the protocol's 1 MiB default.
const READ_FULL_LENGTH = 10_485_760;

export interface WorkspaceEditorState {
  open: boolean;
  path: string | null;
  loading: boolean;
  saving: boolean;
  loadError: string | null;
  savingError: string | null;
  /** True when the server reported a stale base_etag; saves are blocked until reload/overwrite. */
  conflict: boolean;
  dirty: boolean;
  /** Epoch ms of the last successful save (drives the transient "Saved" hint). */
  savedAt: number | null;
  languageId?: string;
}

const state = reactive<WorkspaceEditorState>({
  open: false,
  path: null,
  loading: false,
  saving: false,
  loadError: null,
  savingError: null,
  conflict: false,
  dirty: false,
  savedAt: null,
  languageId: undefined,
});

let etag: string | null = null;
let requestSeq = 0;
// The session the open buffer was read from. saveFileEditor writes back to
// *this* session, not whichever one is active when the user hits Save: the
// editor stays open across a session switch, and each session resolves paths
// against its own workspace root.
let openSessionId: string | null = null;

const bridge: { getContent: (() => string) | null } = { getContent: null };

/** Called by MonacoPane once its model exists; supplies the live buffer text for save(). */
export function registerEditorContentGetter(getContent: (() => string) | null): void {
  bridge.getContent = getContent;
}

export function useWorkspaceEditorState(): WorkspaceEditorState {
  return state;
}

function reset(): void {
  requestSeq += 1;
  state.path = null;
  state.loading = false;
  state.saving = false;
  state.loadError = null;
  state.savingError = null;
  state.conflict = false;
  state.dirty = false;
  state.savedAt = null;
  state.languageId = undefined;
  etag = null;
  openSessionId = null;
}

export async function openFileEditor(target: { path: string; line?: number }): Promise<void> {
  const sid = getActiveSessionId();
  if (!sid) {
    requestSeq += 1;
    state.open = true;
    state.path = target.path;
    state.loading = false;
    state.loadError = t('editor.readOnlyWhileMissingSession');
    state.savingError = null;
    state.conflict = false;
    state.dirty = false;
    state.savedAt = null;
    state.languageId = undefined;
    state.saving = false;
    etag = null;
    openSessionId = null;
    return;
  }
  const seq = ++requestSeq;
  state.open = true;
  state.path = target.path;
  state.loading = true;
  state.saving = false;
  state.loadError = null;
  state.savingError = null;
  state.conflict = false;
  state.dirty = false;
  state.savedAt = null;
  state.languageId = undefined;
  etag = null;
  openSessionId = sid;

  try {
    const result = await getPythinkerWebApi().readFile(sid, {
      path: target.path,
      length: READ_FULL_LENGTH,
      encoding: 'utf-8',
    });
    if (seq !== requestSeq) return;
    if (result.isBinary || result.encoding !== 'utf-8') {
      state.loadError = t('editor.binaryNotEditable');
      return;
    }
    etag = result.etag;
    state.languageId = result.languageId;
    pendingContent = result.content;
    pendingLine = target.line;
    contentRevision += 1;
  } catch (error) {
    if (seq !== requestSeq) return;
    etag = null;
    state.loadError =
      error instanceof Error && error.message.length > 0 ? error.message : t('editor.loadFailed');
  } finally {
    if (seq === requestSeq) state.loading = false;
  }
}

/** Fresh buffer text produced by openFileEditor; MonacoPane consumes + clears it. */
let pendingContent: string | undefined;
let pendingLine: number | undefined;
let contentRevision = 0;

export function consumePendingContent(): { content: string; line?: number; revision: number } | null {
  if (pendingContent === undefined) return null;
  const out = { content: pendingContent, line: pendingLine, revision: contentRevision };
  pendingContent = undefined;
  pendingLine = undefined;
  return out;
}

/** Marks the buffer mutated (wired to the monaco model's onDidChangeContent). */
export function markEditorDirty(): void {
  if (!state.dirty) {
    state.dirty = true;
    state.savedAt = null;
  }
  if (state.savingError !== null) state.savingError = null;
}

export function closeFileEditor(): void {
  reset();
  state.open = false;
}

export async function reloadFileEditor(): Promise<void> {
  if (state.path === null) return;
  await openFileEditor({ path: state.path });
}

export async function saveFileEditor(options?: { force?: boolean }): Promise<void> {
  const sid = openSessionId;
  const path = state.path;
  if (!sid || !path || state.saving || state.loading || state.conflict) return;
  const getContent = bridge.getContent;
  if (!getContent) return;

  const seq = ++requestSeq;
  state.saving = true;
  state.savingError = null;
  try {
    const result = await getPythinkerWebApi().writeFile(sid, {
      path,
      content: getContent(),
      ...(options?.force === true || etag === null ? {} : { baseEtag: etag }),
    });
    if (seq !== requestSeq) return;
    etag = result.etag;
    state.dirty = false;
    state.conflict = false;
    state.savedAt = Date.now();
  } catch (error) {
    if (seq !== requestSeq) return;
    if (isDaemonApiError(error) && error.code === FS_CONFLICT_CODE) {
      state.conflict = true;
      return;
    }
    state.savingError =
      error instanceof Error && error.message.length > 0 ? error.message : t('editor.loadFailed');
  } finally {
    // Unconditional: a save superseded by open/reset must still release the
    // flag, or `state.saving` latches true and blocks every later save. Two
    // saves never overlap (the guard above returns while one is in flight),
    // so nothing else can own it.
    state.saving = false;
  }
}

export async function overwriteFileEditor(): Promise<void> {
  state.conflict = false;
  await saveFileEditor({ force: true });
}

function getActiveSessionId(): string | null {
  return sessionSource?.() ?? null;
}

// Live source of the active session id, installed once by the app facade
// (usePythinkerWebClient) so editor actions always target the current session.
let sessionSource: (() => string | null) | null = null;

export function installEditorSessionSource(getSessionId: () => string | null): void {
  sessionSource = getSessionId;
}
