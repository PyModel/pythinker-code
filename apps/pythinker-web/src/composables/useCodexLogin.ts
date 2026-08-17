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
  /** `false` when the user has to paste the redirect URL back. */
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
  const loopback = ref(true);
  const state = ref<CodexLoginStatus['state'] | undefined>(undefined);
  const errorMessage = ref('');
  let timer: ReturnType<typeof setInterval> | undefined;

  function stopPolling(): void {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }

  async function settle(status: CodexLoginStatus): Promise<void> {
    state.value = status.state;
    if (status.state === 'pending') return;
    stopPolling();
    if (status.state === 'failed') {
      errorMessage.value = status.message ?? '';
      return;
    }
    if (status.state === 'completed') {
      await onCompleted?.();
    }
  }

  async function poll(): Promise<void> {
    const id = loginId.value;
    if (id === undefined) return;
    try {
      await settle(await getPythinkerWebApi().getCodexLoginStatus(id));
    } catch {
      // A single failed poll says nothing — the next tick tries again. Only a
      // reported `failed` state ends the login.
    }
  }

  async function start(): Promise<void> {
    busy.value = true;
    errorMessage.value = '';
    try {
      const started = await getPythinkerWebApi().startCodexLogin();
      loginId.value = started.loginId;
      loopback.value = started.loopback;
      state.value = 'pending';
      // Opened from the click handler's task, so the popup blocker allows it.
      window.open(started.authorizeUrl, '_blank', 'noopener,noreferrer');
      stopPolling();
      timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      state.value = 'failed';
    } finally {
      busy.value = false;
    }
  }

  async function submitRedirect(redirectUrl: string): Promise<void> {
    const id = loginId.value;
    if (id === undefined) return;
    busy.value = true;
    errorMessage.value = '';
    try {
      await settle(await getPythinkerWebApi().submitCodexLoginRedirect(id, redirectUrl));
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
    } finally {
      busy.value = false;
    }
  }

  async function cancel(): Promise<void> {
    const id = loginId.value;
    stopPolling();
    loginId.value = undefined;
    state.value = undefined;
    errorMessage.value = '';
    if (id === undefined) return;
    try {
      await getPythinkerWebApi().cancelCodexLogin(id);
    } catch {
      // The attempt expires on the server anyway.
    }
  }

  onUnmounted(stopPolling);

  return {
    busy: readonly(busy),
    loginId: readonly(loginId),
    loopback: readonly(loopback),
    state: readonly(state),
    error: readonly(errorMessage),
    start,
    submitRedirect,
    cancel,
  };
}
