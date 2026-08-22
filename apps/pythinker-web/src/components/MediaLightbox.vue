<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef } from 'vue';
import type { ToolMedia } from '../types';
import { useBodyScrollLock } from '../composables/useBodyScrollLock';
import Icon from './ui/Icon.vue';

const props = defineProps<{
  media: ToolMedia;
  src: string;
  originImg?: HTMLImageElement;
}>();

const emit = defineEmits<{
  close: [];
}>();

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const overlayRef = useTemplateRef<HTMLElement>('overlay');
const closeRef = useTemplateRef<HTMLButtonElement>('close');
const imageRef = useTemplateRef<HTMLImageElement>('image');
const isImage = computed(() => props.media.kind === 'image');
const label = computed(() => props.media.path ?? (isImage.value ? 'Image preview' : 'Video preview'));
const scale = shallowRef(1);
const panX = shallowRef(0);
const panY = shallowRef(0);
const dragging = shallowRef(false);
const imageStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
  cursor: scale.value > 1 ? (dragging.value ? 'grabbing' : 'grab') : 'zoom-in',
}));

let restoreFocus: HTMLElement | null = null;
let dragPointer: number | null = null;
let dragStartX = 0;
let dragStartY = 0;
let panStartX = 0;
let panStartY = 0;

const { lock: lockBody, unlock: unlockBody } = useBodyScrollLock();

function resetImage(): void {
  scale.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function onWheel(event: WheelEvent): void {
  if (!isImage.value) return;
  event.preventDefault();
  const nextScale = Math.min(8, Math.max(1, scale.value * (event.deltaY < 0 ? 1.1 : 0.9)));
  scale.value = nextScale;
  if (nextScale === 1) {
    panX.value = 0;
    panY.value = 0;
  }
}

function toggleActualSize(): void {
  if (scale.value !== 1) {
    resetImage();
    return;
  }
  const image = imageRef.value;
  if (!image) return;
  scale.value = Math.min(8, Math.max(1, image.naturalWidth / image.clientWidth));
}

function startDrag(event: PointerEvent): void {
  if (scale.value <= 1) return;
  dragPointer = event.pointerId;
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  panStartX = panX.value;
  panStartY = panY.value;
  dragging.value = true;
  imageRef.value?.setPointerCapture(event.pointerId);
}

function drag(event: PointerEvent): void {
  if (dragPointer !== event.pointerId) return;
  panX.value = panStartX + event.clientX - dragStartX;
  panY.value = panStartY + event.clientY - dragStartY;
}

function endDrag(event: PointerEvent): void {
  if (dragPointer !== event.pointerId) return;
  imageRef.value?.releasePointerCapture(event.pointerId);
  dragPointer = null;
  dragging.value = false;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close');
    return;
  }
  if (event.key !== 'Tab' || !overlayRef.value) return;
  const focusable = overlayRef.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (!overlayRef.value.contains(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  lockBody();
  restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : props.originImg ?? null;
  window.addEventListener('keydown', onKeydown);
  closeRef.value?.focus();
});

onUnmounted(() => {
  unlockBody();
  window.removeEventListener('keydown', onKeydown);
  restoreFocus?.focus();
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlay"
      class="media-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="label"
      @mousedown.self="emit('close')"
    >
      <button
        ref="close"
        type="button"
        class="media-lightbox-close"
        aria-label="Close"
        @click="emit('close')"
      >
        <Icon name="close" size="sm" />
      </button>
      <div class="media-lightbox-card">
        <div class="media-lightbox-frame" @wheel="onWheel">
          <img
            v-if="isImage"
            ref="image"
            class="media-lightbox-media"
            :src="src"
            :alt="media.path ?? ''"
            draggable="false"
            :style="imageStyle"
            @dblclick="toggleActualSize"
            @pointerdown="startDrag"
            @pointermove="drag"
            @pointerup="endDrag"
            @pointercancel="endDrag"
          >
          <video
            v-else
            class="media-lightbox-media"
            :src="src"
            controls
            autoplay
          />
        </div>
      </div>
      <div v-if="media.path" class="media-preview-caption">{{ media.path }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
.media-lightbox {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--color-scrim-strong);
}
.media-lightbox-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  max-width: min(960px, calc(100vw - var(--space-6) * 2));
  max-height: calc(100vh - var(--space-6) * 2);
}
.media-lightbox-frame {
  max-width: 100%;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-bg);
  box-shadow: var(--shadow-xl);
  touch-action: none;
}
.media-lightbox-media {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - var(--space-6) * 4);
  object-fit: contain;
  transform-origin: center;
  user-select: none;
}
.media-lightbox-close {
  position: fixed;
  top: var(--space-4);
  right: var(--space-6);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: .5px solid var(--color-line);
  border-radius: var(--radius-full);
  background: var(--color-surface-raised);
  color: var(--color-text);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  z-index: var(--z-modal-dropdown);
}
.media-lightbox-close::before {
  content: '';
  position: absolute;
  inset: -6px;
}
.media-lightbox-close:hover {
  border-color: var(--color-line-strong);
  background: var(--color-surface-sunken);
}
.media-preview-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: var(--space-4);
  padding: 0 var(--space-6);
  color: var(--color-text-on-scrim);
  font-size: var(--ui-font-size-xs);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}
</style>
