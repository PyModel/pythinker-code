<!-- apps/pythinker-web/src/components/chat/ThinkingBlock.vue -->
<!-- Reference presentation (kimi upstream web UI): a `think-head` row — bulb
     glyph, "Thinking…"/"Thinking" title, live elapsed time while streaming —
     above an inline collapsible `think-body` holding the full text. Clicking
     the head toggles the body; a block that was open while streaming folds
     itself once the stream ends. -->
<script setup lang="ts">
import { computed, inject, onUnmounted, ref, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatLiveDuration } from '../chatTurnRendering';
import Icon from '../ui/Icon.vue';

const props = withDefaults(
  defineProps<{
    text: string;
    mobile?: boolean;
    streaming?: boolean;
    /** ms epoch the thinking stream started; enables the live timer. */
    startedAtMs?: number;
    /** Settled duration; renders as a faint "· 7s" tail when present. */
    durationMs?: number;
    /** Static always-open variant (no button, no chevron). */
    forceOpen?: boolean;
  }>(),
  { mobile: false, streaming: false, forceOpen: false },
);

const { t } = useI18n();

const userOpened = ref(false);
const open = computed(() => props.forceOpen || userOpened.value);

// A block that streams open collapses as soon as the stream ends.
watch(
  () => props.streaming,
  (current, previous) => {
    if (previous && !current) userOpened.value = false;
  },
);

// Live elapsed: ticking clock anchored at `startedAt`; settled blocks show the
// captured duration instead ("· 7s"). No timestamps on the wire → no label.
const nowMs = ref(Date.now());
let tickInterval: ReturnType<typeof setInterval> | null = null;

watch(
  () => [props.streaming, props.startedAtMs] as const,
  ([streaming, startedAtMs], _previous, onCleanup) => {
    if (!streaming || startedAtMs === undefined) return;
    nowMs.value = Date.now();
    tickInterval = setInterval(() => {
      nowMs.value = Date.now();
    }, 1000);
    onCleanup(() => {
      if (tickInterval !== null) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
    });
  },
  { immediate: true },
);

onUnmounted(() => {
  if (tickInterval !== null) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
});

const timeLabel = computed(() => {
  if (props.streaming && props.startedAtMs !== undefined) {
    return Number.isFinite(props.startedAtMs) ? formatLiveDuration(nowMs.value - props.startedAtMs) : '';
  }
  if (props.durationMs !== undefined) {
    const settled = formatLiveDuration(props.durationMs);
    return settled ? `· ${settled}` : '';
  }
  return '';
});

const pinScroll = inject<(el: HTMLElement) => void>('pinScroll', () => undefined);
const headEl: Ref<HTMLElement | null> = ref(null);
const bodyInnerEl: Ref<HTMLElement | null> = ref(null);

/** Skip the height transition when expanding onto a body taller than the
 *  viewport (a streaming window would otherwise animate for seconds). */
const instant = ref(false);

function toggle(): void {
  if (props.forceOpen) return;
  if (!userOpened.value) {
    const bodyHeight = bodyInnerEl.value?.scrollHeight ?? 0;
    instant.value = props.streaming && bodyHeight > window.innerHeight;
  }
  userOpened.value = !userOpened.value;
  if (props.streaming) return;
  const el = headEl.value;
  if (el) pinScroll(el);
}
</script>

<template>
  <div class="think" :class="{ mob: mobile, open, streaming }">
    <component
      :is="forceOpen ? 'div' : 'button'"
      ref="headEl"
      class="think-head"
      :class="{ 'is-static': forceOpen }"
      v-bind="
        forceOpen
          ? {}
          : { type: 'button', 'aria-expanded': open }
      "
      @click="toggle"
    >
      <Icon class="think-bulb" name="thinking" size="sm" aria-hidden="true" />
      <span class="think-title">
        {{ streaming ? t('thinking.streaming') : t('thinking.panelTitle') }}
      </span>
      <span v-if="timeLabel" class="think-time">{{ timeLabel }}</span>
      <Icon v-if="!forceOpen" class="think-car" name="chevron-right" size="sm" aria-hidden="true" />
    </component>
    <div class="think-body" :class="{ open, instant }" :inert="!open">
      <div ref="bodyInnerEl" class="think-body-inner">
        <pre class="think-text">{{ text }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.think {
  margin: 0;
}
.think-head {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-1) 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-faint);
  font: var(--text-sm)/1 var(--font-ui);
  text-align: left;
  cursor: pointer;
  user-select: none;
  transition: color var(--duration-base) var(--ease-out);
}
.think-head:hover { color: var(--color-text); }
.think-head.is-static,
.think-head.is-static:hover { cursor: default; color: var(--color-text-faint); }
.think-head:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--color-accent-soft); }
.think-bulb { flex: none; }
.think-title { font-weight: var(--weight-medium); }
.think-time { color: var(--color-text-faint); font-weight: 400; flex: none; }
.think-car {
  color: var(--color-text-faint);
  flex: none;
  transition: transform var(--duration-base) var(--ease-out);
}
.think.open .think-car { transform: rotate(90deg); }
.think-body {
  display: grid;
  grid-template-rows: minmax(0, 0fr);
  overflow: hidden;
  transition: grid-template-rows var(--duration-base) var(--ease-out);
}
.think-body.instant { transition: none; }
.think-body.open { grid-template-rows: minmax(0, 1fr); }
.think-body-inner { min-height: 0; overflow: hidden; }
.think-text {
  font: var(--text-base)/var(--leading-relaxed) var(--font-ui);
  font-weight: 400;
  color: var(--color-text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: var(--space-1) 0 var(--space-2);
}

/* ---- Mobile tweaks ---- */
.mob .think-text {
  color: var(--color-text-faint);
  line-height: var(--leading-normal);
}

/* Streaming title breathes like the run header glyph. */
.think.streaming .think-title {
  animation: think-breathe 1.6s var(--ease-in-out) infinite;
}
@keyframes think-breathe {
  0%, to { opacity: 1; }
  50% { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .think.streaming .think-title { animation: none; }
}
</style>
