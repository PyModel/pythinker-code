<!-- apps/pythinker-web/src/components/ui/AgentThinking.vue -->
<!-- 4x4 matrix agent-thinking spinner with multiple motion variants. -->
<script setup lang="ts">
import type { CSSProperties } from 'vue';

export type ThinkingVariant = 'scan' | 'orbit' | 'twinkle' | 'pulse' | 'wave';

const props = withDefaults(
  defineProps<{
    variant?: ThinkingVariant;
    rounded?: boolean;
    label?: string;
    showLabel?: boolean;
    size?: 'sm' | 'md' | 'lg';
  }>(),
  {
    variant: 'wave',
    rounded: false,
    label: 'Thinking',
    showLabel: true,
    size: 'md',
  },
);

const CORNERS = new Set([0, 3, 12, 15]);

const delays: Record<ThinkingVariant, readonly number[]> = {
  scan: [
    0, 120, 240, 360,
    0, 120, 240, 360,
    0, 120, 240, 360,
    0, 120, 240, 360,
  ],
  orbit: [
    300, 150, 0, 150,
    450, 0, 0, 300,
    600, 0, 0, 450,
    750, 900, 750, 600,
  ],
  twinkle: [
    525, 150, 825, 375,
    1050, 675, 0, 900,
    225, 1125, 450, 750,
    975, 75, 600, 300,
  ],
  pulse: [
    260, 190, 190, 260,
    190, 0, 0, 190,
    190, 0, 0, 190,
    260, 190, 190, 260,
  ],
  wave: [
    0, 90, 180, 270,
    90, 180, 270, 360,
    180, 270, 360, 450,
    270, 360, 450, 540,
  ],
};

function isCornerGap(index: number): boolean {
  return props.rounded && CORNERS.has(index);
}

function cellStyle(delay: number, index: number): CSSProperties {
  return {
    '--delay': `${delay}ms`,
    '--index': index,
  } as CSSProperties;
}
</script>

<template>
  <div
    class="agent-thinking"
    :class="`agent-thinking--${size}`"
    role="status"
    aria-live="polite"
    :aria-label="label"
  >
    <div
      class="agent-thinking__matrix"
      :data-variant="variant"
      aria-hidden="true"
    >
      <i
        v-for="(delay, index) in delays[variant]"
        :key="index"
        :class="{ 'is-gap': isCornerGap(index) }"
        :style="cellStyle(delay, index)"
      />
    </div>

    <div v-if="showLabel" class="agent-thinking__label">
      <span>{{ label }}</span>
      <span class="agent-thinking__ellipsis" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  </div>
</template>

<style scoped>
.agent-thinking {
  --thinking-cycle: 1150ms;
  --thinking-idle: color-mix(in srgb, currentColor 14%, transparent);
  --thinking-mid: color-mix(in srgb, currentColor 38%, transparent);
  --thinking-active: color-mix(in srgb, currentColor 82%, transparent);
  --thinking-dot: 3px;
  --thinking-gap: 2.5px;

  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font: var(--text-xs)/1 var(--font-ui);
  user-select: none;
}

.agent-thinking__matrix {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, var(--thinking-dot));
  grid-template-rows: repeat(4, var(--thinking-dot));
  gap: var(--thinking-gap);
  flex: none;
}

.agent-thinking__matrix > i {
  width: var(--thinking-dot);
  height: var(--thinking-dot);
  display: block;
  background: var(--thinking-idle);
  border-radius: 0;
  animation: agent-thinking-pulse var(--thinking-cycle) cubic-bezier(0.4, 0, 0.2, 1) infinite;
  animation-delay: var(--delay);
  will-change: transform, opacity, background-color;
}

.agent-thinking__matrix > i.is-gap {
  visibility: hidden;
  animation: none;
}

@keyframes agent-thinking-pulse {
  0%, 44%, 100% {
    background: var(--thinking-idle);
    opacity: 0.7;
    transform: scale(0.86);
  }
  12% {
    background: var(--thinking-active);
    opacity: 1;
    transform: scale(1);
  }
  22% {
    background: var(--thinking-mid);
    opacity: 0.9;
    transform: scale(0.94);
  }
}

.agent-thinking__label {
  display: inline-flex;
  align-items: baseline;
  min-width: 0;
  color: currentColor;
  letter-spacing: -0.01em;
}

.agent-thinking__ellipsis {
  width: 14px;
  margin-left: 2px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.agent-thinking__ellipsis > i {
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.25;
  animation: agent-thinking-ellipsis 1100ms ease-in-out infinite;
}

.agent-thinking__ellipsis > i:nth-child(2) {
  animation-delay: 120ms;
}

.agent-thinking__ellipsis > i:nth-child(3) {
  animation-delay: 240ms;
}

@keyframes agent-thinking-ellipsis {
  0%, 60%, 100% {
    opacity: 0.2;
    transform: translateY(0);
  }
  25% {
    opacity: 0.8;
    transform: translateY(-1px);
  }
}

.agent-thinking__matrix[data-variant="scan"] > i {
  animation-timing-function: cubic-bezier(0.32, 0, 0.22, 1);
}

.agent-thinking__matrix[data-variant="orbit"] > i {
  border-radius: 50%;
}

.agent-thinking__matrix[data-variant="twinkle"] > i:nth-child(3n) {
  animation-duration: 1320ms;
}

.agent-thinking__matrix[data-variant="twinkle"] > i:nth-child(4n) {
  animation-duration: 980ms;
}

.agent-thinking__matrix[data-variant="pulse"] > i:nth-child(6),
.agent-thinking__matrix[data-variant="pulse"] > i:nth-child(7),
.agent-thinking__matrix[data-variant="pulse"] > i:nth-child(10),
.agent-thinking__matrix[data-variant="pulse"] > i:nth-child(11) {
  --thinking-idle: color-mix(in srgb, currentColor 22%, transparent);
}

.agent-thinking--sm {
  --thinking-dot: 2px;
  --thinking-gap: 2px;
  gap: var(--space-1);
}

.agent-thinking--md {
  --thinking-dot: 3px;
  --thinking-gap: 2.5px;
}

.agent-thinking--lg {
  --thinking-dot: 4px;
  --thinking-gap: 3px;
  gap: var(--space-2);
  font: var(--text-sm)/1 var(--font-ui);
}

@media (prefers-reduced-motion: reduce) {
  .agent-thinking__matrix > i,
  .agent-thinking__ellipsis > i {
    animation: none !important;
    transform: none;
  }
  .agent-thinking__matrix > i:nth-child(6),
  .agent-thinking__matrix > i:nth-child(7),
  .agent-thinking__matrix > i:nth-child(10),
  .agent-thinking__matrix > i:nth-child(11) {
    background: var(--thinking-active);
    opacity: 0.75;
  }
}
</style>
