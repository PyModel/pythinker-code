<!-- apps/pythinker-web/src/components/ui/ThinkingIndicator.vue -->
<!-- The chat waiting indicator. Keep the exact Braille mark consistent with the TUI. -->
<script setup lang="ts">
import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_FRAME_MS,
} from '../../lib/brailleSpinner';

withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg';
  fast?: boolean;
  label?: string;
}>(), {
  size: 'md',
  label: 'Waiting for response…',
});

const cycleMs = BRAILLE_SPINNER_FRAMES.length * BRAILLE_SPINNER_FRAME_MS;

function frameStyle(index: number): Record<string, string> {
  return {
    '--thinking-frame-delay': `${index * BRAILLE_SPINNER_FRAME_MS - cycleMs}ms`,
    '--thinking-frame-fast-delay': `${index * (BRAILLE_SPINNER_FRAME_MS / 2) - cycleMs / 2}ms`,
  };
}
</script>

<template>
  <span
    class="ui-thinking-indicator"
    :class="[
      `ui-thinking-indicator--${size}`,
      { 'ui-thinking-indicator--fast': fast },
    ]"
    :aria-label="label"
    role="status"
  >
    <span
      v-for="(frame, index) in BRAILLE_SPINNER_FRAMES"
      :key="frame"
      class="ui-thinking-indicator__frame"
      :style="frameStyle(index)"
      aria-hidden="true"
    >
      {{ frame }}
    </span>
  </span>
</template>

<style scoped>
.ui-thinking-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  line-height: 1;
  color: var(--color-accent);
  font-family: var(--font-mono);
  user-select: none;
  position: relative;
}
.ui-thinking-indicator--sm { width: 14px; height: 14px; font-size: 14px; }
.ui-thinking-indicator--md { width: 18px; height: 18px; font-size: 18px; }
.ui-thinking-indicator--lg { width: 24px; height: 24px; font-size: 24px; }

.ui-thinking-indicator__frame {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  opacity: 0;
  animation: ui-thinking-indicator-frame 640ms steps(1, end) infinite;
  animation-delay: var(--thinking-frame-delay);
}
.ui-thinking-indicator--fast .ui-thinking-indicator__frame {
  animation-duration: 320ms;
  animation-delay: var(--thinking-frame-fast-delay);
}

@keyframes ui-thinking-indicator-frame {
  0%, 12.49% { opacity: 1; }
  12.5%, 100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-thinking-indicator__frame { animation: none; }
  .ui-thinking-indicator__frame:first-child { opacity: 1; }
}
</style>
