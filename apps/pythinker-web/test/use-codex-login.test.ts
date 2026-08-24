import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';

import { useCodexLogin, type UseCodexLogin } from '../src/composables/useCodexLogin';

const mockApi = vi.hoisted(() => ({
  startCodexLogin: vi.fn(),
  getCodexLoginStatus: vi.fn(),
  submitCodexLoginRedirect: vi.fn(),
  cancelCodexLogin: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getPythinkerWebApi: () => mockApi,
}));

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mountLogin(reconcile?: () => Promise<boolean> | boolean): {
  wrapper: VueWrapper;
  login: UseCodexLogin;
} {
  let login!: UseCodexLogin;
  const wrapper = mount(
    defineComponent({
      setup() {
        // Keep the composable inside a component so its unmount cleanup is active.
        login = useCodexLogin(reconcile);
        return () => null;
      },
    }),
  );
  return { wrapper, login };
}

function popupWindow(): Window & { close: ReturnType<typeof vi.fn> } {
  return {
    opener: window,
    location: { href: 'about:blank' },
    close: vi.fn(),
  } as unknown as Window & { close: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useCodexLogin', () => {
  it('polls immediately when the browser window regains focus', async () => {
    vi.useFakeTimers();
    mockApi.startCodexLogin.mockResolvedValue({
      loginId: 'login_focus',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?state=focus',
      loopback: true,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
    mockApi.getCodexLoginStatus.mockResolvedValue({ loginId: 'login_focus', state: 'pending' });
    mockApi.cancelCodexLogin.mockResolvedValue({ loginId: 'login_focus', state: 'cancelled' });
    vi.spyOn(window, 'open').mockReturnValue(popupWindow());
    const { wrapper, login } = mountLogin();

    await login.start();
    expect(mockApi.getCodexLoginStatus).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('focus'));
    await flushPromises();

    expect(mockApi.getCodexLoginStatus).toHaveBeenCalledOnce();
    expect(mockApi.getCodexLoginStatus).toHaveBeenCalledWith('login_focus');
    wrapper.unmount();
  });

  it('keeps the authorize URL available when the popup is blocked', async () => {
    const authorizeUrl = 'https://auth.openai.com/oauth/authorize?client_id=app_test&state=s';
    mockApi.startCodexLogin.mockResolvedValue({
      loginId: 'login_1',
      authorizeUrl,
      loopback: true,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
    mockApi.cancelCodexLogin.mockResolvedValue({ loginId: 'login_1', state: 'cancelled' });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { wrapper, login } = mountLogin();

    await login.start();

    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(login.authorizeUrl.value).toBe(authorizeUrl);
    expect(login.popupBlocked.value).toBe(true);
    expect(login.phase.value).toBe('waiting_for_browser');

    wrapper.unmount();
    expect(mockApi.cancelCodexLogin).toHaveBeenCalledWith('login_1');
  });

  it('does not start a second login while the first request is pending', async () => {
    let resolveStart!: (value: Readonly<{
      loginId: string;
      authorizeUrl: string;
      loopback: boolean;
      expiresAt: string;
    }>) => void;
    mockApi.startCodexLogin.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );
    const popup = popupWindow();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const { wrapper, login } = mountLogin();

    const first = login.start();
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    await flushPromises();
    await login.start();

    expect(mockApi.startCodexLogin).toHaveBeenCalledTimes(1);

    resolveStart({
      loginId: 'login_2',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?client_id=app_test&state=t',
      loopback: false,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
    await first;
    // loopback: false — the callback cannot reach this machine, so pasting the
    // redirect URL is the expected path rather than waiting on the browser.
    expect(login.phase.value).toBe('waiting_for_code');
    expect(popup.location.href).toContain('state=t');

    await login.cancel();
    expect(popup.close).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('closes the blank popup when the start request fails', async () => {
    const popup = popupWindow();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    mockApi.startCodexLogin.mockRejectedValue(new Error('daemon unavailable'));
    const { wrapper, login } = mountLogin();

    await login.start();

    expect(popup.close).toHaveBeenCalledOnce();
    expect(login.phase.value).toBe('failed');
    expect(login.error.value).toBe('daemon unavailable');
    wrapper.unmount();
  });

  it('closes a blank popup when the composable is disposed during start', async () => {
    let resolveStart!: (value: Readonly<{
      loginId: string;
      authorizeUrl: string;
      loopback: boolean;
      expiresAt: string;
    }>) => void;
    mockApi.startCodexLogin.mockReturnValue(new Promise((resolve) => {
      resolveStart = resolve;
    }));
    mockApi.cancelCodexLogin.mockResolvedValue({ loginId: 'login_disposed', state: 'cancelled' });
    const popup = popupWindow();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { wrapper, login } = mountLogin();

    const start = login.start();
    wrapper.unmount();
    resolveStart({
      loginId: 'login_disposed',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?state=disposed',
      loopback: true,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
    await start;

    expect(popup.close).toHaveBeenCalledOnce();
    expect(mockApi.cancelCodexLogin).toHaveBeenCalledWith('login_disposed');
  });

  async function completeVia(
    login: UseCodexLogin,
    reconcile: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    mockApi.submitCodexLoginRedirect.mockResolvedValue({ loginId: 'login_ok', state: 'completed' });
    await login.start();
    await login.submitRedirect('http://localhost:1455/auth/callback?code=c&state=v');
    expect(reconcile).toHaveBeenCalledOnce();
  }

  it('reaches connected only once a usable model exists', async () => {
    mockApi.startCodexLogin.mockResolvedValue({
      loginId: 'login_ok',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?state=v',
      loopback: false,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
    vi.spyOn(window, 'open').mockReturnValue(popupWindow());
    const reconcile = vi.fn().mockResolvedValue(true);
    const { wrapper, login } = mountLogin(reconcile);

    await completeVia(login, reconcile);

    expect(login.phase.value).toBe('connected');
    wrapper.unmount();
  });

  it('does not report connected when the sign-in yields no usable model', async () => {
    mockApi.startCodexLogin.mockResolvedValue({
      loginId: 'login_ok',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?state=v',
      loopback: false,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
    vi.spyOn(window, 'open').mockReturnValue(popupWindow());
    // OAuth succeeded but model discovery produced nothing runnable — the
    // caller must not be told it can go ahead.
    const reconcile = vi.fn().mockResolvedValue(false);
    const { wrapper, login } = mountLogin(reconcile);

    await completeVia(login, reconcile);

    expect(login.phase.value).toBe('failed');
    wrapper.unmount();
  });

  it('reports a server-cancelled attempt as cancelled, without reconciling', async () => {
    mockApi.startCodexLogin.mockResolvedValue({
      loginId: 'login_ok',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?state=v',
      loopback: false,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
    vi.spyOn(window, 'open').mockReturnValue(popupWindow());
    const reconcile = vi.fn().mockResolvedValue(true);
    const { wrapper, login } = mountLogin(reconcile);

    mockApi.submitCodexLoginRedirect.mockResolvedValue({ loginId: 'login_ok', state: 'cancelled' });
    await login.start();
    await login.submitRedirect('http://localhost:1455/auth/callback?code=c&state=v');

    expect(reconcile).not.toHaveBeenCalled();
    expect(login.phase.value).toBe('cancelled');
    wrapper.unmount();
  });

  it('ignores a redirect result that arrives after cancellation', async () => {
    mockApi.startCodexLogin.mockResolvedValue({
      loginId: 'login_3',
      authorizeUrl: 'https://auth.openai.com/oauth/authorize?client_id=app_test&state=u',
      loopback: false,
      expiresAt: '2026-08-17T00:10:00.000Z',
    });
    mockApi.cancelCodexLogin.mockResolvedValue({ loginId: 'login_3', state: 'cancelled' });
    let resolveSubmit!: (value: Readonly<{ loginId: string; state: 'completed' }>) => void;
    mockApi.submitCodexLoginRedirect.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const popup = popupWindow();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const { wrapper, login } = mountLogin();

    await login.start();
    const submit = login.submitRedirect('http://localhost:1455/auth/callback?code=c&state=u');
    await flushPromises();
    await login.cancel();

    resolveSubmit({ loginId: 'login_3', state: 'completed' });
    await submit;

    expect(login.phase.value).toBe('cancelled');
    expect(mockApi.cancelCodexLogin).toHaveBeenCalledWith('login_3');
    expect(popup.close).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
