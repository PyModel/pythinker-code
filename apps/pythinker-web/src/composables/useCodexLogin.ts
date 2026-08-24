// apps/pythinker-web/src/composables/useCodexLogin.ts
// Drives the browser side of an OpenAI Codex sign-in: open the authorize URL,
// poll the server until it has written the credentials, and offer the paste
// fallback when the loopback callback cannot reach this machine.

import { computed, onUnmounted, readonly, ref, type Ref } from 'vue';

import { getPythinkerWebApi } from '../api';
import type { CodexLoginStatus } from '../api/types';

/** The server owns the timeout; this only decides how fast the UI reacts. */
const POLL_INTERVAL_MS = 2000;

/** Where a sign-in attempt currently stands.
 *
 *  One value rather than several booleans, so a view renders the phase it is
 *  told about instead of re-deriving it. The distinction that matters is
 *  between `completed` on the wire and `connected` here: OAuth succeeding and
 *  Pythinker having a model it can actually run a turn with are not the same
 *  fact, and only the second one is worth advancing a setup flow on. */
export type CodexLoginPhase =
  | 'idle'
  | 'starting'
  | 'waiting_for_browser'
  | 'waiting_for_code'
  | 'exchanging'
  | 'loading_models'
  | 'connected'
  | 'failed'
  | 'cancelled';

/** Resolves once the credential is written: reconcile runtime state, then
 *  report whether a usable model actually came out of it. */
export type CodexLoginReconcile = () => Promise<boolean> | boolean;

export interface UseCodexLogin {
  readonly phase: Readonly<Ref<CodexLoginPhase>>;
  /** True while an action is in flight and the UI should not accept another. */
  readonly busy: Readonly<Ref<boolean>>;
  /** Set once a login is in flight and the browser tab has been opened. */
  readonly loginId: Readonly<Ref<string | undefined>>;
  readonly authorizeUrl: Readonly<Ref<string | undefined>>;
  readonly popupBlocked: Readonly<Ref<boolean>>;
  /** `false` when the callback cannot reach the server automatically. */
  readonly loopback: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string>>;
  start(): Promise<void>;
  submitRedirect(redirectUrl: string): Promise<void>;
  cancel(): Promise<void>;
}

export function useCodexLogin(reconcile?: CodexLoginReconcile): UseCodexLogin {
  const phase = ref<CodexLoginPhase>('idle');
  const loginId = ref<string | undefined>(undefined);
  const authorizeUrl = ref<string | undefined>(undefined);
  const popupBlocked = ref(false);
  const loopback = ref(true);
  const errorMessage = ref('');
  const busy = computed(
    () => phase.value === 'starting' || phase.value === 'exchanging' || phase.value === 'loading_models',
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  let activePopup: Window | undefined;
  let disposed = false;

  /** The server keeps reporting `pending` across every phase where we are
   *  still waiting on the browser, so "is this attempt live?" is a local
   *  question, not one the wire state can answer. */
  function isAwaitingBrowser(): boolean {
    return phase.value === 'waiting_for_browser' || phase.value === 'waiting_for_code';
  }

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

  function fail(message: string): void {
    if (disposed) return;
    errorMessage.value = message;
    phase.value = 'failed';
    stopPolling();
    closePopup();
    clearAttempt();
  }

  async function settle(id: string, status: Readonly<CodexLoginStatus>): Promise<void> {
    if (disposed || loginId.value !== id) return;
    if (!isAwaitingBrowser() && phase.value !== 'exchanging') return;
    if (status.state === 'pending') return;
    stopPolling();
    if (status.state === 'failed') {
      fail(status.message ?? '');
      return;
    }
    if (status.state === 'cancelled') {
      phase.value = 'cancelled';
      closePopup();
      clearAttempt();
      return;
    }
    activePopup = undefined;
    // Credentials are written, but the provider is not usable until its models
    // have been discovered — advancing here would hand the caller a signed-in
    // account with nothing to run.
    phase.value = 'loading_models';
    let usable = true;
    try {
      usable = (await reconcile?.()) ?? true;
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      clearAttempt();
    }
    if (disposed) return;
    if (usable) phase.value = 'connected';
    else fail('');
  }

  async function poll(): Promise<void> {
    if (disposed || !isAwaitingBrowser()) return;
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
    if (disposed || busy.value || isAwaitingBrowser()) return;
    phase.value = 'starting';
    errorMessage.value = '';
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

      if (popup !== null) {
        try {
          popup.location.href = started.authorizeUrl;
        } catch {
          closePopup();
          popupBlocked.value = true;
        }
      }

      // Without a loopback callback the browser cannot report back on its own,
      // so pasting the redirect URL is the expected path, not a fallback. A
      // blocked popup does not change that: the callback still reaches the
      // server once the link is opened by hand.
      phase.value = started.loopback ? 'waiting_for_browser' : 'waiting_for_code';

      stopPolling();
      timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    } catch (error) {
      closePopup();
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  async function submitRedirect(redirectUrl: string): Promise<void> {
    const id = loginId.value;
    if (disposed || busy.value || !isAwaitingBrowser() || id === undefined) return;
    const resume = phase.value;
    phase.value = 'exchanging';
    errorMessage.value = '';
    try {
      await settle(id, await getPythinkerWebApi().submitCodexLoginRedirect(id, redirectUrl));
      // A rejected code leaves the attempt alive — return to waiting so the
      // user can paste a corrected URL instead of starting over.
      if (!disposed && phase.value === 'exchanging') phase.value = resume;
    } catch (error) {
      if (!disposed) {
        errorMessage.value = error instanceof Error ? error.message : String(error);
        phase.value = resume;
      }
    }
  }

  async function cancel(): Promise<void> {
    const id = loginId.value;
    stopPolling();
    closePopup();
    clearAttempt();
    phase.value = 'cancelled';
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
    if (id !== undefined && isAwaitingBrowser()) {
      void getPythinkerWebApi().cancelCodexLogin(id).catch(() => {});
    }
  });

  return {
    phase: readonly(phase),
    busy,
    loginId: readonly(loginId),
    authorizeUrl: readonly(authorizeUrl),
    popupBlocked: readonly(popupBlocked),
    loopback: readonly(loopback),
    error: readonly(errorMessage),
    start,
    submitRedirect,
    cancel,
  };
}
