/**
 * Covers: LocalFetchURLProvider content-kind reporting, SSRF guard, redirect handling,
 * and connection pinning.
 *
 * Verifies the provider tells callers whether the returned content is a
 * verbatim passthrough of the response body or the main text extracted
 * from an HTML page.
 */

import { lookup } from 'node:dns/promises';

import { Agent } from 'undici';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LocalFetchURLProvider } from '../../../src/tools/providers/local-fetch-url';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

const lookupMock = lookup as unknown as Mock;

function asUndiciAgent(dispatcher: RequestInit['dispatcher']): Agent {
  return dispatcher as unknown as Agent;
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  for (const key of ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY']) {
    vi.stubEnv(key, '');
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function htmlResponse(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('LocalFetchURLProvider content kind', () => {
  it('reuses successful responses for 15 minutes and refreshes expired entries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => htmlResponse('cached body', 'text/plain'));
    const provider = new LocalFetchURLProvider({ fetchImpl });
    const url = 'https://example.com/cached.txt';

    await provider.fetch(url);
    await provider.fetch(url);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-01-01T00:15:00.001Z'));
    await provider.fetch(url);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports text/plain bodies as a verbatim passthrough', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(htmlResponse('plain body', 'text/plain; charset=utf-8'));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    const result = await provider.fetch('https://example.com/file.txt');

    expect(result).toEqual({ content: 'plain body', kind: 'passthrough' });
  });

  it('reports text/markdown bodies as a verbatim passthrough', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(htmlResponse('# Title\n\nbody', 'text/markdown'));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    const result = await provider.fetch('https://example.com/readme.md');

    expect(result).toEqual({ content: '# Title\n\nbody', kind: 'passthrough' });
  });

  it('keeps structured application content as text', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(htmlResponse('{"ok":true}', 'application/json'));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/data.json')).resolves.toEqual({
      content: '{"ok":true}',
      kind: 'passthrough',
    });
  });

  it('reports HTML bodies as extracted main content', async () => {
    const html =
      '<html><head><title>Doc</title></head><body><article>' +
      '<p>The quick brown fox jumps over the lazy dog. '.repeat(20) +
      '</p></article></body></html>';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(htmlResponse(html, 'text/html; charset=utf-8'));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    const result = await provider.fetch('https://example.com/page');

    expect(result.kind).toBe('extracted');
    if (result.kind !== 'extracted') throw new Error('expected extracted content');
    expect(result.content).toContain('quick brown fox');
  });

  it('returns binary responses without decoding their bytes as text', async () => {
    const bytes = Buffer.from('%PDF-\0binary', 'binary');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/report.pdf')).resolves.toEqual({
      kind: 'binary',
      data: bytes,
      contentType: 'application/pdf',
    });
  });
});

describe('LocalFetchURLProvider SSRF guard', () => {
  it('rejects private literals and localhost without network access', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('http://127.0.0.1/')).rejects.toThrow('private address');
    await expect(provider.fetch('http://[::ffff:127.0.0.1]/')).rejects.toThrow('private address');
    await expect(provider.fetch('http://ev1l.localhost/')).rejects.toThrow('private host');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a hostname when any DNS answer is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/')).rejects.toThrow(
      'resolves to private address',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects IPv4-mapped IPv6 DNS answers', async () => {
    lookupMock.mockResolvedValue([{ address: '::ffff:169.254.169.254', family: 6 }]);
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.test/')).rejects.toThrow(
      'resolves to private address',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when DNS resolution fails', async () => {
    lookupMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND example.test'));
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.test/')).rejects.toThrow('Cannot resolve host');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips safety resolution when private addresses are explicitly allowed', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(htmlResponse('local', 'text/plain'));
    const provider = new LocalFetchURLProvider({ fetchImpl, allowPrivateAddresses: true });

    await expect(provider.fetch('http://127.0.0.1/')).resolves.toMatchObject({ content: 'local' });
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('LocalFetchURLProvider redirects', () => {
  it('revalidates each redirect and resolves relative locations', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/final' } }))
      .mockResolvedValueOnce(htmlResponse('done', 'text/plain'));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/start')).resolves.toMatchObject({
      content: 'done',
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://example.com/final');
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it('refuses a redirect to a private target', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      }),
    );
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/')).rejects.toThrow('private address');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect whose hostname resolves to a private address', async () => {
    lookupMock.mockImplementation(async (host: string) =>
      host === 'internal.example.test'
        ? [{ address: '10.0.0.7', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }],
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://internal.example.test/' },
      }),
    );
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/')).rejects.toThrow(
      'resolves to private address',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns a cross-host redirect for a new approval instead of following it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://other.example/final' },
      }),
    );
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/start')).resolves.toEqual({
      kind: 'redirect',
      originalUrl: 'https://example.com/start',
      redirectUrl: 'https://other.example/final',
      status: 302,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('stops after the redirect limit', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: '/loop' } }));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/loop')).rejects.toThrow('Too many redirects');
    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });
});

describe('LocalFetchURLProvider connection pinning', () => {
  it('pins each public-host request to the validated DNS answer and closes the agent', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(htmlResponse('ok', 'text/plain'));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await provider.fetch('https://example.com/');

    const dispatcher = (fetchImpl.mock.calls[0]?.[1] as RequestInit).dispatcher;
    expect(dispatcher).toBeInstanceOf(Agent);
    expect(asUndiciAgent(dispatcher).closed).toBe(true);
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('does not install a direct dispatcher when a proxy applies', async () => {
    vi.stubEnv('https_proxy', 'http://proxy.example:8080');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(htmlResponse('ok', 'text/plain'));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await provider.fetch('https://example.com/');

    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).dispatcher).toBeUndefined();
  });

  it('still pins when NO_PROXY exempts the target', async () => {
    vi.stubEnv('https_proxy', 'http://proxy.example:8080');
    vi.stubEnv('no_proxy', 'example.com');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(htmlResponse('ok', 'text/plain'));
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await provider.fetch('https://example.com/');

    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).dispatcher).toBeInstanceOf(Agent);
  });

  it('closes the pinned agent when content-length exceeds the limit', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('short', {
        headers: {
          'content-type': 'text/plain',
          'content-length': String(11 * 1024 * 1024),
        },
      }),
    );
    const provider = new LocalFetchURLProvider({ fetchImpl });

    await expect(provider.fetch('https://example.com/big')).rejects.toThrow(
      'Response body too large',
    );
    const dispatcher = (fetchImpl.mock.calls[0]?.[1] as RequestInit).dispatcher;
    expect(asUndiciAgent(dispatcher).closed).toBe(true);
  });
});
