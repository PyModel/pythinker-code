import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaemonHttpClient } from '../src/api/daemon/http';

describe('DaemonHttpClient request cancellation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('combines caller cancellation with the request timeout signal', async () => {
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      }),
    );
    const controller = new AbortController();
    const client = new DaemonHttpClient('http://127.0.0.1:58627');
    const request = client.get('/test', undefined, { signal: controller.signal });
    const rejection = expect(request).rejects.toMatchObject({
      name: 'DaemonNetworkError',
      cause: expect.objectContaining({ name: 'AbortError' }),
    });

    await vi.waitFor(() => {
      expect(requestSignal).toBeDefined();
    });
    controller.abort();

    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('preserves the timeout when AbortSignal.any is unavailable', async () => {
    const timeoutController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
      throw new TypeError('AbortSignal.any unavailable');
    });
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('Timed out', 'TimeoutError'));
            },
            { once: true },
          );
        });
      }),
    );
    const caller = new AbortController();
    const client = new DaemonHttpClient('http://127.0.0.1:58627');
    const request = client.get('/test', undefined, { signal: caller.signal });
    const rejection = expect(request).rejects.toMatchObject({
      name: 'DaemonNetworkError',
      cause: expect.objectContaining({ name: 'TimeoutError' }),
    });

    await vi.waitFor(() => {
      expect(requestSignal).toBeDefined();
    });
    timeoutController.abort(new DOMException('Timed out', 'TimeoutError'));

    expect(requestSignal?.aborted).toBe(true);
    await rejection;
  });
});
