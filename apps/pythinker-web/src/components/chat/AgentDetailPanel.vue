<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, provide, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AgentMember, ChatTurn, FilePreviewRequest, ToolMedia } from '../../types';
import type { TurnFileChange } from '../../lib/turnFiles';
import { copyTextToClipboard } from '../../lib/clipboard';
import { useIsMobile } from '../../composables/useIsMobile';
import Badge from '../ui/Badge.vue';
import Icon from '../ui/Icon.vue';
import IconButton from '../ui/IconButton.vue';
import PanelHeader from '../ui/PanelHeader.vue';
import ChatPane from './ChatPane.vue';
import Markdown from './Markdown.vue';

const props = defineProps<{
  member: AgentMember;
  turns: ChatTurn[];
  running: boolean;
  loading: boolean;
  loadError: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
}>();

const emit = defineEmits<{
  close: [];
  loadOlderMessages: [];
  openAgent: [toolCallId: string];
  openFile: [target: FilePreviewRequest];
  openMedia: [media: ToolMedia];
  openTurnDiff: [target: { turnId: string; changes: TurnFileChange[] }];
}>();

const { t } = useI18n();
const isMobile = useIsMobile();
const copyButtonSize = computed(() => (isMobile.value ? 'lg' : 'sm'));
const bodyEl = ref<HTMLElement | null>(null);
const chatPaneRef = ref<InstanceType<typeof ChatPane> | null>(null);
const following = ref(true);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let copyGeneration = 0;

const fallbackLines = computed(() => {
  const seen = new Set<string>();
  const lines: string[] = [];
  const prompt = props.member.prompt?.trim();
  const shellPrompt = prompt ? `$ ${prompt}` : undefined;
  for (const value of [
    props.member.prompt,
    props.member.suspendedReason,
    props.member.text,
    props.member.outputLines?.join('\n'),
    props.member.summary,
  ]) {
    const text = value?.trim();
    if (!text || seen.has(text) || text === shellPrompt) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines;
});

const outputText = computed(() =>
  fallbackLines.value
    .filter((line) => line !== props.member.prompt?.trim())
    .join('\n'),
);

const modelDisplay = inject<(modelId: string | undefined) => string | undefined>('modelDisplay');
const subagentEffort = inject<(effort: string | undefined) => string | undefined>('subagentEffort');

// Type / model / effort ride under the header as one muted meta line, above
// the originating prompt.
const metaText = computed(() =>
  [
    props.member.subagentType,
    modelDisplay?.(props.member.model),
    subagentEffort?.(props.member.thinkingEffort),
  ]
    .filter(Boolean)
    .join(' · ') || undefined,
);

const promptText = computed(() => props.member.prompt?.trim() ?? '');
// A slash-command prompt reads as a command, not prose — keep it monospaced and
// out of the markdown renderer.
const promptIsCommand = computed(
  () => promptText.value.startsWith('/') && !promptText.value.includes('\n'),
);

const fallbackVisible = computed(
  () => props.turns.length === 0 && !props.loading && (props.loadError || fallbackLines.value.length > 0),
);

// ---------------------------------------------------------------------------
// Prompt clamp — a long originating prompt collapses to six line-heights with
// a centered expand pill floating over the fade.
// ---------------------------------------------------------------------------
const promptTextEl = ref<HTMLElement | null>(null);
const promptClamped = ref(true);
const promptOverflowing = ref(false);

function measurePromptOverflow(): void {
  const element = promptTextEl.value;
  if (!element) {
    promptOverflowing.value = false;
    return;
  }
  promptOverflowing.value = element.scrollHeight > element.clientHeight + 1;
}

function togglePromptClamp(): void {
  promptClamped.value = !promptClamped.value;
  void nextTick(measurePromptOverflow);
}

watch(
  () => [props.member.id, promptText.value] as const,
  () => {
    promptClamped.value = true;
    void nextTick(measurePromptOverflow);
  },
  { immediate: true },
);

function onTranscriptScroll(): void {
  const element = bodyEl.value;
  if (!element) return;
  following.value = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
}

function scrollToBottom(): void {
  void nextTick(() => {
    const element = bodyEl.value;
    if (element) element.scrollTop = element.scrollHeight;
  });
}

function jumpToBottom(): void {
  following.value = true;
  scrollToBottom();
}

provide('pinScroll', (element: HTMLElement) => {
  const scroller = bodyEl.value;
  if (!scroller) return;
  const before = element.getBoundingClientRect().top;
  requestAnimationFrame(() => {
    scroller.scrollTop += element.getBoundingClientRect().top - before;
  });
});

watch(
  () => {
    const last = props.turns.at(-1);
    return `${props.member.id}:${props.turns.length}:${last?.text.length ?? 0}:${last?.tools?.length ?? 0}`;
  },
  () => {
    if (following.value) scrollToBottom();
  },
  { immediate: true },
);

function phaseLabel(phase: AgentMember['phase']): string {
  const suffix = phase[0]!.toUpperCase() + phase.slice(1);
  return t(`tools.dynamic_workflow.phase${suffix}`);
}

function flashCopied(): void {
  if (copiedTimer !== null) clearTimeout(copiedTimer);
  copied.value = true;
  copiedTimer = setTimeout(() => {
    copiedTimer = null;
    copied.value = false;
  }, 1400);
}

/**
 * One copy action. The turn list owns the conversation-level copy path; the
 * fallback view has no turns, so it copies the raw prompt + output instead.
 */
async function copyTranscript(): Promise<void> {
  if (!fallbackVisible.value && props.turns.length > 0) {
    chatPaneRef.value?.copyConversation();
    return;
  }
  const text = [props.member.prompt?.trim(), outputText.value].filter(Boolean).join('\n\n');
  if (!text) return;
  const generation = ++copyGeneration;
  if (!(await copyTextToClipboard(text)) || generation !== copyGeneration) return;
  flashCopied();
}

watch(
  () => props.member.id,
  () => {
    copyGeneration += 1;
    if (copiedTimer !== null) clearTimeout(copiedTimer);
    copiedTimer = null;
    copied.value = false;
  },
);

onUnmounted(() => {
  if (copiedTimer !== null) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="agent-panel">
    <PanelHeader
      :title="member.name"
      :close-label="t('thinking.close')"
      @close="emit('close')"
    >
      <Badge variant="neutral" size="sm">{{ phaseLabel(member.phase) }}</Badge>
      <IconButton
        v-if="member.prompt || outputText || turns.length > 0"
        :size="copyButtonSize"
        :label="t('tasks.copy')"
        @click="copyTranscript"
      >
        <Icon :name="copied ? 'check' : 'copy'" size="sm" />
      </IconButton>
    </PanelHeader>

    <div v-if="metaText" class="agent-meta">
      <span class="agent-meta-text">{{ metaText }}</span>
    </div>

    <!-- The prompt the subagent was given, as the originating user bubble. -->
    <div v-if="promptText" class="agent-prompt">
      <div class="agent-prompt-bubble">
        <div class="agent-prompt-wrap" :class="{ 'is-clamped': promptClamped }">
          <div
            ref="promptTextEl"
            class="agent-prompt-text"
            :class="{ 'is-command': promptIsCommand }"
          >
            <template v-if="promptIsCommand">{{ promptText }}</template>
            <Markdown v-else :text="promptText" :open-file="(target) => emit('openFile', target)" />
          </div>
          <button
            v-if="promptOverflowing || !promptClamped"
            type="button"
            class="agent-prompt-toggle"
            :aria-expanded="!promptClamped"
            @click="togglePromptClamp"
          >
            <span>{{ promptClamped ? t('tasks.expand') : t('tasks.collapse') }}</span>
            <Icon
              class="agent-prompt-toggle-car"
              :class="{ open: !promptClamped }"
              name="chevron-down"
              size="sm"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </div>

    <div ref="bodyEl" class="agent-transcript" @scroll.passive="onTranscriptScroll">
      <div class="agent-transcript-inner">
        <div v-if="fallbackVisible" class="agent-fallback">
          <div v-if="loadError" class="agent-error">{{ t('tasks.transcriptLoadError') }}</div>
          <pre v-if="fallbackLines.length > 0" class="fallback-lines">{{ fallbackLines.join('\n') }}</pre>
        </div>
        <ChatPane
          v-else
          ref="chatPaneRef"
          :turns="turns"
          :turn-active="running"
          :session-loading="loading && turns.length === 0"
          :has-more-messages="hasMore"
          :loading-more="loadingMore"
          :loading-more-error="loadMoreError"
          :is-following="following"
          read-only
          inspector
          @load-older-messages="emit('loadOlderMessages')"
          @open-agent="emit('openAgent', $event)"
          @open-file="emit('openFile', $event)"
          @open-media="emit('openMedia', $event)"
          @open-turn-diff="emit('openTurnDiff', $event)"
          @copy-conversation-copied="flashCopied"
        />
      </div>

      <Transition name="agent-jump">
        <button v-if="!following" type="button" class="agent-jump-btn" @click="jumpToBottom">
          <Icon class="agent-jump-car" name="arrow-down" size="sm" aria-hidden="true" />
          <span>{{ t('conversation.backToBottom') }}</span>
        </button>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.agent-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
}
/* Meta line: a muted label whose trailing hairline fills the rest of the row. */
.agent-meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3) var(--space-2);
  user-select: none;
}
.agent-meta::after {
  content: '';
  flex: 1;
  height: var(--p-hairline);
  background: var(--color-line);
}
.agent-meta-text {
  font: var(--text-xs)/1 var(--font-ui);
  color: var(--color-text-muted);
  white-space: nowrap;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.agent-prompt {
  flex: none;
  display: flex;
  flex-direction: column;
  padding: 0 var(--space-3) var(--space-2);
}
.agent-prompt-bubble {
  display: flex;
  flex-direction: column;
  align-self: flex-end;
  max-width: 78%;
  padding: 10px 12px;
  background: var(--color-user-bubble-bg);
  border-radius: var(--radius-lg);
}
.agent-prompt-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
}
.agent-prompt-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--content-font-size);
  line-height: var(--leading-normal);
  color: var(--color-text);
}
.agent-prompt-text.is-command {
  font-family: var(--font-mono);
}
/* Six line-heights, with the last line fading out under the pill. */
.agent-prompt-wrap.is-clamped > .agent-prompt-text {
  max-height: 6lh;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black calc(100% - 2.5lh), transparent calc(100% - 0.5lh));
  -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 2.5lh), transparent calc(100% - 0.5lh));
}
.agent-prompt-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  align-self: center;
  margin-top: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border: none;
  border-radius: var(--radius-full);
  background: var(--color-surface-raised);
  box-shadow: var(--shadow-sm);
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: var(--ui-font-size-sm);
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: box-shadow var(--duration-base) var(--ease-out);
}
.agent-prompt-toggle:hover {
  box-shadow: var(--shadow-md);
}
.agent-prompt-toggle:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
.agent-prompt-wrap.is-clamped .agent-prompt-toggle {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translate(-50%);
  margin-top: 0;
}
.agent-prompt-toggle-car {
  transition: transform var(--duration-base) var(--ease-out);
}
.agent-prompt-toggle-car.open {
  transform: rotate(180deg);
}
.agent-transcript {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
/* Centre the transcript on the same reading column as the main conversation. */
.agent-transcript-inner {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  width: 100%;
  max-width: var(--p-content-max);
  margin-inline: auto;
}
.agent-transcript :deep(.think-body),
.agent-transcript :deep(.ar-body),
.agent-transcript :deep(.tf-body),
.agent-transcript :deep(.bb),
.agent-transcript :deep(.tl-body) {
  transition: none;
}
.agent-error {
  color: var(--color-danger);
  font: var(--text-sm)/var(--leading-normal) var(--font-ui);
}
.agent-fallback {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}
.fallback-lines {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--text-sm)/var(--leading-relaxed) var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Floating "Back to bottom" — only while the reader has scrolled away. */
.agent-jump-btn {
  position: sticky;
  left: 50%;
  bottom: var(--space-3);
  transform: translate(-50%);
  z-index: var(--z-sticky);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px var(--space-3);
  border: var(--p-hairline) solid var(--color-line);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
  font-weight: var(--weight-ui-strong);
  line-height: 1.5;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
.agent-jump-btn:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
.agent-jump-car {
  width: 12px;
  height: 12px;
}
.agent-jump-enter-active,
.agent-jump-leave-active {
  transition: opacity var(--duration-base) var(--ease-out),
    transform var(--duration-base) var(--ease-out);
}
.agent-jump-enter-from,
.agent-jump-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}
</style>
