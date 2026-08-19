// apps/pythinker-web/src/composables/usePageTitle.ts
// Static page title (app name only). The session title and workspace name are
// intentionally excluded so the tab title stays stable.
// Prefix the shared Braille mark when the agent is running.

import { computed, onScopeDispose, ref, watch, watchEffect, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_FRAME_MS,
} from '../lib/brailleSpinner';

export interface UsePageTitleOptions {
  running: Ref<boolean>;
  showAuthGate: Ref<boolean>;
}

export function usePageTitle({ running, showAuthGate }: UsePageTitleOptions): void {
  const { t } = useI18n();
  const runningIndicator = ref<string>(BRAILLE_SPINNER_FRAMES[0]);
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  function stopSpinner(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  }

  watch(running, (isRunning) => {
    stopSpinner();
    frameIndex = 0;
    runningIndicator.value = BRAILLE_SPINNER_FRAMES[0];
    if (!isRunning) return;
    timer = setInterval(() => {
      frameIndex = (frameIndex + 1) % BRAILLE_SPINNER_FRAMES.length;
      runningIndicator.value = BRAILLE_SPINNER_FRAMES[frameIndex] ?? BRAILLE_SPINNER_FRAMES[0];
    }, BRAILLE_SPINNER_FRAME_MS);
  }, { immediate: true });
  onScopeDispose(stopSpinner);

  const pageTitle = computed<string>(() => {
    const prefix = running.value ? `${runningIndicator.value} ` : '';
    if (showAuthGate.value) return `${prefix}${t('app.authPageTitle')} - Pythinker Code Web`;
    return `${prefix}Pythinker Code Web`;
  });
  watchEffect(() => {
    if (typeof document !== 'undefined') document.title = pageTitle.value;
  });
}
