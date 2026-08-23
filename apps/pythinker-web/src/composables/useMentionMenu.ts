// apps/pythinker-web/src/composables/useMentionMenu.ts
import { nextTick, ref, type Ref } from 'vue';
import type { FileItem } from '../types';
import { serializeMention } from '../lib/mentions';
import { matchPositions } from '../lib/matchHighlight';

/** A skill row in the @-mention menu (`listSkills`-scoped search results). */
export interface MentionSkillItem {
  name: string;
  description?: string;
}

/** A row in the @-mention menu: a workspace file/folder or a skill. */
export type MentionItem =
  | {
      kind: 'file' | 'folder';
      file: FileItem & { matchPositions?: number[] };
    }
  | { kind: 'skill'; skill: MentionSkillItem; matchPositions?: number[] };

export interface MentionMenuDeps {
  /** The live composer text — the @token is read from it and rewritten on select. */
  text: Ref<string>;
  /** The textarea element, used to read the caret and place it after insertion. */
  textareaRef: Ref<HTMLTextAreaElement | null>;
  /** Re-fit the textarea after its text changes. */
  autosize: () => void;
  /** File search for the @-query (getter; undefined disables the menu). */
  searchFiles: () => ((q: string) => Promise<FileItem[]>) | undefined;
  /**
   * Optional skill search (getter), e.g. workspace skills via listSkills /
   * listSkillsForWorkspace. When provided, skill rows appear alongside files.
   * The daemon does not send match positions for skills, so positions are
   * computed client-side from the query.
   */
  searchSkills?: () => ((q: string) => Promise<MentionSkillItem[]>) | undefined;
  /**
   * Optional insertion hook for a selected skill. Serializing a skill mention
   * needs a parent-side callback; without one, selecting a skill closes the
   * menu without inserting anything.
   */
  insertSkill?: (name: string) => void;
}

interface MentionToken {
  token: string;
  start: number;
  end: number;
}

/**
 * `@` mention menu: token detection, debounced search (files + optional
 * skills), keyboard navigation state, insertion, and the "stale" flag shown
 * while a newer search supersedes the visible results.
 *
 * The composer keeps the keydown orchestration (arrow keys, Enter/Tab, Escape)
 * because it also juggles the slash menu and history recall; this composable
 * owns the menu's open/items/active/loading/stale state and the search/insert
 * logic.
 */
export function useMentionMenu(deps: MentionMenuDeps) {
  const { text, textareaRef, autosize, searchFiles, searchSkills, insertSkill } = deps;

  const open = ref(false);
  const items = ref<MentionItem[]>([]);
  const active = ref(0);
  const loading = ref(false);
  /** True while the visible results are for an older query (new search in flight). */
  const stale = ref(false);

  // Debounce timer for the search + a generation counter so a superseded
  // in-flight search can never overwrite newer results.
  let timer: ReturnType<typeof setTimeout> | null = null;
  let searchId = 0;

  /** Find the @token under the cursor in the current text value. Returns null if none. */
  function getMentionToken(): MentionToken | null {
    const val = text.value;
    const pos = textareaRef.value?.selectionStart ?? val.length;
    // Walk backwards from the cursor to find the start of a @token.
    let start = pos - 1;
    while (start >= 0 && !/\s/.test(val[start]!)) {
      start--;
    }
    start++;
    const tokenPart = val.slice(start, pos);
    if (!tokenPart.startsWith('@')) return null;
    // The end of the token is where the cursor is (or after the next space).
    return { token: tokenPart.slice(1), start, end: pos };
  }

  function update(): void {
    const mt = getMentionToken();
    const search = searchFiles();
    const skillSearch = searchSkills?.();
    if (!mt || (!search && !skillSearch)) {
      open.value = false;
      stale.value = false;
      return;
    }
    const query = mt.token;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(async () => {
      const runId = ++searchId;
      loading.value = true;
      open.value = true;
      active.value = 0;
      // A new query while the previous results are still visible: keep them on
      // screen (dimmed via the menu's `stale` state) until the new ones land.
      if (items.value.length > 0) stale.value = true;
      try {
        const [files, skills] = await Promise.all([
          search ? search(query).catch(() => [] as FileItem[]) : Promise.resolve([] as FileItem[]),
          skillSearch ? skillSearch(query).catch(() => [] as MentionSkillItem[]) : Promise.resolve([] as MentionSkillItem[]),
        ]);
        if (runId !== searchId) return;
        items.value = [
          ...files.map((f) => ({
            kind: (f.path.endsWith('/') ? 'folder' : 'file') as 'file' | 'folder',
            file: { ...f, matchPositions: matchPositions(query, f.path) },
          })),
          ...skills.map((s) => ({
            kind: 'skill' as const,
            skill: s,
            matchPositions: matchPositions(query, s.name),
          })),
        ];
      } catch {
        if (runId === searchId) items.value = [];
      } finally {
        if (runId === searchId) {
          loading.value = false;
          stale.value = false;
        }
      }
    }, 200);
  }

  function select(item: MentionItem): void {
    const mt = getMentionToken();
    if (!mt) return;
    open.value = false;
    // Skills are not plain file mentions: hand the choice to the parent hook
    // (if any) and otherwise just dismiss the menu.
    if (item.kind === 'skill') {
      insertSkill?.(item.skill.name);
      return;
    }
    const val = text.value;
    const name = item.file.name || item.file.path.split(/[\\/]/).findLast(Boolean) || item.file.path;
    const mention = serializeMention({
      kind: item.kind,
      name,
      path: item.file.path,
    });
    text.value = `${val.slice(0, mt.start)}${mention} ${val.slice(mt.end)}`;
    void nextTick(() => {
      const el = textareaRef.value;
      if (!el) return;
      const newPos = mt.start + mention.length + 1;
      el.setSelectionRange(newPos, newPos);
      el.focus();
      autosize();
    });
  }

  return { open, items, active, loading, stale, update, select };
}