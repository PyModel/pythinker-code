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
import Menu from '../ui/Menu.vue';
import MenuItem from '../ui/MenuItem.vue';
import PanelHeader from '../ui/PanelHeader.vue';
import ChatPane from './ChatPane.vue';

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
const copyMenuItemSize = computed(() => (isMobile.value ? 'lg' : 'md'));
const copyButtonSize = computed(() => (isMobile.value ? 'lg' : 'sm'));
const bodyEl = ref<HTMLElement | null>(null);
const following = ref(true);
const copyMenuOpen = ref(false);
const copyTriggerRef = ref<InstanceType<typeof IconButton> | null>(null);
const copyMenuRef = ref<InstanceType<typeof Menu> | null>(null);
const copyMenuStyle = ref<Record<string, string>>({});
const copiedKind = ref<'command' | 'output' | 'all' | null>(null);
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

const subtitle = computed(() =>
  [
    props.member.subagentType,
    modelDisplay?.(props.member.model),
    subagentEffort?.(props.member.thinkingEffort),
  ]
    .filter(Boolean)
    .join(' · ') || undefined,
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

function positionCopyMenu(): void {
  const button = copyTriggerRef.value?.el;
  const menu = copyMenuRef.value?.el;
  if (!button || !menu) return;
  const rect = button.getBoundingClientRect();
  const gap = 8;
  const margin = 8;
  const left = Math.max(
    margin,
    Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - margin),
  );
  if (rect.bottom + gap + menu.offsetHeight <= window.innerHeight - margin) {
    copyMenuStyle.value = { left: `${left}px`, top: `${rect.bottom + gap}px` };
  } else {
    copyMenuStyle.value = {
      left: `${left}px`,
      bottom: `${window.innerHeight - rect.top + gap}px`,
    };
  }
}

function closeCopyMenu(refocus = false): void {
  copyMenuOpen.value = false;
  window.removeEventListener('mousedown', onDocumentMouseDown, true);
  window.removeEventListener('keydown', onMenuEscape, true);
  window.removeEventListener('resize', positionCopyMenu);
  window.removeEventListener('scroll', positionCopyMenu, true);
  if (refocus) copyTriggerRef.value?.el?.focus();
}

async function openCopyMenu(): Promise<void> {
  if (copyMenuOpen.value) {
    closeCopyMenu(true);
    return;
  }
  copyMenuOpen.value = true;
  await nextTick();
  positionCopyMenu();
  copyMenuRef.value?.el?.querySelector<HTMLElement>('.ui-menu-item:not(:disabled)')?.focus();
  window.addEventListener('mousedown', onDocumentMouseDown, true);
  window.addEventListener('keydown', onMenuEscape, true);
  window.addEventListener('resize', positionCopyMenu);
  window.addEventListener('scroll', positionCopyMenu, true);
}

function onDocumentMouseDown(event: MouseEvent): void {
  const target = event.target as Node;
  if (copyMenuRef.value?.el?.contains(target) || copyTriggerRef.value?.el?.contains(target)) return;
  closeCopyMenu();
}

function onMenuEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeCopyMenu(true);
}

async function copyToClipboard(kind: 'command' | 'output' | 'all'): Promise<void> {
  const text =
    kind === 'command'
      ? props.member.prompt
      : kind === 'output'
        ? outputText.value
        : [props.member.prompt?.trim(), outputText.value].filter(Boolean).join('\n\n');
  if (!text) return;
  const generation = ++copyGeneration;
  if (!(await copyTextToClipboard(text)) || generation !== copyGeneration) return;
  if (copiedTimer !== null) clearTimeout(copiedTimer);
  copiedKind.value = kind;
  copiedTimer = setTimeout(() => {
    copiedTimer = null;
    copiedKind.value = null;
  }, 1400);
  closeCopyMenu(true);
}

watch(
  () => props.member.id,
  () => {
    copyGeneration += 1;
    if (copiedTimer !== null) clearTimeout(copiedTimer);
    copiedTimer = null;
    copiedKind.value = null;
    closeCopyMenu();
  },
);

onUnmounted(() => {
  if (copiedTimer !== null) clearTimeout(copiedTimer);
  closeCopyMenu();
});
</script>

<template>
  <div class="agent-panel">
    <PanelHeader
      :title="member.name"
      :subtitle="subtitle"
      :close-label="t('thinking.close')"
      @close="emit('close')"
    >
      <Badge variant="neutral" size="sm">{{ phaseLabel(member.phase) }}</Badge>
      <IconButton
        v-if="member.prompt || outputText"
        ref="copyTriggerRef"
        :size="copyButtonSize"
        :class="{ 'copy-menu-open': copyMenuOpen }"
        :label="t('tasks.copy')"
        :tooltip="t('tasks.copy')"
        aria-haspopup="menu"
        :aria-expanded="copyMenuOpen"
        @click="openCopyMenu"
      >
        <Icon :name="copiedKind ? 'check' : 'copy'" size="sm" />
      </IconButton>
    </PanelHeader>

    <div ref="bodyEl" class="agent-transcript" @scroll.passive="onTranscriptScroll">
      <div
        v-if="turns.length === 0 && !loading && (loadError || fallbackLines.length > 0)"
        class="agent-fallback"
      >
        <div v-if="loadError" class="agent-error">{{ t('tasks.transcriptLoadError') }}</div>
        <pre v-if="fallbackLines.length > 0" class="fallback-lines">{{ fallbackLines.join('\n') }}</pre>
      </div>
      <ChatPane
        v-else
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
      />
    </div>

    <Menu
      v-if="copyMenuOpen"
      ref="copyMenuRef"
      class="copy-menu"
      :style="copyMenuStyle"
      @click.stop
    >
      <MenuItem
        v-if="member.prompt"
        :size="copyMenuItemSize"
        @click="copyToClipboard('command')"
      >
        <Icon name="terminal" size="sm" />
        <span>{{ t('tasks.copyCommand') }}</span>
      </MenuItem>
      <MenuItem
        :size="copyMenuItemSize"
        :disabled="!outputText"
        @click="copyToClipboard('output')"
      >
        <Icon name="file-text" size="sm" />
        <span>{{ t('tasks.copyOutput') }}</span>
      </MenuItem>
      <MenuItem separator />
      <MenuItem :size="copyMenuItemSize" @click="copyToClipboard('all')">
        <Icon name="copy" size="sm" />
        <span>{{ t('tasks.copyAll') }}</span>
      </MenuItem>
    </Menu>
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
.agent-transcript {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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
.copy-menu {
  position: fixed;
  z-index: var(--z-dropdown);
}
</style>
