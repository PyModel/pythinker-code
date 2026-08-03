<!-- apps/pythinker-web/src/components/ActivitySpinner.vue -->
<!-- CSS-only braille spinner used while waiting for a response. -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
  formatThinkingSpinnerLabel,
  THINKING_SPINNER_LABEL_INTERVAL_MS,
} from '../lib/thinkingSpinnerLabels';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_FRAME_MS = 80;
const SPINNER_FAST_FRAME_MS = 40;

const props = defineProps<{
  fast?: boolean;
  /** When set, overrides the rotating verb label. */
  label?: string;
}>();

const nowMs = ref(Date.now());
let labelTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  if (props.label !== undefined) return;
  labelTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, THINKING_SPINNER_LABEL_INTERVAL_MS);
});

onUnmounted(() => {
  if (labelTimer !== undefined) clearInterval(labelTimer);
});

const displayLabel = computed(() =>
  props.label ?? formatThinkingSpinnerLabel(nowMs.value),
);

function spinnerFrameStyle(index: number): Record<string, string> {
  return {
    '--spinner-frame-delay': `${index * SPINNER_FRAME_MS}ms`,
    '--spinner-frame-fast-delay': `${index * SPINNER_FAST_FRAME_MS}ms`,
  };
}
</script>

<template>
  <span class="activity-spin" :class="{ 'activity-spin--fast': fast }" :aria-label="displayLabel" role="img">
    <span
      v-for="(frame, index) in SPINNER_FRAMES"
      :key="frame"
      class="activity-frame"
      :style="spinnerFrameStyle(index)"
      aria-hidden="true"
    >
      {{ frame }}
    </span>
  </span>
</template>

<style scoped>
.activity-spin {
  --spinner-frame: 1.15em;
  display: inline-block;
  position: relative;
  width: var(--spinner-frame);
  height: var(--spinner-frame);
  font-size: var(--ui-font-size);
  line-height: 1;
  user-select: none;
  vertical-align: -0.1em;
}

.activity-frame {
  position: absolute;
  inset: 0;
  display: block;
  text-align: center;
  opacity: 0;
  animation-name: activity-frame;
  animation-duration: 800ms;
  animation-timing-function: steps(1, end);
  animation-iteration-count: infinite;
  animation-delay: var(--spinner-frame-delay);
}

.activity-spin--fast .activity-frame {
  animation-duration: 400ms;
  animation-delay: var(--spinner-frame-fast-delay);
}

@keyframes activity-frame {
  0%,
  9.99% { opacity: 1; }
  10%,
  100% { opacity: 0; }
}
</style>
