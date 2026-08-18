// apps/pythinker-web/src/composables/usePageTitle.ts
// Static page title (app name only). The session title and workspace name are
// intentionally excluded so the tab title stays stable.
// Prefix the shared Braille mark when the agent is running.

import { computed, watchEffect, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';

const RUNNING_INDICATOR = '⣷';

export interface UsePageTitleOptions {
  running: Ref<boolean>;
  showAuthGate: Ref<boolean>;
}

export function usePageTitle({ running, showAuthGate }: UsePageTitleOptions): void {
  const { t } = useI18n();

  const pageTitle = computed<string>(() => {
    const prefix = running.value ? `${RUNNING_INDICATOR} ` : '';
    if (showAuthGate.value) return `${prefix}${t('app.authPageTitle')} - Pythinker Code Web`;
    return `${prefix}Pythinker Code Web`;
  });
  watchEffect(() => {
    if (typeof document !== 'undefined') document.title = pageTitle.value;
  });
}
