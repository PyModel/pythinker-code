<!-- apps/pythinker-web/src/components/chat/MediaThumb.vue -->
<!-- Square media tile for composer pending-upload thumbnails: a real
     image/video tile with a centered uploading spinner,
     error badge, video play badge, and a corner remove button. Non-media
     attachmens keep the pill chip (AttachmentChip). -->
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AuthMedia from './AuthMedia.vue';
import Icon from '../ui/Icon.vue';
import Spinner from '../ui/Spinner.vue';
import Tooltip from '../ui/Tooltip.vue';

const props = withDefaults(
  defineProps<{
    kind: 'image' | 'video';
    /** Undefined only for pasted media without a name — a generic label shows. */
    name?: string;
    /** Media source (object URL or the authed file URL). */
    url?: string;
    /** When present, AuthMedia fetches the bytes with auth. */
    fileId?: string;
    /** Upload in flight — spinner badge over the tile. */
    uploading?: boolean;
    /** Upload failed — tinted border + info badge. */
    error?: boolean;
    /** Show a corner remove button. */
    removable?: boolean;
    /** Accessible label for the remove button. */
    removeLabel?: string;
  }>(),
  { uploading: false, error: false, removable: false },
);

const emit = defineEmits<{
  /** Primary action (preview) carries the tile image for the zoom origin. */
  activate: [img: HTMLImageElement | null];
  remove: [];
}>();

const { t } = useI18n();

const label = computed(() => {
  if (props.name) return props.name;
  return props.kind === 'video' ? t('composer.attachmentVideo') : t('composer.attachmentImage');
});

function onActivate(event: MouseEvent): void {
  const target = event.currentTarget as HTMLElement | null;
  emit('activate', target?.querySelector('img') ?? null);
}
</script>

<template>
  <span class="media-thumb" :class="{ 'is-error': props.error, uploading: props.uploading }">
    <button
      type="button"
      class="media-thumb-btn"
      :title="label"
      :aria-label="label"
      @click="onActivate"
    >
      <AuthMedia
        v-if="props.url"
        :url="props.url"
        :kind="props.kind"
        :alt="props.name"
        :file-id="props.fileId"
        media-class="media-thumb-media"
        :controls="false"
        muted
      />
      <span v-else class="media-thumb-media media-thumb-tile" aria-hidden="true" />
      <span v-if="props.uploading" class="media-thumb-badge">
        <Spinner size="sm" :label="t('composer.uploading')" />
      </span>
      <span v-else-if="props.error" class="media-thumb-badge is-error"><Icon name="info" size="sm" /></span>
      <span v-else-if="props.kind === 'video'" class="media-thumb-badge"><Icon name="play" size="sm" /></span>
    </button>
    <Tooltip v-if="props.removable" :text="props.removeLabel ?? t('composer.remove')">
      <button
        type="button"
        class="media-thumb-rm"
        :aria-label="props.removeLabel ?? t('composer.remove')"
        @click="emit('remove')"
      >
        <Icon name="close" size="sm" />
      </button>
    </Tooltip>
  </span>
</template>

<style scoped>
.media-thumb {
  position: relative;
  flex: none;
  display: inline-flex;
}

.media-thumb-btn {
  display: block;
  padding: 0;
  border: .5px solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-well);
  overflow: hidden;
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out);
}
.media-thumb-btn:hover { border-color: var(--color-line-strong); }
.media-thumb-btn:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
.media-thumb.is-error .media-thumb-btn { border-color: var(--color-danger-bd); }

.media-thumb-media {
  display: block;
  width: var(--p-media-thumb-size);
  height: var(--p-media-thumb-size);
  object-fit: cover;
}
/* Bare tile (no resolvable media source yet). */
.media-thumb-tile { object-fit: none; }

.media-thumb-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--radius-full);
  background: var(--color-surface-raised);
  border: .5px solid var(--color-line);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
  pointer-events: none;
}
.media-thumb-badge.is-error {
  color: var(--color-danger);
  border-color: var(--color-danger-bd);
}

.media-thumb-rm {
  position: absolute;
  top: var(--space-1);
  right: var(--space-1);
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--color-scrim);
  color: var(--color-text-on-scrim);
  cursor: pointer;
}
.media-thumb-rm:hover {
  background: var(--color-text);
  color: var(--color-bg);
}
.media-thumb-rm:focus-visible {
  outline: none;
  box-shadow: var(--p-focus-ring);
}
</style>