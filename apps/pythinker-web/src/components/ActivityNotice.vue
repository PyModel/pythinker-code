<!-- apps/pythinker-web/src/components/ActivityNotice.vue -->
<!-- Generic in-transcript "working on X" notice: braille spinner plus a
     body-sized label. Used for long-running session activities that are not a
     chat turn (e.g. "Compacting context…"). Renders inline at the end of the
     transcript in both the bubble and line layouts. -->
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

defineProps<{
  label: string;
}>();

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

const spinnerFrame = ref(0);
let spinnerInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  spinnerInterval = setInterval(() => {
    spinnerFrame.value = (spinnerFrame.value + 1) % SPINNER_FRAMES.length;
  }, SPINNER_INTERVAL_MS);
});

onUnmounted(() => {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
});
</script>

<template>
  <div class="activity-notice" role="status">
    <span class="an-spinner" aria-hidden="true">{{ SPINNER_FRAMES[spinnerFrame] }}</span>
    <span class="an-label">{{ label }}</span>
  </div>
</template>

<style scoped>
/* Same size as assistant body text (.a-msg .msg / Markdown) so the notice
   reads as part of the conversation, not as chrome. */
.activity-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  margin: 0;
  font-size: var(--ui-font-size);
  line-height: 1.6;
  color: var(--ink);
}
.an-spinner {
  font-size: var(--ui-font-size);
  line-height: 1;
  user-select: none;
}

/* Mobile font bump (+2px), matching ChatPane's body text. */
@media (max-width: 640px) {
  .activity-notice,
  .an-spinner {
    font-size: var(--ui-font-size-xl);
  }
}
</style>
