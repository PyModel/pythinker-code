<!-- apps/pythinker-web/src/components/chat/AttachmentChip.vue -->
<!-- One attachment pill. Media details open in an interactive hover card. -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AuthMedia from './AuthMedia.vue';
import Icon from '../ui/Icon.vue';
import Spinner from '../ui/Spinner.vue';
import Tooltip from '../ui/Tooltip.vue';
import type { IconName } from '../../lib/icons';

const props = withDefaults(
  defineProps<{
    kind: 'image' | 'video' | 'file';
    /** Undefined only for pasted media without a name — a generic label shows. */
    name?: string;
    /** Thumbnail source for images (object URL or the authed file URL). */
    url?: string;
    /** When present, AuthMedia fetches image bytes with auth. */
    fileId?: string;
    mediaType?: string;
    size?: number;
    /** Composer: upload in flight — spinner replaces the ext badge. */
    uploading?: boolean;
    /** Composer: upload failed — chip tinted, info icon replaces the badge. */
    error?: boolean;
    /** Composer: show a remove button. */
    removable?: boolean;
    /** Accessible label for the remove button. */
    removeLabel?: string;
  }>(),
  { uploading: false, error: false, removable: false },
);

const emit = defineEmits<{
  /** Primary action (preview media / download file) — the parent decides. */
  activate: [];
  remove: [];
}>();

const { t } = useI18n();
const anchorRef = ref<HTMLElement | null>(null);
const tipRef = ref<HTMLElement | null>(null);
const tipOpen = ref(false);
const tipSide = ref<'top' | 'bottom'>('top');
const tipStyle = ref<Record<string, string>>({});
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const ext = computed(() => {
  const fromName = props.name?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  const e = fromName ?? props.mediaType?.split('/')[1]?.split('+')[0];
  return e ? e.toUpperCase() : undefined;
});

const fileIcon = computed<IconName>(() => {
  const e = ext.value ?? '';
  if (/^(txt|md|doc|docx|rtf|log)$/i.test(e)) return 'file-text';
  return 'file';
});

const displayName = computed(() => {
  if (props.name) return props.name;
  if (props.kind === 'image') return t('composer.attachmentImage');
  if (props.kind === 'video') return t('composer.attachmentVideo');
  return t('composer.attachmentFile');
});

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const title = computed(() => {
  const parts = [displayName.value];
  if (props.size !== undefined) parts.push(formatSize(props.size));
  return parts.join(' · ');
});

const media = computed(() => props.kind !== 'file');
const previewable = computed(() => media.value && (Boolean(props.url) || Boolean(props.fileId)));
const stateLabel = computed(() =>
  props.error
    ? t('mention.stateUploadFailed')
    : props.uploading
      ? t('mention.stateUploading')
      : t('mention.stateUploaded'),
);

function positionTip(): void {
  const anchor = anchorRef.value;
  const tip = tipRef.value;
  if (!anchor || !tip) return;
  const rect = anchor.getBoundingClientRect();
  const margin = 8;
  const gap = 8;
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  let top = rect.top - height - gap;
  let side: 'top' | 'bottom' = 'top';
  if (top < margin) {
    top = rect.bottom + gap;
    side = 'bottom';
  }
  top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - height - margin));
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - width / 2, margin),
    Math.max(margin, window.innerWidth - width - margin),
  );
  const caret = Math.min(Math.max(rect.left + rect.width / 2 - left, 10), Math.max(10, width - 10));
  tipSide.value = side;
  tipStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    '--tip-caret-x': `${Math.round(caret)}px`,
  };
}

function showTip(): void {
  if (!media.value) return;
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  tipOpen.value = true;
  void nextTick(positionTip);
}

function scheduleClose(): void {
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    tipOpen.value = false;
    closeTimer = null;
  }, 120);
}

function closeTip(): void {
  if (closeTimer !== null) clearTimeout(closeTimer);
  closeTimer = null;
  tipOpen.value = false;
}

watch(tipOpen, (open) => {
  const method = open ? 'addEventListener' : 'removeEventListener';
  window[method]('resize', positionTip);
  window[method]('scroll', positionTip, true);
});

onUnmounted(() => {
  closeTip();
  window.removeEventListener('resize', positionTip);
  window.removeEventListener('scroll', positionTip, true);
});
</script>

<template>
  <span
    ref="anchorRef"
    class="att-chip"
    :class="{ 'is-error': error, uploading }"
    :title="title"
    :data-kind="kind"
    @mouseenter="showTip"
    @mouseleave="scheduleClose"
    @focusin="showTip"
    @focusout="scheduleClose"
    @keydown.esc="closeTip"
  >
    <button
      type="button"
      class="att-activate"
      :aria-label="title"
      :aria-haspopup="media ? 'dialog' : undefined"
      :aria-expanded="media ? tipOpen : undefined"
      @click="emit('activate')"
    >
      <span class="att-tile">
        <AuthMedia
          v-if="kind === 'image' && url"
          :url="url"
          kind="image"
          :alt="name"
          :file-id="fileId"
          media-class="att-thumb"
        />
        <Icon v-else-if="kind === 'video'" name="play" size="sm" />
        <Icon v-else-if="kind === 'image'" name="image" size="sm" />
        <Icon v-else :name="fileIcon" size="sm" />
      </span>
      <span class="att-name">{{ displayName }}</span>
      <Spinner v-if="uploading" size="sm" :label="t('composer.uploading')" />
      <span v-else-if="error" class="att-err"><Icon name="info" size="sm" /></span>
    </button>
    <Tooltip v-if="removable" :text="removeLabel ?? t('composer.remove')">
      <button type="button" class="att-rm" :aria-label="removeLabel ?? t('composer.remove')" @click="emit('remove')">
        <Icon name="close" size="sm" />
      </button>
    </Tooltip>
  </span>

  <Teleport to="body">
    <div
      v-if="tipOpen && media"
      ref="tipRef"
      class="att-tip"
      :data-side="tipSide"
      :style="tipStyle"
      role="dialog"
      :aria-label="title"
      @mouseenter="showTip"
      @mouseleave="scheduleClose"
      @focusin="showTip"
      @focusout="scheduleClose"
      @keydown.esc="closeTip"
    >
      <span class="att-tip-caret" aria-hidden="true" />
      <div class="att-tip-preview">
        <AuthMedia
          v-if="previewable"
          :url="url ?? ''"
          :kind="kind === 'video' ? 'video' : 'image'"
          :alt="displayName"
          :file-id="fileId"
          media-class="att-tip-media"
          :controls="kind === 'video'"
          muted
        />
        <span v-else class="att-tip-placeholder">
          <Spinner v-if="uploading" size="sm" :label="t('mention.mediaPreviewUploading')" />
          <Icon v-else :name="kind === 'video' ? 'play' : 'image'" />
          <span>{{ uploading ? t('mention.mediaPreviewUploading') : t('mention.mediaPreviewUnavailable') }}</span>
        </span>
      </div>
      <div class="att-tip-meta">
        <Icon :name="kind === 'video' ? 'play' : 'image'" size="sm" />
        <strong>{{ displayName }}</strong>
        <span v-if="size !== undefined">· {{ formatSize(size) }}</span>
      </div>
      <div v-if="error" class="att-tip-error">{{ t('mention.attachmentUploadFailed') }}</div>
      <div class="att-tip-foot">
        <span class="att-tip-state" :class="{ danger: error }">
          <Spinner v-if="uploading" size="sm" />
          {{ stateLabel }}
        </span>
        <button v-if="previewable" type="button" class="att-tip-open" @click="emit('activate')">
          <Icon name="expand" size="sm" />
          <span>{{ t('mention.viewFullscreen') }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.att-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 4px 9px 4px 5px;
  background: var(--color-bg);
  border: 1px solid var(--color-line);
  border-radius: 999px;
  font-size: var(--ui-font-size-sm);
  transition: border-color var(--duration-fast) ease;
}
.att-chip:hover {
  border-color: var(--color-line-strong);
}
.att-activate {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.att-activate:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
  border-radius: 999px;
}
.att-tile {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--color-text-muted);
  background: var(--color-surface-sunken);
}
.att-tile :deep(.att-thumb) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.att-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  font-weight: var(--weight-medium);
}
.att-chip.is-error {
  border-color: var(--color-danger-bd);
}
.att-chip.is-error .att-err {
  flex: none;
  display: flex;
  align-items: center;
  color: var(--color-danger);
}
.att-rm {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-faint);
  cursor: pointer;
}
.att-rm:hover {
  background: var(--color-hover);
  color: var(--color-text);
}
.att-rm:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}

.att-tip {
  position: fixed;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: min(300px, calc(100vw - 16px));
  padding: var(--space-2);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface-raised);
  color: var(--color-text);
  box-shadow: var(--shadow-lg);
}
.att-tip:before,
.att-tip:after {
  content: '';
  position: absolute;
  right: 0;
  left: 0;
  height: var(--space-2);
}
.att-tip:before { bottom: 100%; }
.att-tip:after { top: 100%; }
.att-tip-caret {
  position: absolute;
  left: var(--tip-caret-x, 50%);
  width: 12px;
  height: 6px;
  background: var(--color-line-strong);
  transform: translateX(-50%);
}
.att-tip[data-side='top'] .att-tip-caret {
  top: 100%;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}
.att-tip[data-side='bottom'] .att-tip-caret {
  bottom: 100%;
  clip-path: polygon(50% 0, 0 100%, 100% 100%);
}
.att-tip-preview {
  display: grid;
  min-height: 116px;
  place-items: center;
  overflow: hidden;
  border-radius: var(--radius-md);
  background-color: var(--color-surface-sunken);
  background-image:
    linear-gradient(45deg, var(--color-line) 25%, transparent 25%),
    linear-gradient(-45deg, var(--color-line) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--color-line) 75%),
    linear-gradient(-45deg, transparent 75%, var(--color-line) 75%);
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
}
.att-tip-preview :deep(.att-tip-media) {
  display: block;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
}
.att-tip-placeholder {
  display: grid;
  gap: var(--space-2);
  place-items: center;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
.att-tip-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  font-size: var(--text-sm);
}
.att-tip-meta strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.att-tip-meta > span { color: var(--color-text-muted); white-space: nowrap; }
.att-tip-error {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: var(--text-xs);
}
.att-tip-foot {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.att-tip-state {
  display: inline-flex;
  flex: 1;
  align-items: center;
  gap: var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.att-tip-state.danger { color: var(--color-danger); }
.att-tip-open {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 30px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--color-hover);
  color: var(--color-text);
  font: var(--text-xs) var(--font-ui);
  cursor: pointer;
}
.att-tip-open:hover { background: var(--color-selected); }
.att-tip-open:focus-visible { outline: none; box-shadow: var(--p-focus-ring); }
</style>
