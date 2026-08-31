<!-- apps/pythinker-web/src/components/ReleaseNotes.vue -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

// Release notes are not chat. They arrive in one narrow shape that we generate
// ourselves in apps/desktop/scripts/desktop-release.mjs — a short bullet per
// changeset, an optional heading, then a `Built from <url>.` provenance line —
// so they get a renderer built for that shape rather than the chat Markdown
// component. Three reasons, in order of weight:
//
//   1. The chat renderer renders raw HTML as live DOM. Everything here goes
//      through Vue text interpolation instead, so a release body can never
//      contribute markup no matter what upstream did to it.
//   2. The chat renderer cannot be mounted in a test (it resolves katex and
//      mermaid workers), so the update popover had to stub it — this surface
//      was shipped unverified.
//   3. It drags katex, mermaid and shiki into a 440px popover that shows six
//      words.

const props = defineProps<{ text: string }>();

const { t } = useI18n();

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'paragraph'; text: string };

interface Provenance {
  label: string;
  url: string;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

// The desktop side escapes `<` and `>` on the way out so the value stays inert
// for any Markdown renderer. Interpolation makes that unnecessary here and the
// escaped form is what the user would otherwise read, so decode it back to the
// characters the author typed. This cannot reintroduce markup: the decoded
// text is bound as a text node, never as HTML.
function decodeEntities(value: string): string {
  return value.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (match, entity: string) => {
    if (!entity.startsWith('#')) return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    const code = entity.startsWith('#x') || entity.startsWith('#X')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isSafeInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : match;
  });
}

function readProvenanceUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    // Only ever link somewhere a browser will treat as a web page. A release
    // body is remote input, and `will-navigate` in the desktop main process
    // hands whatever we render straight to shell.openExternal.
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  }
  catch {
    return undefined;
  }
}

// `Built from <url>.` is provenance, not a release note. It reads as a stray
// sentence at the end of the list, so it comes out of the body and becomes a
// footer. The generator keeps emitting it because desktop-release.yml gates
// the draft-resume path on the release body containing the source URL.
const PROVENANCE_LINE = /^built from\s+(\S+?)\.?$/iu;

function shortenReference(url: URL): string {
  const segment = url.pathname.split('/').filter(Boolean).pop();
  if (segment === undefined) return url.hostname;
  return /^[0-9a-f]{7,40}$/iu.test(segment) ? segment.slice(0, 7) : segment;
}

const parsed = computed<{ blocks: Block[]; provenance?: Provenance }>(() => {
  const lines = decodeEntities(props.text).split('\n');
  let provenance: Provenance | undefined;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? '';
    if (line.length === 0) continue;
    const match = PROVENANCE_LINE.exec(line);
    if (match !== null) {
      const url = readProvenanceUrl(match[1] ?? '');
      if (url !== undefined) {
        provenance = { label: shortenReference(url), url: url.toString() };
        lines.splice(index, 1);
      }
    }
    break;
  }

  const blocks: Block[] = [];
  let list: string[] | undefined;
  let paragraph: string[] = [];

  const flush = (): void => {
    if (list !== undefined) {
      blocks.push({ kind: 'list', items: list });
      list = undefined;
    }
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    // A thematic break separated the notes from the provenance line that is
    // now the footer, so it has nothing left to separate.
    if (line.length === 0 || /^(-{3,}|\*{3,}|_{3,})$/u.test(line)) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/u.exec(line);
    if (heading !== null) {
      flush();
      const text = heading[1]?.trim() ?? '';
      if (text.length > 0) blocks.push({ kind: 'heading', text });
      continue;
    }
    const item = /^[-*+]\s+(.*)$/u.exec(line);
    if (item !== null) {
      if (paragraph.length > 0) flush();
      const text = item[1]?.trim() ?? '';
      list ??= [];
      if (text.length > 0) list.push(text);
      continue;
    }
    // A wrapped continuation line belongs to whatever it is wrapping.
    if (list !== undefined && list.length > 0) {
      list[list.length - 1] = `${list[list.length - 1] ?? ''} ${line}`;
      continue;
    }
    paragraph.push(line);
  }
  flush();

  return { blocks, provenance };
});

const blocks = computed(() => parsed.value.blocks);
const provenance = computed(() => parsed.value.provenance);
const isEmpty = computed(() => blocks.value.length === 0 && provenance.value === undefined);
</script>

<template>
  <div class="release-notes" data-testid="release-notes">
    <p v-if="isEmpty" class="release-notes__empty">
      {{ t('update.releaseNotesUnavailable') }}
    </p>
    <template v-for="(block, index) in blocks" v-else :key="index">
      <h3 v-if="block.kind === 'heading'" class="release-notes__heading">
        {{ block.text }}
      </h3>
      <ul v-else-if="block.kind === 'list'" class="release-notes__list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          {{ item }}
        </li>
      </ul>
      <p v-else class="release-notes__paragraph">
        {{ block.text }}
      </p>
    </template>
    <p v-if="provenance" class="release-notes__provenance" data-testid="release-notes-provenance">
      <i18n-t keypath="update.builtFrom" tag="span" scope="global">
        <template #ref>
          <a :href="provenance.url" target="_blank" rel="noreferrer noopener">{{ provenance.label }}</a>
        </template>
      </i18n-t>
    </p>
  </div>
</template>

<style scoped>
.release-notes {
  /* Every child is a flex/grid item somewhere up the tree; without this a long
     unbreakable token (a commit URL) sets the min-content width and the
     popover clips it, because the shell is overflow: hidden. */
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--color-text);
  font-size: var(--content-font-size);
  line-height: var(--leading-prose);
}
.release-notes > :first-child {
  margin-top: 0;
}
.release-notes > :last-child {
  margin-bottom: 0;
}
.release-notes__empty {
  margin: 0;
  color: var(--color-text-muted);
}
.release-notes__heading {
  margin: var(--space-5) 0 var(--space-2);
  color: var(--color-text-strong);
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.release-notes__paragraph {
  margin: 0 0 var(--space-3);
}
.release-notes__list {
  margin: 0 0 var(--space-3);
  padding: 0;
  list-style: none;
}
.release-notes__list li {
  position: relative;
  margin: 0 0 var(--space-2);
  padding-inline-start: var(--space-4);
}
.release-notes__list li:last-child {
  margin-bottom: 0;
}
/* A real bullet glyph rather than list-style, so the marker keeps its colour
   and the text block hangs cleanly under itself when a note wraps. */
.release-notes__list li::before {
  content: '';
  position: absolute;
  inset-block-start: 0.6em;
  inset-inline-start: var(--space-1);
  width: 4px;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--color-text-faint);
}
.release-notes__provenance {
  margin: var(--space-5) 0 0;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-line);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.release-notes__provenance a {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  text-decoration-color: var(--color-line-strong);
  text-underline-offset: 2px;
}
.release-notes__provenance a:hover,
.release-notes__provenance a:focus-visible {
  color: var(--color-text);
}
</style>
