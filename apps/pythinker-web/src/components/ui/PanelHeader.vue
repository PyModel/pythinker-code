<!-- apps/pythinker-web/src/components/ui/PanelHeader.vue -->
<!-- Shared right-side panel header: bold mono title + optional muted subtitle,
     a default slot for middle content (badges, controls, path…), and a close
     IconButton pinned to the right. Replaces the per-panel hand-rolled headers
     (.tp-header / .ap-header / .tdp-header / .dv-panel-head / .sc-header …). -->
<script setup lang="ts">
import IconButton from './IconButton.vue';
import Icon from './Icon.vue';
import Tooltip from './Tooltip.vue';

withDefaults(defineProps<{
  title: string;
  subtitle?: string;
  closable?: boolean;
  closeLabel?: string;
  /** Allow middle content to wrap to extra rows (e.g. FilePreview's many controls). */
  wrap?: boolean;
}>(), {
  closable: true,
  closeLabel: 'Close',
});

defineEmits<{ close: [] }>();
</script>

<template>
  <div class="ui-panel-header" :class="{ wrap }">
    <!-- Everything except Close lives in __main so the close control never
         joins the wrapping flow: it stays pinned to the top-right corner at
         every panel width, however many rows the content needs. -->
    <div class="ui-panel-header__main">
      <span class="ui-panel-header__title">{{ title }}</span>
      <Tooltip :text="subtitle">
        <span v-if="subtitle" class="ui-panel-header__sub">{{ subtitle }}</span>
      </Tooltip>
      <slot />
    </div>
    <IconButton
      v-if="closable"
      class="ui-panel-header__close"
      size="sm"
      :label="closeLabel"
      @click="$emit('close')"
    >
      <Icon name="close" size="sm" />
    </IconButton>
  </div>
</template>

<style scoped>
.ui-panel-header {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--panel-head-h, 48px);
  padding: 0 6px 0 var(--space-3);
  box-sizing: border-box;
  min-width: 0;
  border-bottom: 0.5px solid var(--color-line);
  background: var(--color-surface);
}
.ui-panel-header__main {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.ui-panel-header__title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--weight-semibold) var(--text-xs) var(--font-mono);
  letter-spacing: 0.04em;
  color: var(--color-text);
}
.ui-panel-header__sub {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font: var(--text-xs) var(--font-mono);
  color: var(--color-text-muted);
}
.ui-panel-header__close {
  flex: none;
  margin-left: auto;
}
.ui-panel-header.wrap {
  align-items: flex-start;
  height: auto;
  min-height: var(--panel-head-h, 48px);
  padding-top: 3px;
  padding-bottom: 3px;
}
.ui-panel-header.wrap .ui-panel-header__main {
  flex-wrap: wrap;
  gap: 4px 6px;
  /* Keep the first row vertically centred against the 48px minimum height
     while extra rows grow downward. */
  min-height: calc(var(--panel-head-h, 48px) - 6px);
  align-content: center;
}
.ui-panel-header.wrap .ui-panel-header__close {
  /* Pin to the corner: same vertical centre as a single-row header. */
  margin-top: calc((var(--panel-head-h, 48px) - 6px - 26px) / 2);
}
</style>
