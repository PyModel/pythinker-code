import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, type Ref } from 'vue';
import { useMentionMenu, type MentionItem, type MentionSkillItem } from '../src/composables/useMentionMenu';
import type { FileItem } from '../src/types';

interface MockTextarea {
  value: string;
  selectionStart: number;
  setSelectionRange: (start: number, end: number) => void;
  focus: () => void;
}

interface SetupOptions {
  searchFiles?: (q: string) => Promise<FileItem[]>;
  searchSkills?: (q: string) => Promise<MentionSkillItem[]>;
  insertSkill?: (name: string) => void;
}

function setup(initialText = '', options: SetupOptions = {}) {
  const textarea: MockTextarea = {
    value: initialText,
    // Caret defaults to the end of the text.
    selectionStart: initialText.length,
    setSelectionRange(start: number) {
      this.selectionStart = start;
    },
    focus: () => {},
  };
  const text = ref(initialText);
  const textareaRef = ref(textarea as unknown as HTMLTextAreaElement) as Ref<HTMLTextAreaElement | null>;
  const mention = useMentionMenu({
    text,
    textareaRef,
    autosize: () => {},
    searchFiles: () => options.searchFiles,
    searchSkills: () => options.searchSkills,
    insertSkill: options.insertSkill,
  });
  return { text, textarea, mention };
}

describe('useMentionMenu — update', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays closed when there is no @token', async () => {
    const searchFiles = vi.fn().mockResolvedValue([]);
    const { mention } = setup('hello', { searchFiles });
    mention.update();
    await vi.advanceTimersByTimeAsync(200);
    expect(mention.open.value).toBe(false);
    expect(searchFiles).not.toHaveBeenCalled();
  });

  it('stays closed when searchFiles is not provided', async () => {
    const { mention } = setup('@a');
    mention.update();
    await vi.advanceTimersByTimeAsync(200);
    expect(mention.open.value).toBe(false);
  });

  it('opens with search results after the debounce', async () => {
    const searchFiles = vi.fn().mockResolvedValue([{ path: 'src/a.ts', name: 'a.ts' }]);
    const { mention } = setup('@a', { searchFiles });
    mention.update();
    expect(mention.open.value).toBe(false); // debounced, not yet
    await vi.advanceTimersByTimeAsync(200);
    expect(searchFiles).toHaveBeenCalledWith('a');
    expect(mention.open.value).toBe(true);
    expect(mention.items.value).toEqual([
      { kind: 'file', file: { path: 'src/a.ts', name: 'a.ts', matchPositions: [4] } },
    ]);
    expect(mention.loading.value).toBe(false);
    expect(mention.active.value).toBe(0);
    expect(mention.stale.value).toBe(false);
  });

  it('classifies folder paths and records every matched character', async () => {
    const searchFiles = vi.fn().mockResolvedValue([
      { path: 'docs/notes/', name: 'notes' },
      { path: 'src/App.vue', name: 'App.vue' },
    ]);
    const { mention } = setup('@app', { searchFiles });
    mention.update();
    await vi.advanceTimersByTimeAsync(200);
    expect(mention.items.value).toEqual([
      { kind: 'folder', file: { path: 'docs/notes/', name: 'notes', matchPositions: [] } },
      { kind: 'file', file: { path: 'src/App.vue', name: 'App.vue', matchPositions: [4, 5, 6] } },
    ]);
  });

  it('clears items and stops loading when the search throws', async () => {
    const searchFiles = vi.fn().mockRejectedValue(new Error('boom'));
    const { mention } = setup('@a', { searchFiles });
    mention.update();
    await vi.advanceTimersByTimeAsync(200);
    expect(mention.items.value).toEqual([]);
    expect(mention.loading.value).toBe(false);
  });

  it('marks the visible items stale while a newer search is in flight', async () => {
    let resolveSecond: (items: FileItem[]) => void = () => {};
    const searchFiles = vi
      .fn()
      .mockResolvedValueOnce([{ path: 'src/a.ts', name: 'a.ts' }])
      .mockImplementationOnce(
        () => new Promise<FileItem[]>((resolve) => { resolveSecond = resolve; }),
      );
    const { mention } = setup('@a', { searchFiles });
    mention.update();
    await vi.advanceTimersByTimeAsync(200);
    expect(mention.items.value).toHaveLength(1);
    expect(mention.stale.value).toBe(false);

    // Search again (same token): the old results stay visible but dim.
    mention.update();
    expect(mention.stale.value).toBe(false); // still debounced
    await vi.advanceTimersByTimeAsync(200);
    expect(mention.stale.value).toBe(true); // second search in flight

    resolveSecond([{ path: 'src/b.ts', name: 'b.ts' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mention.stale.value).toBe(false);
    expect((mention.items.value[0] as { file: FileItem }).file.path).toBe('src/b.ts');
  });

  it('does not apply results from a superseded search', async () => {
    let resolveFirst: (items: FileItem[]) => void = () => {};
    const searchFiles = vi
      .fn()
      .mockImplementationOnce(() => new Promise<FileItem[]>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([{ path: 'src/b.ts', name: 'b.ts' }]);
    const { mention } = setup('@a', { searchFiles });
    mention.update();
    await vi.advanceTimersByTimeAsync(200);
    // A second update supersedes the in-flight first search.
    mention.update();
    await vi.advanceTimersByTimeAsync(200);
    resolveFirst([{ path: 'src/old.ts', name: 'old.ts' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mention.items.value).toEqual([
      { kind: 'file', file: { path: 'src/b.ts', name: 'b.ts', matchPositions: [] } },
    ]);
  });

  it('merges skill rows from an optional skill search', async () => {
    const searchFiles = vi.fn().mockResolvedValue([{ path: 'src/a.ts', name: 'a.ts' }]);
    const searchSkills = vi.fn().mockResolvedValue([{ name: 'agent', description: 'Run the agent' }]);
    const { mention } = setup('@ag', { searchFiles, searchSkills });
    mention.update();
    await vi.advanceTimersByTimeAsync(200);
    expect(searchSkills).toHaveBeenCalledWith('ag');
    expect(mention.items.value).toEqual([
      { kind: 'file', file: { path: 'src/a.ts', name: 'a.ts', matchPositions: [] } },
      { kind: 'skill', skill: { name: 'agent', description: 'Run the agent' }, matchPositions: [0, 1] },
    ]);
  });
});

describe('useMentionMenu — select', () => {
  it('replaces the @token with the chosen path', async () => {
    const { text, textarea, mention } = setup('hello @a');
    textarea.value = 'hello @a';
    mention.select({ kind: 'file', file: { path: 'src/a.ts', name: 'a.ts', matchPositions: [] } });
    expect(text.value).toBe('hello [a.ts](src/a.ts) ');
    expect(mention.open.value).toBe(false);
    await nextTick();
  });

  it('is a no-op when there is no @token', () => {
    const { text, mention } = setup('hello');
    mention.select({ kind: 'file', file: { path: 'src/a.ts', name: 'a.ts', matchPositions: [] } });
    expect(text.value).toBe('hello');
  });

  it('selecting a skill closes the menu and calls the optional insert hook', async () => {
    const insertSkill = vi.fn();
    const { text, textarea, mention } = setup('hello @ag', { insertSkill });
    textarea.value = 'hello @ag';
    const skillItem: MentionItem = { kind: 'skill', skill: { name: 'agent' }, matchPositions: [0, 1] };
    mention.select(skillItem);
    expect(text.value).toBe('hello @ag');
    expect(insertSkill).toHaveBeenCalledWith('agent');
    expect(mention.open.value).toBe(false);
    await nextTick();
  });

  it('selecting a skill without an insert hook just closes the menu', () => {
    const { text, textarea, mention } = setup('hello @ag');
    textarea.value = 'hello @ag';
    mention.select({ kind: 'skill', skill: { name: 'agent' }, matchPositions: [] });
    expect(text.value).toBe('hello @ag');
    expect(mention.open.value).toBe(false);
  });
});