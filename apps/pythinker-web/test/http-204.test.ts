import { afterEach, describe, expect, it, vi } from 'vitest';
import { DaemonHttpClient } from '../src/api/daemon/http';

describe('DaemonHttpClient empty responses', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('resolves a 204 with no body instead of failing to parse JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const client = new DaemonHttpClient('http://127.0.0.1:58627');
    await expect(client.delete(`/providers/glm`)).resolves.toBeNull();
  });

  it('still rejects a non-204 empty body as a parse failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );
    const client = new DaemonHttpClient('http://127.0.0.1:58627');
    await expect(client.delete('/providers/glm')).rejects.toMatchObject({
      name: 'DaemonNetworkError',
      phase: 'parse',
    });
  });
});
