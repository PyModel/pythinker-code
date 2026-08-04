import { getCoreVersion } from '#/version';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  ElicitationCompleteNotificationSchema,
  ElicitRequestSchema,
  UrlElicitationRequiredError,
  type ElicitRequestParams,
  type ElicitResult,
} from '@modelcontextprotocol/sdk/types.js';

import type {
  MCPPromptDefinition,
  MCPPromptMessage,
  MCPResource,
  MCPResourceContent,
  MCPToolDefinition,
  MCPToolResult,
} from './types';

export const PYTHINKER_MCP_CLIENT_NAME = 'pythinker-code';
// Resolved from agent-core's package.json so MCP servers see the real version
// in `initialize` (used for compatibility checks, telemetry, debugging).
// `getCoreVersion()` falls back to '0.0.0' if the package.json read fails.
export const PYTHINKER_MCP_CLIENT_VERSION = getCoreVersion();

/**
 * Why-context attached when a runtime client notices its underlying transport
 * has gone away on its own — i.e. {@link RuntimeMcpClient.close} was NOT
 * called. The connection manager turns this into a `failed` status so the
 * UI/SDK do not keep advertising tools backed by a dead transport.
 *
 * - `error` is the last error reported via the SDK's `onerror` channel, if
 *   any. Useful for HTTP where there is no stderr.
 * - `stderr` is the tail of bytes captured from the child process's stderr;
 *   populated only for the stdio transport.
 */
export interface UnexpectedCloseReason {
  readonly error?: Error;
  readonly stderr?: string;
}

export type UnexpectedCloseListener = (reason: UnexpectedCloseReason) => void;

export interface McpRequestOptions {
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

interface McpUrlCompletionWaiter {
  readonly promise: Promise<void>;
  cancel(): void;
}

interface McpElicitationState {
  readonly handler: McpElicitationHandler;
  readonly completionWaiters: Map<string, () => void>;
}

const MCP_URL_ELICITATION_MAX_RETRIES = 3;
const MCP_URL_ELICITATION_TIMEOUT_MS = 5 * 60_000;
const elicitationStates = new WeakMap<Client, McpElicitationState>();

export type McpElicitationHandler = (
  params: ElicitRequestParams,
  requestId: string | number,
  signal: AbortSignal,
) => Promise<ElicitResult>;

export function createMcpSdkClient(
  name: string,
  version: string,
  elicitationHandler: McpElicitationHandler | undefined,
  onElicitationComplete?: (elicitationId: string) => void,
): Client {
  const client = new Client(
    { name, version },
    elicitationHandler === undefined
      ? undefined
      : { capabilities: { elicitation: { form: {}, url: {} } } },
  );
  if (elicitationHandler !== undefined) {
    const state: McpElicitationState = {
      handler: elicitationHandler,
      completionWaiters: new Map(),
    };
    elicitationStates.set(client, state);
    client.setRequestHandler(ElicitRequestSchema, async (request, extra) => {
      try {
        return await elicitationHandler(request.params, extra.requestId, extra.signal);
      } catch {
        return { action: 'cancel' };
      }
    });
    client.setNotificationHandler(
      ElicitationCompleteNotificationSchema,
      (notification) => {
        const { elicitationId } = notification.params;
        state.completionWaiters.get(elicitationId)?.();
        onElicitationComplete?.(elicitationId);
      },
    );
  }
  return client;
}

export async function callClientTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  toolCallTimeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<MCPToolResult> {
  const requestOptions = buildRequestOptions(toolCallTimeoutMs, signal);
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        requestOptions,
      );
      return toMcpToolResult(result);
    } catch (error) {
      if (
        !(error instanceof UrlElicitationRequiredError) ||
        attempt >= MCP_URL_ELICITATION_MAX_RETRIES
      ) {
        throw error;
      }
      await resolveRequiredUrlElicitations(client, error, attempt, signal);
    }
  }
}

async function resolveRequiredUrlElicitations(
  client: Client,
  error: UrlElicitationRequiredError,
  attempt: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  const state = elicitationStates.get(client);
  if (state === undefined) throw error;
  const interactionSignal = signal ?? new AbortController().signal;
  const waiters = error.elicitations.map((params) =>
    waitForUrlElicitationCompletion(state, params.elicitationId, interactionSignal),
  );
  try {
    for (let index = 0; index < error.elicitations.length; index++) {
      const params = error.elicitations[index]!;
      const response = await state.handler(
        params,
        `url-required:${String(attempt)}:${String(index)}:${params.elicitationId}`,
        interactionSignal,
      );
      if (response.action !== 'accept') throw error;
    }
    await Promise.all(waiters.map((waiter) => waiter.promise));
  } catch (resolutionError) {
    for (const waiter of waiters) waiter.cancel();
    throw resolutionError;
  }
}

function waitForUrlElicitationCompletion(
  state: McpElicitationState,
  elicitationId: string,
  signal: AbortSignal,
): McpUrlCompletionWaiter {
  let settled = false;
  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => {});
  const finish = (error?: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    if (state.completionWaiters.get(elicitationId) === complete) {
      state.completionWaiters.delete(elicitationId);
    }
    if (error === undefined) resolvePromise();
    else rejectPromise(error);
  };
  const complete = (): void => {
    finish();
  };
  const onAbort = (): void => {
    finish(signal.reason instanceof Error ? signal.reason : new Error('MCP URL elicitation aborted'));
  };
  const timer = setTimeout(() => {
    finish(new Error(`Timed out waiting for MCP URL elicitation "${elicitationId}"`));
  }, MCP_URL_ELICITATION_TIMEOUT_MS);
  state.completionWaiters.set(elicitationId, complete);
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  return {
    promise,
    cancel: () => {
      finish(new Error('MCP URL elicitation cancelled'));
    },
  };
}

/**
 * Build the `RequestOptions` object accepted by the MCP SDK's `callTool`,
 * including either the configured tool-call timeout, an in-flight abort
 * signal, both, or neither. Returns `undefined` when nothing needs to be
 * passed so the SDK falls back to its defaults.
 */
export function buildRequestOptions(
  toolCallTimeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): McpRequestOptions | undefined {
  if (toolCallTimeoutMs === undefined && signal === undefined) return undefined;
  return { timeout: toolCallTimeoutMs, signal };
}

interface SdkListedTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}

export function toMcpToolDefinition(tool: SdkListedTool): MCPToolDefinition {
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
  };
}

/**
 * Normalise the SDK's `callTool` return into kosong's {@link MCPToolResult}.
 * The SDK can return either the modern `{ content, isError }` shape or a
 * legacy `{ toolResult }` shape; we collapse the legacy shape to a single
 * text content block.
 */
export function toMcpToolResult(result: unknown): MCPToolResult {
  if (typeof result === 'object' && result !== null && 'content' in result) {
    const typed = result as { content: unknown; isError?: unknown };
    if (Array.isArray(typed.content)) {
      return {
        content: typed.content as MCPToolResult['content'],
        isError: typed.isError === true,
      };
    }
  }
  if (typeof result === 'object' && result !== null && 'toolResult' in result) {
    const legacy = (result as { toolResult: unknown }).toolResult;
    return {
      content: [
        {
          type: 'text',
          text: typeof legacy === 'string' ? legacy : JSON.stringify(legacy),
        },
      ],
      isError: false,
    };
  }
  return { content: [], isError: false };
}

export async function listClientResources(
  client: Client,
  toolCallTimeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<MCPResource[]> {
  if (client.getServerCapabilities()?.resources === undefined) return [];

  const resources: MCPResource[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await client.listResources(
      { cursor },
      buildRequestOptions(toolCallTimeoutMs, signal),
    );
    resources.push(
      ...result.resources.map(({ uri, name, description, mimeType }) => ({
        uri,
        name,
        description,
        mimeType,
      })),
    );
    cursor = result.nextCursor;
    if (cursor !== undefined && cursors.has(cursor)) {
      throw new Error(`MCP server repeated resource cursor "${cursor}"`);
    }
    if (cursor !== undefined) cursors.add(cursor);
  } while (cursor !== undefined);
  return resources;
}

export async function listClientPrompts(
  client: Client,
  toolCallTimeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<MCPPromptDefinition[]> {
  if (client.getServerCapabilities()?.prompts === undefined) return [];

  const prompts: MCPPromptDefinition[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await client.listPrompts(
      { cursor },
      buildRequestOptions(toolCallTimeoutMs, signal),
    );
    prompts.push(
      ...result.prompts.map(({ name, description, arguments: args }) => ({
        name,
        description,
        arguments: args,
      })),
    );
    cursor = result.nextCursor;
    if (cursor !== undefined && cursors.has(cursor)) {
      throw new Error(`MCP server repeated prompt cursor "${cursor}"`);
    }
    if (cursor !== undefined) cursors.add(cursor);
  } while (cursor !== undefined);
  return prompts;
}

export async function getClientPrompt(
  client: Client,
  name: string,
  args: Record<string, string>,
  toolCallTimeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<MCPPromptMessage[]> {
  if (client.getServerCapabilities()?.prompts === undefined) {
    throw new Error('MCP server does not support prompts');
  }
  const result = await client.getPrompt(
    { name, arguments: args },
    buildRequestOptions(toolCallTimeoutMs, signal),
  );
  return result.messages.map(({ role, content }) => ({ role, content }));
}

export async function readClientResource(
  client: Client,
  uri: string,
  toolCallTimeoutMs: number | undefined,
  signal?: AbortSignal,
): Promise<MCPResourceContent[]> {
  if (client.getServerCapabilities()?.resources === undefined) {
    throw new Error('MCP server does not support resources');
  }
  const result = await client.readResource(
    { uri },
    buildRequestOptions(toolCallTimeoutMs, signal),
  );
  return result.contents.map((content) =>
    'text' in content
      ? { uri: content.uri, mimeType: content.mimeType, text: content.text }
      : { uri: content.uri, mimeType: content.mimeType, blob: content.blob },
  );
}
