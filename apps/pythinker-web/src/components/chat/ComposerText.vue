<script setup lang="ts">
import { computed, ref } from 'vue';
import { fileTypeIconSvg } from '../../lib/icons';
import {
  middleTruncateName,
  parseMentionSegments,
  serializeMention,
  type MentionAttrs,
} from '../../lib/mentions';

const props = withDefaults(
  defineProps<{
    text: string;
    interactive?: boolean;
    openFile?: (target: { path: string }) => void;
  }>(),
  { interactive: true },
);

const root = ref<HTMLElement | null>(null);
const segments = computed(() => parseMentionSegments(props.text));

function activate(event: Event, attrs: MentionAttrs): void {
  if (attrs.kind !== 'file' || !props.interactive || !props.openFile) return;
  event.preventDefault();
  event.stopPropagation();
  props.openFile({ path: attrs.path });
}

function onCopy(event: ClipboardEvent): void {
  const selection = window.getSelection();
  const wrapper = root.value;
  if (!selection || selection.rangeCount === 0 || !wrapper || !event.clipboardData) return;
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(wrapper)) return;

  const fragment = range.cloneContents();
  for (const element of fragment.querySelectorAll<HTMLElement>('.mention-pill')) {
    const { mentionKind: kind, mentionName: name, mentionPath: path } = element.dataset;
    if ((kind !== 'file' && kind !== 'folder') || name === undefined || path === undefined) continue;
    element.replaceWith(document.createTextNode(serializeMention({ kind, name, path })));
  }
  event.clipboardData.setData('text/plain', fragment.textContent ?? '');
  event.preventDefault();
}
</script>

<template>
  <span ref="root" class="composer-text" @copy="onCopy">
    <template v-for="(segment, index) in segments" :key="index">
      <template v-if="segment.type === 'text'">{{ segment.value }}</template>
      <span
        v-else
        class="mention-pill"
        :class="`mention-${segment.attrs.kind}`"
        :data-mention-kind="segment.attrs.kind"
        :data-mention-name="segment.attrs.name"
        :data-mention-path="segment.attrs.path"
        :tabindex="segment.attrs.kind === 'file' && interactive && openFile ? 0 : undefined"
        :role="segment.attrs.kind === 'file' && interactive && openFile ? 'button' : undefined"
        @click="activate($event, segment.attrs)"
        @keydown.enter="activate($event, segment.attrs)"
        @keydown.space="activate($event, segment.attrs)"
      >
        <!-- eslint-disable-next-line vue/no-v-html -->
        <span class="mention-pill-icon" aria-hidden="true" v-html="fileTypeIconSvg(segment.attrs.path, segment.attrs.name)" />
        <span class="mention-pill-name">{{ middleTruncateName(segment.attrs.name) }}</span>
      </span>
    </template>
  </span>
</template>
