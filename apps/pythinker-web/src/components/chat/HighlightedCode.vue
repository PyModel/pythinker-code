<!-- apps/pythinker-web/src/components/chat/HighlightedCode.vue -->
<!-- Shiki-based line-level code / unified-diff renderer. Two modes, switched
     by which prop is present:
       · `lines`  — unified-diff rows (DiffViewLine[]): '+/-' sign, optional
         old/new gutters, per-type row backgrounds. The before/after sides are
         tokenized from full texts reconstructed from the rows, or from the
         `fullTexts` prop when a consumer has them.
       · `code`   — plain code lines (string | string[]); an explicit
         `lineNumbers` array renders a gutter.
     The language is inferred from `path`. Highlighting happens async with a
     200ms coalescing debounce; unknown languages degrade to plain text. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { codeToTokens } from 'shiki';
import type { DiffViewLine } from '../../types';
import { useIsDark } from '../../composables/useIsDark';

interface HighlightToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

type CodeToTokensLang = Parameters<typeof codeToTokens>[1]['lang'];

// Extension → Shiki language id.
const EXT_LANG: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  vue: 'vue', svelte: 'svelte', py: 'py', rb: 'rb', go: 'go', rs: 'rs',
  java: 'java', kt: 'kt', kts: 'kts', scala: 'scala', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'cs',
  php: 'php', sh: 'sh', bash: 'bash', zsh: 'zsh', fish: 'fish', ps1: 'ps1',
  bat: 'bat', cmd: 'bat', sql: 'sql', graphql: 'graphql', prisma: 'prisma',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss',
  sass: 'sass', less: 'less', json: 'json', jsonc: 'jsonc', json5: 'json5',
  yaml: 'yaml', yml: 'yml', toml: 'toml', ini: 'ini', md: 'md',
  markdown: 'markdown', mdx: 'mdx', lua: 'lua', r: 'r', dart: 'dart',
  zig: 'zig', mk: 'makefile', cmake: 'cmake', diff: 'diff', proto: 'proto',
};
// Whole-filename → Shiki language id.
const NAME_LANG: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'cmakelists.txt': 'cmake',
};

function langFromPath(path: string | undefined): CodeToTokensLang | undefined {
  const name = path?.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (!name) return undefined;
  const byName = NAME_LANG[name];
  if (byName) return byName as CodeToTokensLang;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  return EXT_LANG[name.slice(dot + 1)] as CodeToTokensLang;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Shiki token → inline style. bit 1 = italic, 2 = semibold, 4 = underline. */
function tokenStyle(token: HighlightToken): Record<string, string> {
  const style: Record<string, string> = {};
  if (token.color) style.color = token.color;
  const bits = token.fontStyle ?? 0;
  if (bits & 1) style.fontStyle = 'italic';
  if (bits & 2) style.fontWeight = 'var(--weight-semibold)';
  if (bits & 4) style.textDecoration = 'underline';
  return style;
}

const props = withDefaults(
  defineProps<{
    /** Code to highlight (string or array of lines). Exclusive with `lines`. */
    code?: string | string[];
    /** Unified-diff rows; when present the component renders a diff. */
    lines?: DiffViewLine[];
    /** File path; its extension picks the Shiki language. */
    path?: string;
    /** `true` → old/new gutters in diff mode; a number[] → gutter in code mode. */
    lineNumbers?: boolean | number[];
    /** Framed look (border + internal scroll + max-height). Default true. */
    framed?: boolean;
    /** Full before/after texts, for whole-file tokenization of diff sides. */
    fullTexts?: { before?: string; after?: string } | null;
    /** Extra class for a code row, keyed by that row's line number. */
    lineClass?: (lineNumber: number) => string;
  }>(),
  { lineNumbers: false, framed: true, fullTexts: null },
);

const isDark = useIsDark();

const isDiffMode = computed(() => props.lines !== undefined);
const hasOldNos = computed(() => (props.lines ?? []).some((line) => line.oldNo !== undefined));
const hasNewNos = computed(() => (props.lines ?? []).some((line) => line.newNo !== undefined));
const showGutter = computed(() => props.lineNumbers === true && isDiffMode.value);
const numberList = computed<number[] | null>(() =>
  Array.isArray(props.lineNumbers) ? props.lineNumbers : null,
);
const codeLines = computed<string[]>(() => {
  if (Array.isArray(props.code)) return props.code;
  return splitLines(props.code ?? '');
});

// Full texts for each diff side: the caller's, or reconstructed from the rows.
const fullTexts = computed<{ before?: string; after?: string } | null>(() => {
  const rows = props.lines;
  if (!rows) return null;
  if (props.fullTexts) return props.fullTexts;
  return {
    before: rows.filter((line) => line.oldNo !== undefined).map((line) => line.text).join('\n'),
    after: rows.filter((line) => line.newNo !== undefined).map((line) => line.text).join('\n'),
  };
});

const codeTokens = ref<HighlightToken[][] | null>(null);
const beforeTokens = ref<HighlightToken[][] | null>(null);
const afterTokens = ref<HighlightToken[][] | null>(null);

function resetTokens(): void {
  codeTokens.value = null;
  beforeTokens.value = null;
  afterTokens.value = null;
}

// --- async highlighting: 200ms coalescing debounce + stale-response guard ---
const DEBOUNCE_MS = 200;
let currentRun = 0;
let lastRunAt = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let codeToTokensPromise: Promise<typeof codeToTokens> | null = null;

async function loadTokens(): Promise<void> {
  const runId = ++currentRun;
  lastRunAt = Date.now();
  const language = langFromPath(props.path);
  if (!language) {
    if (runId === currentRun) resetTokens();
    return;
  }
  try {
    codeToTokensPromise ??= import('shiki').then((m) => m.codeToTokens);
    const tokenizer = await codeToTokensPromise;
    const theme = isDark.value ? 'github-dark' : 'github-light';
    const texts = fullTexts.value;
    if (texts) {
      const [before, after] = await Promise.all([
        texts.before ? tokenizer(texts.before, { lang: language, theme }) : null,
        texts.after ? tokenizer(texts.after, { lang: language, theme }) : null,
      ]);
      if (runId !== currentRun) return;
      beforeTokens.value = before?.tokens ?? null;
      afterTokens.value = after?.tokens ?? null;
    } else {
      const result =
        codeLines.value.length > 0
          ? await tokenizer(codeLines.value.join('\n'), { lang: language, theme })
          : null;
      if (runId !== currentRun) return;
      codeTokens.value = result?.tokens ?? null;
    }
  } catch {
    // Unknown language or a shiki failure → keep plain text.
    if (runId === currentRun) resetTokens();
  }
}

function scheduleLoad(): void {
  if (debounceTimer !== null) return;
  const delay = Math.max(0, DEBOUNCE_MS - (Date.now() - lastRunAt));
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void loadTokens();
  }, delay);
}

watch(
  [
    () => codeLines.value.join('\n'),
    () => fullTexts.value?.before ?? null,
    () => fullTexts.value?.after ?? null,
  ],
  scheduleLoad,
);
watch([() => props.path, isDark, () => props.fullTexts], () => {
  currentRun++;
  resetTokens();
  scheduleLoad();
});

onMounted(() => void loadTokens());
onBeforeUnmount(() => {
  currentRun++;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
});

// oldNo → index among the rows that carry an old number (tokens row index).
const oldIndexMap = computed(() => {
  const map = new Map<number, number>();
  let index = 0;
  for (const line of props.lines ?? []) {
    if (line.oldNo !== undefined) map.set(line.oldNo, index++);
  }
  return map;
});
const newIndexMap = computed(() => {
  const map = new Map<number, number>();
  let index = 0;
  for (const line of props.lines ?? []) {
    if (line.newNo !== undefined) map.set(line.newNo, index++);
  }
  return map;
});

/** Token rows for a diff row: del rows read the before side, add/context rows
 *  the after side. Null → render the raw text. */
function tokenLine(line: DiffViewLine): HighlightToken[] | null {
  if (line.type === 'del') {
    if (line.oldNo === undefined) return null;
    const index = props.fullTexts ? line.oldNo - 1 : oldIndexMap.value.get(line.oldNo);
    return index === undefined ? null : beforeTokens.value?.[index] ?? null;
  }
  if (line.newNo === undefined) return null;
  const index = props.fullTexts ? line.newNo - 1 : newIndexMap.value.get(line.newNo);
  return index === undefined ? null : afterTokens.value?.[index] ?? null;
}

function sign(line: DiffViewLine): string {
  return line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
}

// Gutter width grows with the largest line number (min 4ch).
const gutterChars = computed(() => {
  let max = 0;
  if (numberList.value) {
    for (const number of numberList.value) {
      if (number > max) max = number;
    }
  } else {
    for (const line of props.lines ?? []) {
      if (line.oldNo !== undefined && line.oldNo > max) max = line.oldNo;
      if (line.newNo !== undefined && line.newNo > max) max = line.newNo;
    }
  }
  return Math.max(4, String(max).length);
});
</script>

<template>
  <div
    class="hl-code"
    :class="{ gutter: showGutter, 'plain-pad': !isDiffMode && numberList === null, framed }"
    :style="{ '--gutter-ch': `${gutterChars}ch` }"
  >
    <div class="hl-body">
      <template v-if="isDiffMode">
        <div v-for="(line, i) in lines" :key="i" class="hl-row" :class="`row-${line.type}`">
          <template v-if="showGutter">
            <span v-if="hasOldNos" class="hl-gutter">{{ line.oldNo ?? '' }}</span>
            <span v-if="hasNewNos" class="hl-gutter new">{{ line.newNo ?? '' }}</span>
          </template>
          <span class="hl-sign">{{ sign(line) }}</span>
          <span class="hl-text">
            <template v-if="tokenLine(line)">
              <span v-for="(token, j) in tokenLine(line)" :key="j" :style="tokenStyle(token)">{{ token.content }}</span>
            </template>
            <template v-else>{{ line.text }}</template>
          </span>
        </div>
      </template>
      <template v-else>
        <div
          v-for="(lineText, i) in codeLines"
          :key="i"
          class="hl-row"
          :class="lineClass ? lineClass(numberList?.[i] ?? -1) : undefined"
          :data-line="numberList ? numberList[i] : undefined"
        >
          <span v-if="numberList" class="hl-gutter">{{ numberList[i] ?? '' }}</span>
          <span class="hl-text">
            <template v-if="codeTokens && codeTokens[i]">
              <span v-for="(token, j) in codeTokens[i]" :key="j" :style="tokenStyle(token)">{{ token.content }}</span>
            </template>
            <template v-else>{{ lineText }}</template>
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.hl-code {
  border: 0.5px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-well);
  overflow: auto;
  max-height: calc(24 * 1.5 * var(--ui-font-size));
  overscroll-behavior: contain;
  font-family: var(--font-mono);
  font-size: var(--code-font-size);
  line-height: var(--leading-normal);
  font-feature-settings: 'liga' 0, 'calt' 0;
  font-variant-ligatures: none;
}
.hl-code:not(.framed) {
  border: none;
  border-radius: 0;
  background: transparent;
  max-height: none;
  overflow: visible;
}
.hl-body {
  width: max-content;
  min-width: 100%;
  padding: var(--space-1) 0 var(--space-2);
}
.hl-code.plain-pad .hl-body {
  padding-left: var(--space-3);
}
.hl-row {
  display: flex;
  align-items: flex-start;
  min-height: calc(1em * var(--leading-normal));
  white-space: pre;
  width: 100%;
}
.hl-gutter {
  flex: none;
  box-sizing: content-box;
  min-width: var(--gutter-ch, 4ch);
  padding: 0 var(--space-2);
  text-align: right;
  color: var(--color-text-faint);
  user-select: none;
  border-right: 0.5px solid var(--color-line);
  font-variant-numeric: tabular-nums;
}
.hl-sign {
  flex: none;
  width: 16px;
  text-align: center;
  color: var(--color-text-muted);
  user-select: none;
}
.hl-text {
  flex: none;
  padding-right: 14px;
  white-space: pre;
  color: var(--color-text);
}
.hl-gutter + .hl-text {
  padding-left: var(--space-2);
}
.row-add {
  background: var(--color-diff-add-bg);
}
.row-add .hl-sign {
  color: var(--color-success);
}
.row-del {
  background: var(--color-diff-del-bg);
}
.row-del .hl-sign {
  color: var(--color-danger);
}
.row-hunk {
  background: var(--color-surface-sunken);
}
.row-hunk .hl-text {
  color: var(--color-text-muted);
}
.hl-code.gutter .row-add {
  box-shadow: inset 2px 0 color-mix(in srgb, var(--color-success) 55%, transparent);
}
.hl-code.gutter .row-del {
  box-shadow: inset 2px 0 color-mix(in srgb, var(--color-danger) 55%, transparent);
}
</style>