<script setup lang="ts">
import { computed } from 'vue';

type MascotState = 'running' | 'waiting' | 'failed';

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const ROWS: Record<MascotState, number> = { failed: 0, waiting: 1, running: 2 };

const props = withDefaults(
  defineProps<{ state: MascotState; size?: number }>(),
  { size: 48 },
);

const spriteStyle = computed<Record<string, string>>(() => {
  const size = props.size;
  const height = size * CELL_HEIGHT / CELL_WIDTH;
  return {
    width: `${size}px`,
    height: `${height}px`,
    backgroundImage: "url('/brand/mascot-states.png')",
    backgroundSize: `${size * 8}px ${height * 3}px`,
    backgroundPositionY: `${-ROWS[props.state] * height}px`,
    '--mascot-running-end': `${-size * 6}px`,
    '--mascot-waiting-end': `${-size * 6}px`,
    '--mascot-failed-end': `${-size * 8}px`,
  };
});
</script>

<template>
  <span
    aria-hidden="true"
    class="mascot-sprite"
    :class="`mascot-sprite--${props.state}`"
    :style="spriteStyle"
  />
</template>

<style scoped>
.mascot-sprite {
  display: inline-block;
  flex: none;
  background-repeat: no-repeat;
  background-position-x: 0;
  image-rendering: pixelated;
}

.mascot-sprite--running {
  animation: mascot-running 0.84s steps(6) infinite;
}
.mascot-sprite--waiting {
  animation: mascot-waiting 1.1s steps(6) infinite;
}
.mascot-sprite--failed {
  animation: mascot-failed 1s steps(8) infinite;
}

@keyframes mascot-running {
  from { background-position-x: 0; }
  to { background-position-x: var(--mascot-running-end); }
}
@keyframes mascot-waiting {
  from { background-position-x: 0; }
  to { background-position-x: var(--mascot-waiting-end); }
}
@keyframes mascot-failed {
  from { background-position-x: 0; }
  to { background-position-x: var(--mascot-failed-end); }
}

@media (prefers-reduced-motion: reduce) {
  .mascot-sprite { animation: none; }
}
</style>
