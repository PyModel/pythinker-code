<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

type MascotState = 'running' | 'waiting' | 'failed';
type ThinkingPose = 'laptop' | 'review';

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
  return {
    width: `${size}px`,
    height: `${size * 208 / 192}px`,
  };
});

const mascotSrc = computed(() => {
  if (props.state === 'failed') return '/brand/mascot-failed.png';
  if (props.state === 'waiting') return '/brand/mascot-idle.png';
  return `/brand/mascot-${pose.value}.png`;
});

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
  if (props.state !== 'running' || reducedMotion()) return;

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
  () => props.state,
  (state) => {
    clearPoseTimer();
    pose.value = 'laptop';
    if (state === 'running') schedulePoseSwitch();
  },
);
</script>

<template>
  <img
    aria-hidden="true"
    class="mascot-apng"
    :src="mascotSrc"
    :style="mascotStyle"
  />
</template>

<style scoped>
.mascot-apng {
  display: inline-block;
  flex: none;
  image-rendering: pixelated;
}
</style>
