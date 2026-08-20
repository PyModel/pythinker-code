<!-- apps/pythinker-web/src/components/chat/MentionMenu.vue -->
<!-- Popup list of file paths shown when user types @ in the Composer textarea. -->
<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { fileTypeIconSvg } from '../../lib/icons';
import type { FileItem } from '../../types';

// Re-exported for the .vue consumers (Composer / ChatDock / ConversationPane)
// that import FileItem from this component.
export type { FileItem };

const props = defineProps<{
  items: FileItem[];
  activeIndex: number;
  loading: boolean;
}>();

const emit = defineEmits<{
  select: [item: FileItem];
  hover: [index: number];
}>();

const { t } = useI18n();

</script>

<template>
  <div class="mention-menu" role="listbox">
    <!-- Loading state -->
    <div v-if="props.loading" class="mention-state dim">{{ t('mention.searching') }}</div>

    <!-- Empty state (not loading, no items) -->
    <div v-else-if="props.items.length === 0" class="mention-state dim">{{ t('mention.noMatch') }}</div>

    <template v-else>
      <div class="mention-group-label">{{ t('mention.files') }}</div>
      <div
        v-for="(item, i) in props.items"
        :key="item.path"
        class="mention-item"
        :class="{ active: i === props.activeIndex }"
        role="option"
        :aria-selected="i === props.activeIndex"
        @mouseenter="emit('hover', i)"
        @mousedown.prevent="emit('select', item)"
      >
        <!-- eslint-disable-next-line vue/no-v-html -->
        <span class="mention-icon" v-html="fileTypeIconSvg(item.path, item.name)" aria-hidden="true" />
        <span class="mention-name">{{ item.name }}</span>
        <span class="mention-path">{{ item.path }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* `[role="listbox"]` raises specificity (0,3,0) so the redesign's surface +
   shadow-md win over any global menu styles. */
.mention-menu[role="listbox"] {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  right: 0;
  padding: var(--space-1);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  z-index: var(--z-dropdown);
  max-height: 220px;
  overflow-y: auto;
}

.mention-state {
  padding: 8px 12px;
  font-family: var(--font-ui);
  font-size: var(--text-sm);
}

.mention-group-label {
  padding: 5px 10px 3px;
  color: var(--color-text-faint);
  font-family: var(--font-ui);
  font-size: var(--text-xs);
}

.dim {
  color: var(--color-text-muted);
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-family: var(--font-ui);
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
}

.mention-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--color-text-faint);
  flex-shrink: 0;
}

/* Pin every glyph to the same 14px box so rows line up regardless of icon kind. */
.mention-icon :deep(svg) {
  width: 13px;
  height: 13px;
  display: block;
}

.mention-item:hover .mention-icon,
.mention-item.active .mention-icon {
  color: var(--color-text-muted);
}

.mention-item:hover {
  background: var(--color-surface-sunken);
}
.mention-item.active {
  background: var(--color-accent-soft);
}

.mention-name {
  color: var(--color-text);
  font-weight: 500;
  min-width: 80px;
  flex-shrink: 0;
}

.mention-path {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- Menu surface defaults ---- */
.mention-menu { border-radius: var(--radius-lg); box-shadow: var(--sh); }
.mention-state { font-family: var(--sans); }
</style>
