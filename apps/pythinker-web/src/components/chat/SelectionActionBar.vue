<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import Icon from '../ui/Icon.vue';

const props = defineProps<{
  enabled?: boolean;
  panelSource?: string;
}>();

const emit = defineEmits<{
  add: [payload: { quote: string; comment?: string; source?: string }];
}>();

const { t } = useI18n();
const visible = ref(false);
const commenting = ref(false);
const comment = ref('');
const quote = ref('');
const source = ref<string | undefined>();
const style = ref<Record<string, string>>({});
const barRef = ref<HTMLElement | null>(null);
const commentInputRef = ref<HTMLInputElement | null>(null);
let selectionFrame = 0;

function close(): void {
  visible.value = false;
  commenting.value = false;
  comment.value = '';
}

function selectedElement(range: Range): Element | null {
  const node = range.commonAncestorContainer;
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
}

function updateFromSelection(): void {
  selectionFrame = 0;
  if (!props.enabled || commenting.value && barRef.value?.contains(document.activeElement)) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    close();
    return;
  }
  const range = selection.getRangeAt(0);
  const element = selectedElement(range);
  const root = element?.closest('.con, .pt-body');
  if (!element || !root || element.closest('.sab, input, textarea, button, [contenteditable="true"]')) {
    close();
    return;
  }
  const text = selection.toString().trim();
  const rect = range.getBoundingClientRect();
  if (!text || rect.width === 0 && rect.height === 0) {
    close();
    return;
  }
  quote.value = text;
  source.value = root.classList.contains('pt-body') ? props.panelSource : undefined;
  const width = 220;
  const left = Math.min(window.innerWidth - width - 8, Math.max(8, rect.left + rect.width / 2 - width / 2));
  const top = rect.bottom + 8;
  style.value = { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${width}px` };
  visible.value = true;
  commenting.value = false;
}

function scheduleSelectionUpdate(): void {
  if (selectionFrame) cancelAnimationFrame(selectionFrame);
  selectionFrame = requestAnimationFrame(updateFromSelection);
}

function clearBrowserSelection(): void {
  window.getSelection()?.removeAllRanges();
}

function submit(commentText?: string): void {
  const text = quote.value.trim();
  if (!text) return;
  const trimmedComment = commentText?.trim();
  emit('add', { quote: text, comment: trimmedComment || undefined, source: source.value });
  clearBrowserSelection();
  close();
}

function beginComment(): void {
  commenting.value = true;
  void nextTick(() => commentInputRef.value?.focus());
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (commenting.value || event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const buttons = Array.from(barRef.value?.querySelectorAll<HTMLButtonElement>('.sab-action') ?? []);
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown'
    ? (current + 1) % buttons.length
    : (current - 1 + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

function onDocumentPointer(event: PointerEvent): void {
  if (!visible.value || barRef.value?.contains(event.target as Node)) return;
  close();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && visible.value) {
    event.preventDefault();
    close();
  }
}

onMounted(() => {
  document.addEventListener('selectionchange', scheduleSelectionUpdate);
  document.addEventListener('pointerdown', onDocumentPointer, true);
  document.addEventListener('keydown', onDocumentKeydown, true);
});

onUnmounted(() => {
  if (selectionFrame) cancelAnimationFrame(selectionFrame);
  document.removeEventListener('selectionchange', scheduleSelectionUpdate);
  document.removeEventListener('pointerdown', onDocumentPointer, true);
  document.removeEventListener('keydown', onDocumentKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="barRef"
      class="sab"
      :style="style"
      :role="commenting ? 'dialog' : 'menu'"
      :aria-label="commenting ? t('selection.comment') : undefined"
      @pointerdown.prevent
      @keydown="onMenuKeydown"
    >
      <div v-if="commenting" class="sab-comment">
        <input
          ref="commentInputRef"
          v-model="comment"
          :placeholder="t('selection.commentPlaceholder')"
          @keydown.enter.prevent="submit(comment)"
        />
        <button type="button" :disabled="!comment.trim()" @click="submit(comment)">{{ t('selection.confirm') }}</button>
      </div>
      <template v-else>
        <button type="button" class="sab-action" role="menuitem" @click="beginComment">
          <Icon name="message" size="sm" /><span>{{ t('selection.comment') }}</span>
        </button>
        <button type="button" class="sab-action" role="menuitem" @click="submit()">
          <Icon name="plus" size="sm" /><span>{{ t('selection.addToChat') }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.sab { position: fixed; z-index: var(--z-toast); display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-1); border: 1px solid var(--color-line); border-radius: var(--radius-md); background: var(--color-surface-raised); box-shadow: var(--shadow-lg); }
.sab-action { display: flex; align-items: center; gap: var(--space-2); min-height: 34px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text); font: var(--text-sm) var(--font-ui); cursor: pointer; }
.sab-action:hover, .sab-action:focus-visible { background: var(--color-hover); outline: none; }
.sab-comment { display: flex; align-items: center; gap: var(--space-1); }
.sab-comment input { flex: 1; min-width: 0; height: 32px; padding: 0 var(--space-2); border: 1px solid var(--color-line); border-radius: var(--radius-sm); background: var(--color-bg); color: var(--color-text); font: var(--text-sm) var(--font-ui); outline: none; }
.sab-comment input:focus-visible { box-shadow: var(--p-focus-ring); }
.sab-comment button { height: 32px; padding: 0 var(--space-2); border: 0; border-radius: var(--radius-sm); background: var(--color-accent); color: var(--color-text-on-accent); font: var(--text-sm) var(--font-ui); cursor: pointer; }
.sab-comment button:disabled { opacity: .45; cursor: default; }
</style>
