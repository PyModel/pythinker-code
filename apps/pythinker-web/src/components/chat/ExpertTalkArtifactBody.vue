<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AppExpertTalkArtifact } from '../../api/types';
import { useDiscussionPreferences } from '../../composables/useDiscussionPreferences';
import Icon from '../ui/Icon.vue';
import Markdown from './Markdown.vue';

const props = defineProps<{
  artifact?: AppExpertTalkArtifact;
  state: AppExpertTalkArtifact['state'];
  text?: string;
}>();
const { t } = useI18n();
const { showReasoning } = useDiscussionPreferences();

const running = computed(() => props.state === 'running');
const thinking = computed(() => props.artifact?.thinking?.trim() ?? '');
const showThinking = computed(() => showReasoning.value && (thinking.value.length > 0 || running.value));

const PREVIEW_SENTENCES = 2;

// The collapsed view is plain prose: markdown emphasis and headings from
// provider reasoning summaries would otherwise render as shouting bold lines.
function plainReasoning(source: string): string {
  return source
    .replaceAll(/^#{1,6}\s+/gm, '')
    .replaceAll(/[*_`]+/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

const reasoningPreview = computed(() => {
  const plain = plainReasoning(thinking.value);
  const sentences = plain.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
  return sentences.slice(0, PREVIEW_SENTENCES).map((sentence) => sentence.trim()).join(' ');
});
const reasoningHasMore = computed(() =>
  plainReasoning(thinking.value).length > reasoningPreview.value.length,
);

const expanded = ref(false);
watch(() => props.artifact?.stage, () => {
  expanded.value = false;
});

const toolSummary = computed(() => {
  const tools = props.artifact?.tools ?? [];
  if (tools.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const tool of tools) {
    const name = tool.name ?? t('expertTalk.tool');
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const breakdown = Array.from(counts.entries())
    .toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(' · ');
  return { total: tools.length, breakdown };
});

const answer = computed(() => props.text ?? props.artifact?.text);
</script>

<template>
  <div class="expert-talk__artifact-body">
    <section v-if="showThinking" class="expert-talk__thinking" :class="{ 'is-expanded': expanded }">
      <header class="expert-talk__thinking-head">
        <span class="expert-talk__thinking-label">
          <span aria-hidden="true">▹</span>
          {{ t('expertTalk.thinking') }}
        </span>
        <button
          v-if="reasoningHasMore"
          type="button"
          class="expert-talk__thinking-toggle"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          {{ expanded ? t('expertTalk.reasoningLess') : t('expertTalk.reasoningMore') }}
          <Icon :name="expanded ? 'chevron-down' : 'chevron-right'" size="sm" />
        </button>
      </header>
      <div v-if="expanded" class="expert-talk__thinking-full">
        <Markdown :text="thinking" :streaming="running" />
      </div>
      <p v-else-if="reasoningPreview" class="expert-talk__thinking-preview">{{ reasoningPreview }}</p>
      <p v-else class="expert-talk__thinking-preview">{{ t('expertTalk.thinkingPending') }}</p>
    </section>
    <p v-if="toolSummary" class="expert-talk__tools" :title="toolSummary.breakdown">
      <span aria-hidden="true">▸</span>
      {{ t('expertTalk.toolSummary', { count: toolSummary.total }) }}
      <span class="expert-talk__tools-breakdown">{{ toolSummary.breakdown }}</span>
    </p>
    <div v-if="answer" class="expert-talk__artifact-text">
      <Markdown :text="answer" :streaming="running" />
    </div>
    <p v-else-if="!running">
      {{ artifact?.error ?? t(`expertTalk.artifactState.${state}`) }}
    </p>
  </div>
</template>

<style scoped>
.expert-talk__artifact-body {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
}

.expert-talk__artifact-body > p {
  margin: 0;
  color: var(--color-text-faint);
}

.expert-talk__thinking {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border-left: 2px solid var(--color-accent);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  background: var(--color-surface-sunken);
  color: var(--color-text-faint);
  font-size: var(--text-xs);
}

.expert-talk__thinking-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.expert-talk__thinking-label {
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.expert-talk__thinking-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-text-faint);
  font: inherit;
  cursor: pointer;
}

.expert-talk__thinking-toggle:hover,
.expert-talk__thinking-toggle:focus-visible {
  color: var(--color-text);
}

.expert-talk__thinking-preview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: var(--leading-relaxed);
  overflow-wrap: anywhere;
}

.expert-talk__thinking-full {
  max-block-size: clamp(11rem, 30vh, 20rem);
  overflow: auto;
  scrollbar-gutter: stable;
  font-family: var(--font-mono);
  white-space: pre-wrap;
}

.expert-talk__tools {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  color: var(--color-text-faint);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.expert-talk__tools > span[aria-hidden] {
  color: var(--color-warning);
}

.expert-talk__tools-breakdown {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expert-talk__artifact-text {
  min-width: 0;
}
</style>
