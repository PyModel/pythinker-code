// apps/pythinker-web/src/composables/useCodexLogin.ts
// Drives the browser side of an OpenAI Codex sign-in: open the authorize URL,
// poll the server until it has written the credentials, and offer the paste
// fallback when the loopback callback cannot reach this machine.

import { onUnmounted, readonly, ref, type Ref } from 'vue';

import { getPythinkerWebApi } from '../api';
import type { CodexLoginStatus } from '../api/types';

/** The server owns the timeout; this only decides how fast the UI reacts. */
const POLL_INTERVAL_MS = 2000;

export interface UseCodexLogin {
  readonly busy: Readonly<Ref<boolean>>;
  /** Set once a login is in flight and the browser tab has been opened. */
  readonly loginId: Readonly<Ref<string | undefined>>;
  readonly authorizeUrl: Readonly<Ref<string | undefined>>;
  readonly popupBlocked: Readonly<Ref<boolean>>;
  /** `false` when the callback cannot reach the server automatically. */
  readonly loopback: Readonly<Ref<boolean>>;
  readonly state: Readonly<Ref<CodexLoginStatus['state'] | undefined>>;
  readonly error: Readonly<Ref<string>>;
  start(): Promise<void>;
  submitRedirect(redirectUrl: string): Promise<void>;
  cancel(): Promise<void>;
}

export function useCodexLogin(onCompleted?: () => void | Promise<void>): UseCodexLogin {
  const busy = ref(false);
  const loginId = ref<string | undefined>(undefined);
  const authorizeUrl = ref<string | undefined>(undefined);
  const popupBlocked = ref(false);
  const loopback = ref(true);
  const state = ref<CodexLoginStatus['state'] | undefined>(undefined);
  const errorMessage = ref('');
  let timer: ReturnType<typeof setInterval> | undefined;
  let activePopup: Window | undefined;
  let disposed = false;

  function stopPolling(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  function clearAttempt(): void {
    loginId.value = undefined;
    authorizeUrl.value = undefined;
    popupBlocked.value = false;
  }

  function closePopup(): void {
    activePopup?.close();
    activePopup = undefined;
  }

  async function settle(id: string, status: Readonly<CodexLoginStatus>): Promise<void> {
    if (disposed || loginId.value !== id || state.value !== 'pending') return;
    state.value = status.state;
    if (status.state === 'pending') return;
    stopPolling();
    if (status.state === 'failed') {
      errorMessage.value = status.message ?? '';
      closePopup();
      clearAttempt();
      return;
    }
    if (status.state === 'completed') {
      activePopup = undefined;
      try {
        await onCompleted?.();
      } finally {
        clearAttempt();
      }
    }
  }

  async function poll(): Promise<void> {
    if (disposed || state.value !== 'pending') return;
    const id = loginId.value;
    if (id === undefined) return;
    try {
      await settle(id, await getPythinkerWebApi().getCodexLoginStatus(id));
    } catch {
      // A single failed poll says nothing — the next tick tries again. Only a
      // reported `failed` state ends the login.
    }
  }

  async function start(): Promise<void> {
    if (disposed || busy.value || state.value === 'pending') return;
    busy.value = true;
    errorMessage.value = '';
    state.value = undefined;
    clearAttempt();
    let popup: Window | null = null;
    try {
      popup = typeof window === 'undefined' ? null : window.open('about:blank', '_blank');
      if (popup !== null) {
        popup.opener = null;
        activePopup = popup;
      }
    } catch {
      popup?.close();
      popup = null;
    }
    popupBlocked.value = popup === null;
    try {
      const api = getPythinkerWebApi();
      const started = await api.startCodexLogin();
      if (disposed) {
        closePopup();
        void api.cancelCodexLogin(started.loginId).catch(() => {});
        return;
      }
      loginId.value = started.loginId;
      authorizeUrl.value = started.authorizeUrl;
      loopback.value = started.loopback;
      state.value = 'pending';

      if (popup !== null) {
        try {
          popup.location.href = started.authorizeUrl;
        } catch {
          closePopup();
          popupBlocked.value = true;
        }
      }

      stopPolling();
      timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    } catch (error) {
      closePopup();
      if (!disposed) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
        state.value = 'failed';
      }
    } finally {
      busy.value = false;
    }
  }

  async function submitRedirect(redirectUrl: string): Promise<void> {
    const id = loginId.value;
    if (disposed || busy.value || state.value !== 'pending' || id === undefined) return;
    busy.value = true;
    errorMessage.value = '';
    try {
      await settle(id, await getPythinkerWebApi().submitCodexLoginRedirect(id, redirectUrl));
    } catch (error) {
      if (!disposed) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
      }
    } finally {
      busy.value = false;
    }
  }

  async function cancel(): Promise<void> {
    const id = loginId.value;
    stopPolling();
    closePopup();
    clearAttempt();
    state.value = undefined;
    errorMessage.value = '';
    if (id === undefined) return;
    try {
      await getPythinkerWebApi().cancelCodexLogin(id);
    } catch {
      // The attempt expires on the server anyway.
    }
  }

  onUnmounted(() => {
    disposed = true;
    stopPolling();
    closePopup();
    const id = loginId.value;
    if (id !== undefined && state.value === 'pending') {
      void getPythinkerWebApi().cancelCodexLogin(id).catch(() => {});
    }
  });

  return {
    busy: readonly(busy),
    loginId: readonly(loginId),
    authorizeUrl: readonly(authorizeUrl),
    popupBlocked: readonly(popupBlocked),
    loopback: readonly(loopback),
    state: readonly(state),
    error: readonly(errorMessage),
    start,
    submitRedirect,
    cancel,
  };
}
