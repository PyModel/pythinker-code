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

function mountLogin(): { wrapper: VueWrapper; login: UseCodexLogin } {
  let login!: UseCodexLogin;
  const wrapper = mount(
    defineComponent({
      setup() {
        // Keep the composable inside a component so its unmount cleanup is active.
        login = useCodexLogin();
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
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('useCodexLogin', () => {
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
    expect(login.state.value).toBe('pending');

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
    expect(login.state.value).toBe('pending');
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
    expect(login.state.value).toBe('failed');
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

    expect(login.state.value).toBeUndefined();
    expect(mockApi.cancelCodexLogin).toHaveBeenCalledWith('login_3');
    expect(popup.close).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
