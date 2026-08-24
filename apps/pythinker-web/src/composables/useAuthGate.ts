// apps/pythinker-web/src/composables/useAuthGate.ts
// Keeps the browser URL honest about which top-level surface is showing. While
// the window is owned by first-run setup or by recovery rather than the app
// itself, the address bar reads /login, and the path the user arrived on is
// restored once they reach the app.

import { computed, ref, watch } from 'vue';
import type { usePythinkerWebClient } from './usePythinkerWebClient';

type PythinkerWebClient = ReturnType<typeof usePythinkerWebClient>;

export interface UseAuthGateOptions {
  client: PythinkerWebClient;
}

export function useAuthGate({ client }: UseAuthGateOptions) {
  const showAuthGate = computed(
    () => client.appState.value === 'first-run' || client.appState.value === 'recovery',
  );
  const LOGIN_PATH = '/login';
  const authReturnPath = ref<string | null>(null);

  function currentPathWithSuffix(): string {
    if (typeof window === 'undefined') return '/';
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function replaceBrowserPath(path: string): void {
    if (typeof window === 'undefined') return;
    window.history.replaceState(window.history.state, '', path);
  }

  watch(showAuthGate, (show) => {
    if (typeof window === 'undefined') return;
    if (show) {
      if (window.location.pathname !== LOGIN_PATH) {
        authReturnPath.value = currentPathWithSuffix();
        replaceBrowserPath(LOGIN_PATH);
      }
      return;
    }
    if (window.location.pathname === LOGIN_PATH) {
      replaceBrowserPath(authReturnPath.value ?? '/');
      authReturnPath.value = null;
    }
  }, { immediate: true });

  return { showAuthGate };
}
