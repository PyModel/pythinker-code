<!-- apps/pythinker-web/src/components/ui/ThinkingBulb.vue -->
<!-- The `thinking` registry bulb, animated while streaming.
     Artwork (glass, filament, base) is read from lib/icons by class name, so the
     settled bulb can never drift from <Icon name="thinking">.
     The motion — glass swelling upward, base breathing in sync, filament drawing
     in and clearing out — is authored here because
     unplugin-icons strips a <style> block out of the icon SVG, and the class
     names it would target (`bulb`, `base`, `spark`) are too generic to leak into
     the global sheet.
     Two deliberate changes from the source artwork: the viewBox is cropped so the
     bulb reads larger than the surrounding line icons without growing its box (no
     row shifts when the glyph swaps), and `vector-effect: non-scaling-stroke` is
     dropped so strokes scale with the icon — pinned strokes render ~70% heavier at
     14px than at the 24px they were drawn for. The source artwork's glow disc and
     interior spark ticks are dropped: at this size a spark tick is 0.46px long and
     the glow is a 2px blob at 0.18 opacity, so both cost an animation track and
     render nothing. Restore them behind a size check if a large bulb ever ships. -->
<script setup lang="ts">
import { computed } from 'vue';
import { getIcon, SIZE_PX, type IconSize } from '../../lib/icons';

const props = withDefaults(
  defineProps<{
    /** Run current through the filament (streaming state). */
    animated?: boolean;
    size?: IconSize;
    /** Accessible label. When omitted the icon is decorative (aria-hidden). */
    label?: string;
  }>(),
  { animated: false, size: 'sm' },
);

function pathFor(cls: string): string {
  return new RegExp(`class="${cls}"[^>]*\\sd="([^"]+)"`).exec(getIcon('thinking').svg)?.[1] ?? '';
}

const bulb = computed(() => pathFor('bulb'));
const filament = computed(() => pathFor('filament'));
const base = computed(() => pathFor('base'));

const px = computed(() => SIZE_PX[props.size]);
</script>

<template>
  <svg
    class="ui-icon tb"
    :class="{ on: animated }"
    :width="px"
    :height="px"
    viewBox="0.8 0.8 22.4 22.4"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
  >
    <path class="tb-bulb" :d="bulb" stroke-width="1.7" />
    <path class="tb-filament" :d="filament" stroke-width="1.4" />
    <path class="tb-base" :d="base" stroke-width="1.7" />
  </svg>
</template>

<style scoped>
/* Peak growth reaches y≈1.16 in user space, inside the cropped viewBox with a
   little room to spare; overflow stays visible so a rounding difference cannot
   shave the top of the glass. */
.tb {
  overflow: visible;
}
.on .tb-bulb {
  transform-box: fill-box;
  transform-origin: 50% 84%;
  animation: tb-swell 1.85s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.on .tb-filament {
  stroke-dasharray: 12;
  stroke-dashoffset: 12;
  animation: tb-draw 1.85s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
.on .tb-base {
  transform-box: fill-box;
  transform-origin: center;
  animation: tb-breathe 1.85s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes tb-swell {
  0%,
  14%,
  100% {
    transform: translateY(0) scale(1, 1);
    opacity: 0.82;
  }
  38% {
    transform: translateY(-0.7px) scale(1.055, 1.09);
    opacity: 1;
  }
  58% {
    transform: translateY(-0.2px) scale(1.015, 1.025);
    opacity: 0.94;
  }
  76% {
    transform: translateY(0) scale(1, 1);
    opacity: 0.84;
  }
}
@keyframes tb-breathe {
  0%,
  18%,
  100% {
    transform: scaleX(0.96);
    opacity: 0.78;
  }
  42% {
    transform: scaleX(1.08);
    opacity: 1;
  }
  68% {
    transform: scaleX(1);
    opacity: 0.9;
  }
}
@keyframes tb-draw {
  0%,
  12% {
    stroke-dashoffset: 12;
    opacity: 0.18;
  }
  40% {
    stroke-dashoffset: 0;
    opacity: 1;
  }
  68% {
    stroke-dashoffset: 0;
    opacity: 0.92;
  }
  90%,
  100% {
    stroke-dashoffset: -12;
    opacity: 0.16;
  }
}

@media (prefers-reduced-motion: reduce) {
  .on .tb-bulb,
  .on .tb-filament,
  .on .tb-base {
    animation: none;
    opacity: 0.9;
  }
  .on .tb-filament {
    stroke-dashoffset: 0;
  }
}
</style>
