import { onUnmounted, ref } from 'vue';
import type { Ref } from 'vue';

/**
 * A reactive image src that re-arms a finite-play APNG on a fixed interval.
 * The changing query makes Chromium reload the cached image and restart it.
 */
export function useApngRestart(src: string, intervalMs = 20_000): Ref<string> {
  const out = ref(`${src}?r=0`);
  let n = 0;
  const timer = setInterval(() => {
    n += 1;
    out.value = `${src}?r=${n}`;
  }, intervalMs);
  onUnmounted(() => clearInterval(timer));
  return out;
}
