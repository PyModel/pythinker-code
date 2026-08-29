// apps/pythinker-web/src/composables/usePageTitle.ts
// Static page title (app name only). The session title and workspace name are
// intentionally excluded so the tab title stays stable.
// Prefix the shared Braille mark when the agent is running.

import { computed, watchEffect, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { BRAILLE_SPINNER_FRAMES } from '../lib/brailleSpinner';

export interface UsePageTitleOptions {
  running: Ref<boolean>;
  showAuthGate: Ref<boolean>;
}

export function usePageTitle({ running, showAuthGate }: UsePageTitleOptions): void {
  const { t } = useI18n();
  const pageTitle = computed<string>(() => {
    const prefix = running.value ? `${BRAILLE_SPINNER_FRAMES[0]} ` : '';
    if (showAuthGate.value) return `${prefix}${t('app.authPageTitle')} - Pythinker Code Web`;
    return `${prefix}Pythinker Code Web`;
  });
  watchEffect(() => {
    if (typeof document !== 'undefined') document.title = pageTitle.value;
  });
}
