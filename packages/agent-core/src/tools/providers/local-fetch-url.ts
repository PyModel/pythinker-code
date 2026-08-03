/**
 * LocalFetchURLProvider — host-side URL fetcher.
 *
 * Flow:
 *   1. Validate the URL against the SSRF rules (scheme, IP literals, DNS
 *      resolution) and GET it with a Chrome-like UA, following redirects
 *      manually with every hop re-validated and pinned to the validated
 *      addresses.
 *   2. Reject HTTP >= 400 with the status code in the message.
 *   3. Reject responses larger than `maxBytes` (content-length first,
 *      then measured body length as a defensive second check).
 *   4. `text/plain` / `text/markdown` → passthrough verbatim.
 *   5. Otherwise (assumed HTML) → run Readability over a linkedom
 *      document. Return `# ${title}\n\n${text}` (title omitted when
 *      absent). If extraction yields no meaningful text, fall back to
 *      common content containers (`<article>` / `<main>` / `<body>`)
 *      before throwing a "meaningful content" error.
 */

import { Readability } from '@mozilla/readability';
import { parseHTML as rawParseHTML } from 'linkedom';
import type { Dispatcher } from 'undici';

import {
  createPinnedHttpDispatcher,
  resolveSafeHttpTarget,
  type SafeHttpTarget,
} from '../../utils/safe-http';
import { HttpFetchError, type UrlFetcher, type UrlFetchResult } from '../builtin';
import { isBinaryContentType } from '../support/file-type';

// Readability's .d.ts references the global `Document` type, but this
// package compiles with `lib: ES2023` (no DOM). Extracting the
// constructor parameter type keeps us off the global `Document` name
// while still accepting whatever Readability wants.
type ReadabilityDocument = ConstructorParameters<typeof Readability>[0];

// linkedom's published types depend on DOM libs we don't load. Declare
// the minimal surface we actually use so the rest of the file stays
// type-safe without pulling lib.dom.d.ts into the host build.
interface DomElementLike {
  textContent: string | null;
  querySelector(selector: string): DomElementLike | null;
}
interface DomParseResult {
  document: DomElementLike;
}
const parseHTML = rawParseHTML as unknown as (html: string) => DomParseResult;

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 60_000;

const MAX_REDIRECT_HOPS = 10;

const CACHE_TTL_MS = 15 * 60 * 1000;

const MAX_CACHE_BYTES = 50 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface CachedFetchResult {
  readonly result: UrlFetchResult;
  readonly expiresAt: number;
  readonly bytes: number;
}

export interface LocalFetchURLProviderOptions {
  userAgent?: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  /**
   * Allow fetching loopback / RFC 1918 / link-local / ULA addresses.
   * Defaults to `false` — enabled only for tests and (future) explicit
   * opt-in. Keeps an LLM that's been prompt-injected from exfiltrating
   * AWS/GCP metadata (169.254.169.254), probing internal services
   * (10.x, 192.168.x), or reading local daemons (127.0.0.1:*).
   */
  allowPrivateAddresses?: boolean;
}

export class LocalFetchURLProvider implements UrlFetcher {
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly allowPrivateAddresses: boolean;
  private readonly cache = new Map<string, CachedFetchResult>();
  private cacheBytes = 0;

  constructor(options: LocalFetchURLProviderOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.allowPrivateAddresses = options.allowPrivateAddresses ?? false;
  }

  async fetch(
    url: string,
    options?: { toolCallId?: string; signal?: AbortSignal },
  ): Promise<UrlFetchResult> {
    options?.signal?.throwIfAborted();
    // Successful responses are cached per URL in-process with TTL + insertion-order eviction.
    const cached = this.cache.get(url);
    if (cached !== undefined) {
      if (cached.expiresAt > Date.now()) {
        this.cache.delete(url);
        this.cache.set(url, cached);
        return cached.result.kind === 'binary'
          ? { ...cached.result, data: Buffer.from(cached.result.data) }
          : { ...cached.result };
      }
      this.deleteCached(url, cached);
    }

    const dispatchers: Dispatcher[] = [];
    try {
      const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      const signal =
        options?.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);
      const response = await this.requestWithValidatedRedirects(url, dispatchers, signal);
      if (!(response instanceof Response)) return response;
      const result = await this.readResponse(response);
      this.cacheResult(url, result);
      return result;
    } finally {
      await Promise.all(
        dispatchers.map((dispatcher) =>
          dispatcher.close().catch(() => {
            /* already closed */
          }),
        ),
      );
    }
  }

  private cacheResult(url: string, result: UrlFetchResult): void {
    if (result.kind === 'redirect') return;
    const bytes = Math.max(
      1,
      result.kind === 'binary' ? result.data.length : Buffer.byteLength(result.content),
    );
    if (bytes > MAX_CACHE_BYTES) return;

    const previous = this.cache.get(url);
    if (previous !== undefined) this.deleteCached(url, previous);
    while (this.cacheBytes + bytes > MAX_CACHE_BYTES) {
      const oldestUrl = this.cache.keys().next().value as string | undefined;
      if (oldestUrl === undefined) break;
      this.deleteCached(oldestUrl, this.cache.get(oldestUrl)!);
    }
    this.cache.set(url, {
      result: result.kind === 'binary' ? { ...result, data: Buffer.from(result.data) } : { ...result },
      expiresAt: Date.now() + CACHE_TTL_MS,
      bytes,
    });
    this.cacheBytes += bytes;
  }

  private deleteCached(url: string, cached: CachedFetchResult): void {
    this.cache.delete(url);
    this.cacheBytes -= cached.bytes;
  }

  private async readResponse(response: Response): Promise<UrlFetchResult> {
    if (response.status >= 400) {
      // Drain the unused body so undici can release the socket back to
      // the keep-alive pool instead of leaking it on error paths.
      await response.body?.cancel().catch(() => {
        /* already closed */
      });
      throw new HttpFetchError(
        response.status,
        `HTTP ${String(response.status)} ${response.statusText}`,
      );
    }

    // Reject oversized responses before buffering the full body.
    const contentLengthRaw = response.headers.get('content-length');
    if (contentLengthRaw !== null) {
      const cl = Number(contentLengthRaw);
      if (Number.isFinite(cl) && cl > this.maxBytes) {
        await response.body?.cancel().catch(() => {
          /* already closed */
        });
        throw new Error(
          `Response body too large: ${String(cl)} bytes exceeds maxBytes (${String(this.maxBytes)}).`,
        );
      }
    }

    const body = Buffer.from(await response.arrayBuffer());

    // Servers may omit content-length — measure again defensively.
    const actualBytes = body.length;
    if (actualBytes > this.maxBytes) {
      throw new Error(
        `Response body too large: ${String(actualBytes)} bytes exceeds maxBytes (${String(this.maxBytes)}).`,
      );
    }

    const contentType = (response.headers.get('content-type') ?? '').trim();
    if (isBinaryContentType(contentType)) {
      return { kind: 'binary', data: body, contentType };
    }

    const content = body.toString('utf8');
    if (!contentType.toLowerCase().includes('text/html')) {
      return { content, kind: 'passthrough' };
    }
    return { content: this.extractMainContent(content), kind: 'extracted' };
  }

  private async requestWithValidatedRedirects(
    url: string,
    dispatchers: Dispatcher[],
    signal: AbortSignal,
  ): Promise<Response | UrlFetchResult> {
    let currentUrl = url;
    let redirects = 0;
    for (;;) {
      const target = await resolveSafeHttpTarget(currentUrl, this.allowPrivateAddresses);
      const response = await this.fetchImpl(currentUrl, {
        method: 'GET',
        headers: { 'User-Agent': this.userAgent },
        redirect: 'manual',
        signal,
        dispatcher: this.pinnedDispatcherFor(target, dispatchers) as unknown,
      } as RequestInit);
      if (!REDIRECT_STATUSES.has(response.status)) return response;
      const location = response.headers.get('location');
      if (location === null) return response;
      await response.body?.cancel().catch(() => {
        /* already closed */
      });
      if (redirects >= MAX_REDIRECT_HOPS) {
        throw new Error(
          `Too many redirects while fetching "${url}" (limit ${String(MAX_REDIRECT_HOPS)}).`,
        );
      }
      redirects += 1;
      const redirectUrl = new URL(location, currentUrl).toString();
      if (!isPermittedRedirect(currentUrl, redirectUrl)) {
        await resolveSafeHttpTarget(redirectUrl, this.allowPrivateAddresses);
        return {
          kind: 'redirect',
          originalUrl: currentUrl,
          redirectUrl,
          status: response.status,
        };
      }
      currentUrl = redirectUrl;
    }
  }

  private pinnedDispatcherFor(
    target: SafeHttpTarget,
    dispatchers: Dispatcher[],
  ): Dispatcher | undefined {
    const dispatcher = createPinnedHttpDispatcher(target);
    if (dispatcher !== undefined) dispatchers.push(dispatcher);
    return dispatcher;
  }

  private extractMainContent(html: string): string {
    // Readability mutates the DOM it parses, so parse twice — once for
    // the primary extractor and once for the fallback path.
    const primary = parseHTML(html);
    try {
      const reader = new Readability(primary.document as unknown as ReadabilityDocument, {
        charThreshold: 0,
      });
      const article = reader.parse();
      if (article !== null) {
        const text = (article.textContent ?? '').trim();
        if (text.length > 0) {
          const title = (article.title ?? '').trim();
          return title.length > 0 ? `# ${title}\n\n${text}` : text;
        }
      }
    } catch {
      // Fall through to the container-based fallback.
    }

    const { document } = parseHTML(html);
    const titleText = (document.querySelector('title')?.textContent ?? '').trim();
    const container =
      document.querySelector('article') ??
      document.querySelector('main') ??
      document.querySelector('body');
    const fallbackText = (container?.textContent ?? '').trim();

    if (fallbackText.length === 0) {
      throw new Error(
        'Failed to extract meaningful content from the page. The page may require JavaScript to render.',
      );
    }

    return titleText.length > 0 ? `# ${titleText}\n\n${fallbackText}` : fallbackText;
  }
}

function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  const original = new URL(originalUrl);
  const redirect = new URL(redirectUrl);
  const stripWww = (hostname: string): string => hostname.replace(/^www\./u, '');
  return (
    original.protocol === redirect.protocol &&
    original.port === redirect.port &&
    redirect.username === '' &&
    redirect.password === '' &&
    stripWww(original.hostname) === stripWww(redirect.hostname)
  );
}
