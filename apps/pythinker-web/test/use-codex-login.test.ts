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

    expect(open).toHaveBeenCalledWith(authorizeUrl, '_blank', 'noopener,noreferrer');
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
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { wrapper, login } = mountLogin();

    const first = login.start();
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

    await login.cancel();
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
    vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const { wrapper, login } = mountLogin();

    await login.start();
    const submit = login.submitRedirect('http://localhost:1455/auth/callback?code=c&state=u');
    await flushPromises();
    await login.cancel();

    resolveSubmit({ loginId: 'login_3', state: 'completed' });
    await submit;

    expect(login.state.value).toBeUndefined();
    expect(mockApi.cancelCodexLogin).toHaveBeenCalledWith('login_3');
    wrapper.unmount();
  });
});
