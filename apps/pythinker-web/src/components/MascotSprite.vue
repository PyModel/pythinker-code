<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

type MascotState = 'running' | 'waiting' | 'failed';
type ThinkingPose = 'laptop' | 'review';

const CELL_WIDTH = 192;
const CELL_HEIGHT = 208;
const ROWS: Record<MascotState, number> = { failed: 0, waiting: 1, running: 2 };
const LAPTOP_FRAME_COUNT = 6;
const LAPTOP_FRAME_DELAY_MS = 300;
const REVIEW_FRAME_COUNT = 6;
const REVIEW_FRAME_DELAY_MS = 250;
const LAPTOP_PLAY_MS = LAPTOP_FRAME_COUNT * LAPTOP_FRAME_DELAY_MS;
const REVIEW_PLAY_MS = REVIEW_FRAME_COUNT * REVIEW_FRAME_DELAY_MS;

const props = withDefaults(
  defineProps<{ state: MascotState; size?: number }>(),
  { size: 48 },
);

const pose = ref<ThinkingPose>('laptop');
let poseTimer: ReturnType<typeof setTimeout> | undefined;

const mascotStyle = computed<Record<string, string>>(() => {
  const size = props.size;
  const height = size * CELL_HEIGHT / CELL_WIDTH;
  return { width: `${size}px`, height: `${height}px` };
});

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

const poseSrc = computed(() => `/brand/mascot-${pose.value}.png`);

function reducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function clearPoseTimer(): void {
  if (poseTimer !== undefined) {
    clearTimeout(poseTimer);
    poseTimer = undefined;
  }
}

function schedulePoseSwitch(): void {
  clearPoseTimer();
  if (props.state === 'failed' || reducedMotion()) return;

  const delay = pose.value === 'laptop' ? LAPTOP_PLAY_MS : REVIEW_PLAY_MS;
  poseTimer = setTimeout(() => {
    poseTimer = undefined;
    pose.value = pose.value === 'laptop' ? 'review' : 'laptop';
    schedulePoseSwitch();
  }, delay);
}

onMounted(schedulePoseSwitch);
onUnmounted(clearPoseTimer);

watch(
  () => props.state === 'failed',
  (failed) => {
    if (failed) {
      clearPoseTimer();
      return;
    }
    pose.value = 'laptop';
    schedulePoseSwitch();
  },
);
</script>

<template>
  <img
    v-if="props.state !== 'failed'"
    aria-hidden="true"
    class="mascot-apng"
    :src="poseSrc"
    :style="mascotStyle"
  />
  <span
    v-else
    aria-hidden="true"
    class="mascot-sprite"
    :class="`mascot-sprite--${props.state}`"
    :style="spriteStyle"
  />
</template>

<style scoped>
.mascot-apng {
  display: inline-block;
  flex: none;
  image-rendering: pixelated;
}

.mascot-sprite {
  display: inline-block;
  flex: none;
  background-repeat: no-repeat;
  background-position-x: 0;
  image-rendering: pixelated;
}

.mascot-sprite--failed {
  animation: mascot-failed 1s steps(8) infinite;
}

@keyframes mascot-failed {
  from { background-position-x: 0; }
  to { background-position-x: var(--mascot-failed-end); }
}

@media (prefers-reduced-motion: reduce) {
  .mascot-sprite { animation: none; }
}
</style>
