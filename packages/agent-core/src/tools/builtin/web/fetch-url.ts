/**
 * FetchURLTool — host-injected URL fetcher.
 *
 * pythinker-core defines the interface; the host provides the real fetch
 * implementation via `UrlFetcher`. If no fetcher is supplied, the tool
 * should not be registered (not exposed to the LLM).
 */

import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';

import type { Kaos } from '@pymodel/kaos';
import { z } from 'zod';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { extensionForMimeType } from '../../support/file-type';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '../../support/rule-match';
import { ToolResultBuilder } from '../../support/result-builder';
import DESCRIPTION from './fetch-url.md?raw';

// ── Provider interface (host-injected) ───────────────────────────────

/**
 * How the returned content relates to the original response body.
 *
 * - `passthrough` — the body was already plain text / markdown and is
 *   returned verbatim, in full.
 * - `extracted` — the body was an HTML page; only the main article text
 *   was extracted and returned.
 */
export type UrlFetchKind = 'passthrough' | 'extracted';

export interface UrlFetchContent {
  /** The text handed to the LLM. */
  content: string;
  /** Whether `content` is a verbatim passthrough or extracted main text. */
  kind: UrlFetchKind;
}

export interface UrlFetchRedirect {
  readonly kind: 'redirect';
  readonly originalUrl: string;
  readonly redirectUrl: string;
  readonly status: number;
}

export interface UrlFetchBinary {
  readonly kind: 'binary';
  readonly data: Buffer;
  readonly contentType: string;
}

export type UrlFetchResult = UrlFetchContent | UrlFetchRedirect | UrlFetchBinary;

export interface UrlFetcher {
  fetch(
    url: string,
    options?: { toolCallId?: string; signal?: AbortSignal },
  ): Promise<UrlFetchResult>;
}

/**
 * Thrown by a `UrlFetcher` when the upstream HTTP request completed but
 * returned a non-success status. The tool branches on this to surface
 * `Status: N` in the error message; non-HTTP failures (DNS, timeout,
 * connection reset, …) keep flowing through as plain `Error`.
 */
export class HttpFetchError extends Error {
  override readonly name = 'HttpFetchError';
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ── Input schema ─────────────────────────────────────────────────────

export const FetchURLInputSchema = z
  .object({
    url: z.string().url().describe('The URL to fetch content from.'),
  })
  .strict();

export type FetchURLInput = z.Infer<typeof FetchURLInputSchema>;

// ── Implementation ───────────────────────────────────────────────────

export class FetchURLTool implements BuiltinTool<FetchURLInput> {
  readonly name = 'FetchURL' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(FetchURLInputSchema);
  constructor(
    private readonly fetcher: UrlFetcher,
    private readonly kaos?: Kaos,
  ) {}

  resolveExecution(args: FetchURLInput): ToolExecution {
    const preview = args.url.length > 50 ? `${args.url.slice(0, 50)}…` : args.url;
    const ruleSubject = urlHostname(args.url) ?? args.url;
    return {
      accesses: ToolAccesses.none(),
      description: `Fetching: ${preview}`,
      display: { kind: 'url_fetch', url: args.url },
      approvalRule: literalRulePattern(this.name, ruleSubject),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, ruleSubject),
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: FetchURLInput,
    { signal, toolCallId }: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      const fetched = await this.fetcher.fetch(args.url, { signal, toolCallId });
      if (fetched.kind === 'redirect') {
        return new ToolResultBuilder().ok(
          `REDIRECT DETECTED: ${fetched.originalUrl} redirects to ${fetched.redirectUrl} ` +
            `(HTTP ${String(fetched.status)}). To approve the new host, use FetchURL again ` +
            `with url: "${fetched.redirectUrl}".`,
        );
      }
      if (fetched.kind === 'binary') {
        return await this.saveBinary(fetched);
      }
      const { content, kind } = fetched;

      if (!content) {
        return {
          output: 'The response body is empty.',
          isError: false,
        };
      }

      const builder = new ToolResultBuilder({ maxLineLength: null });
      builder.write(content);
      // Tell the LLM whether it received the whole body or only the
      // extracted article text, so it can judge how complete the
      // content is.
      const message =
        kind === 'passthrough'
          ? 'The returned content is the full response body, returned verbatim.'
          : 'The returned content is the main text extracted from the page.';
      return builder.ok(message);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof HttpFetchError) {
        return {
          isError: true,
          output: `Failed to fetch URL. Status: ${String(error.status)}. ${msg}`,
        };
      }
      return {
        isError: true,
        output: `Failed to fetch URL due to network error: ${args.url}. ${msg}`,
      };
    }
  }

  private async saveBinary(fetched: UrlFetchBinary): Promise<ExecutableToolResult> {
    if (this.kaos === undefined) {
      return {
        isError: true,
        output: 'Binary content could not be saved because no execution filesystem is available.',
      };
    }
    const paths = this.kaos.pathClass() === 'win32' ? win32 : posix;
    const directory = paths.join(this.kaos.gethome(), '.pythinker-code', 'tool-results');
    const filepath = paths.join(
      directory,
      `web-fetch-${randomUUID()}.${extensionForMimeType(fetched.contentType)}`,
    );
    try {
      await this.kaos.mkdir(directory, { parents: true, existOk: true });
      await this.kaos.writeBytes(filepath, fetched.data);
      return {
        isError: false,
        output: `Binary content (${fetched.contentType || 'unknown type'}, ${String(fetched.data.length)} bytes) saved to ${filepath}`,
      };
    } catch (error) {
      return {
        isError: true,
        output: `Binary content could not be saved to disk: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}

function urlHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
