// apps/pythinker-web/src/composables/useFilePreview.ts
// File preview: download / path normalization / request-sequence guard. Claims
// the 'file' slot of the shared right-side detail layer.

import { computed, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getPythinkerWebApi } from '../api';
import type { FileData, FilePreviewRequest, ToolMedia } from '../types';
import type { usePythinkerWebClient } from './usePythinkerWebClient';

type PythinkerWebClient = ReturnType<typeof usePythinkerWebClient>;

/** Which occupant currently owns the shared right-side detail layer. */
export type DetailTarget = 'file' | 'diff' | 'thinking' | 'compaction' | 'agent' | 'toolDiff' | 'turnDiff' | 'btw';

/** Whether a url can feed a native <video>/<img> src. A provider reference like
 *  `ms://…` has no local bytes and only yields a broken player, so it's treated
 *  as non-loadable and falls through to the no-preview card. */
export function isPlayableMediaUrl(url: string): boolean {
  return /^(?:https?:|blob:|data:)/i.test(url);
}

export async function resolveMediaUrl(
  media: ToolMedia,
): Promise<{ url: string; revoke?: () => void }> {
  if (!media.fileId) return { url: media.url };
  try {
    const blob = await getPythinkerWebApi().getFileBlob(media.fileId);
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  } catch {
    return { url: media.url };
  }
}

export interface UseFilePreviewOptions {
  client: PythinkerWebClient;
  detailTarget: Ref<DetailTarget | null>;
}

export function useFilePreview({ client, detailTarget }: UseFilePreviewOptions) {
  const { t } = useI18n();

  const previewTarget = ref<FilePreviewRequest | null>(null);
  const previewFile = ref<FileData | null>(null);
  const previewLoading = ref(false);
  const previewError = ref<string | null>(null);
  // Normalized workspace-relative path of the currently-open preview. Used for
  // the download URL so it matches the server's relative-path contract even when
  // the user opened the preview from an absolute path in the chat.
  const previewNormalizedPath = ref<string | null>(null);
  // Incremented on every openFilePreview call so a slower earlier request can't
  // overwrite the result of a later one (request-sequence guard).
  let previewRequestSeq = 0;
  const previewDownloadUrl = computed(() => {
    const path = previewNormalizedPath.value;
    return path ? client.getFileDownloadUrl(path) : null;
  });
  const previewExternalActions = computed(() => previewTarget.value !== null);

  function trimTrailingSlash(path: string): string {
    return path.length > 1 ? path.replace(/\/+$/, '') : path;
  }

  function normalizeRelativePath(path: string): string {
    const out: string[] = [];
    for (const part of path.split(/[\\/]+/)) {
      if (!part || part === '.') continue;
      if (part === '..') {
        out.pop();
        continue;
      }
      out.push(part);
    }
    return out.join('/');
  }

  function normalizePreviewPath(inputPath: string): { path: string } | { error: string } {
    const raw = inputPath.trim();
    if (!raw) return { error: t('filePreview.errors.emptyPath') };
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      return { error: t('filePreview.errors.unsupportedPath') };
    }
    if (raw.startsWith('~')) {
      return { error: t('filePreview.errors.outsideWorkspace') };
    }

    const cwd = trimTrailingSlash(client.status.value.cwd);
    if (raw.startsWith('/')) {
      if (!cwd || (raw !== cwd && !raw.startsWith(`${cwd}/`))) {
        return { error: t('filePreview.errors.outsideWorkspace') };
      }
      const relative = raw === cwd ? '' : raw.slice(cwd.length + 1);
      if (relative.split(/[\\/]+/).includes('..')) {
        return { error: t('filePreview.errors.outsideWorkspace') };
      }
      const path = normalizeRelativePath(relative);
      return path ? { path } : { error: t('filePreview.errors.isDirectory') };
    }

    if (raw.split(/[\\/]+/).includes('..')) {
      return { error: t('filePreview.errors.outsideWorkspace') };
    }

    const path = normalizeRelativePath(raw);
    return path ? { path } : { error: t('filePreview.errors.emptyPath') };
  }

  async function openFilePreview(target: FilePreviewRequest): Promise<void> {
    // Clicking the link for the already-open file toggles the panel closed.
    const current = previewTarget.value;
    if (
      detailTarget.value === 'file' &&
      current &&
      current.path === target.path &&
      current.line === target.line
    ) {
      closeFilePreview();
      return;
    }
    const requestSeq = ++previewRequestSeq;
    detailTarget.value = 'file';
    previewFile.value = null;
    previewError.value = null;
    previewLoading.value = true;
    previewTarget.value = target;
    previewNormalizedPath.value = null;

    const normalized = normalizePreviewPath(target.path);
    if ('error' in normalized) {
      previewLoading.value = false;
      previewError.value = normalized.error;
      return;
    }
    previewNormalizedPath.value = normalized.path;

    try {
      const result = await client.readFileContent(normalized.path);
      // A newer openFilePreview started while this one was in flight — discard
      // the stale result so the right-side panel shows the latest file.
      if (requestSeq !== previewRequestSeq) return;
      if (result) {
        previewFile.value = { ...result, path: result.path || normalized.path };
      } else {
        // readFileContent swallows daemon failures into null — show the error
        // state instead of a misleading 0-byte "empty file" (the cause is
        // already console.warn'd in readFileContent).
        previewError.value = t('filePreview.errors.loadFailed');
      }
    } catch (err) {
      if (requestSeq !== previewRequestSeq) return;
      previewError.value = err instanceof Error ? err.message : t('filePreview.errors.loadFailed');
    } finally {
      if (requestSeq === previewRequestSeq) {
        previewLoading.value = false;
      }
    }
  }

  function resetFilePreview(): void {
    previewRequestSeq += 1;
    previewTarget.value = null;
    previewNormalizedPath.value = null;
    previewFile.value = null;
    previewError.value = null;
    previewLoading.value = false;
  }

  function closeFilePreview(): void {
    resetFilePreview();
    if (detailTarget.value === 'file') detailTarget.value = null;
  }

  watch(detailTarget, (target, oldTarget) => {
    if (oldTarget === 'file' && target !== 'file') resetFilePreview();
  });

  function openPreviewInEditor(): void {
    const path = previewFile.value?.path ?? previewTarget.value?.path;
    if (!path) return;
    void client.openWorkspaceFile(path, previewTarget.value?.line);
  }

  function revealPreviewFile(): void {
    const path = previewFile.value?.path ?? previewTarget.value?.path;
    if (!path) return;
    void client.revealWorkspaceFile(path);
  }

  return {
    previewTarget,
    previewFile,
    previewLoading,
    previewError,
    previewDownloadUrl,
    previewExternalActions,
    openFilePreview,
    closeFilePreview,
    openPreviewInEditor,
    revealPreviewFile,
  };
}
