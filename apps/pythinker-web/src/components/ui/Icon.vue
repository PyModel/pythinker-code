<!-- apps/pythinker-web/src/components/ui/Icon.vue -->
<!-- Design-system §02 icon primitive. Renders a registered line icon from
     lib/icons.ts at a token size. Use everywhere instead of hand-writing raw SVG.
     Animated registry entries carry no compiled component (the ~icons pipeline
     strips their <style>), so they are inlined from entry.svg via iconSvg(). -->
<script setup lang="ts">
import { computed } from 'vue';
import { getIcon, iconSvg, SIZE_PX, type IconName, type IconSize } from '../../lib/icons';

const props = withDefaults(
  defineProps<{
    name: IconName;
    size?: IconSize;
    /** Accessible label. When omitted the icon is decorative (aria-hidden). */
    label?: string;
    /** Animated artwork only: keep the motion running (e.g. while the agent works). Otherwise it plays on hover. */
    live?: boolean;
  }>(),
  { size: 'md' },
);

const entry = computed(() => getIcon(props.name));
const px = computed(() => SIZE_PX[props.size]);
const animatedHtml = computed(() =>
  entry.value?.animated ? iconSvg(props.name, props.size, props.label) : '',
);
</script>

<template>
  <span
    v-if="entry?.animated"
    :class="{ 'ptx-live': live }"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
    v-html="animatedHtml"
  />
  <component
    v-else-if="entry?.component"
    :is="entry.component"
    :class="['ui-icon', { 'ui-icon--chat-new': name === 'chat-new' }]"
    :width="px"
    :height="px"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
  />
</template>

<style scoped>
:is(button, a, [role='button'], .ptx-hover):hover .ui-icon--chat-new {
  animation: ui-icon-chat-new-spin var(--duration-slow) var(--ease-out);
}

@keyframes ui-icon-chat-new-spin {
  to { transform: rotate(360deg); }
}
</style>
