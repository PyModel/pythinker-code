import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { z } from 'zod';

import { createPinnedHttpDispatcher, resolveSafeHttpTarget } from '#/utils/safe-http';
import type {
  ElicitationHookResponse,
  HttpHookDef,
  HookResult,
} from './types';

export interface RunHookOptions {
  readonly timeout: number;
  readonly cwd?: string;
  readonly signal?: AbortSignal;
  readonly shell?: 'bash' | 'powershell';
}

export interface RunHttpHookOptions extends RunHookOptions {
  readonly allowedUrls?: readonly string[];
  readonly allowedEnvVars?: readonly string[];
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_SECONDS = 30;
const KILL_GRACE_MS = 100;
const OptionalStringSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    return undefined;
  },
  z.string().optional(),
);
const ElicitationContentSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
);
const HookSpecificOutputSchema = z.preprocess(
  (value) => (isRecord(value) ? value : undefined),
  z
    .looseObject({
      message: OptionalStringSchema,
      permissionDecision: z.unknown().optional(),
      permissionDecisionReason: OptionalStringSchema,
      retry: z.boolean().optional(),
      watchPaths: z.array(z.string()).optional(),
      action: z.enum(['accept', 'decline', 'cancel']).optional(),
      content: ElicitationContentSchema.optional(),
    })
    .optional(),
);
const HookJsonOutputSchema = z.looseObject({
  message: OptionalStringSchema,
  hookSpecificOutput: HookSpecificOutputSchema,
});

export async function runHook(
  command: string,
  input: Record<string, unknown>,
  options: RunHookOptions,
): Promise<HookResult> {
  let child: ChildProcessWithoutNullStreams;
  try {
    child =
      options.shell === 'powershell'
        ? spawn(
            process.platform === 'win32' ? 'powershell.exe' : 'pwsh',
            ['-NoProfile', '-NonInteractive', '-Command', command],
            {
              cwd: options.cwd,
              stdio: 'pipe',
              detached: false,
            },
          )
        : spawn(command, {
            shell: true,
            cwd: options.cwd,
            stdio: 'pipe',
            detached: process.platform !== 'win32',
          });
  } catch (error) {
    return allowResult({ stderr: errorMessage(error) });
  }

  return new Promise<HookResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = timeoutSeconds(options.timeout) * 1000;

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const settle = (result: HookResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const timeout = setTimeout(() => {
      killProcess(child);
      settle(allowResult({ stdout, stderr, timedOut: true }));
    }, timeoutMs);

    const onAbort = (): void => {
      killProcess(child);
      settle(allowResult({ stdout, stderr }));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted === true) {
      onAbort();
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      settle(allowResult({ stdout, stderr: stderr + errorMessage(error) }));
    });
    child.on('close', (code) => {
      settle(resultFromExitCode(code ?? 0, stdout, stderr));
    });

    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input));
  });
}

export async function runHttpHook(
  hook: HttpHookDef,
  input: Record<string, unknown>,
  options: RunHttpHookOptions,
): Promise<HookResult> {
  if (
    options.allowedUrls !== undefined &&
    !options.allowedUrls.some((pattern) => urlMatchesPattern(hook.url, pattern))
  ) {
    return allowResult({
      stderr: `HTTP hook blocked: ${hook.url} does not match allowed_http_hook_urls`,
    });
  }

  let dispatcher: ReturnType<typeof createPinnedHttpDispatcher>;
  try {
    options.signal?.throwIfAborted();
    dispatcher = createPinnedHttpDispatcher(await resolveSafeHttpTarget(hook.url, false));
    const timeoutSignal = AbortSignal.timeout(timeoutSeconds(options.timeout) * 1000);
    const signal =
      options.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([options.signal, timeoutSignal]);
    const response = await (options.fetchImpl ?? globalThis.fetch.bind(globalThis))(hook.url, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: httpHookHeaders(hook, options.allowedEnvVars),
      redirect: 'manual',
      signal,
      dispatcher: dispatcher as unknown,
    } as RequestInit);
    const body = await response.text();
    if (!response.ok) {
      return allowResult({
        stdout: body,
        stderr: `HTTP ${String(response.status)} from ${hook.url}`,
        exitCode: response.status,
      });
    }

    const structured = structuredOutput(body.trim() === '' ? '{}' : body);
    if (structured === undefined) {
      return allowResult({
        stdout: body,
        stderr: 'HTTP hook must return a JSON object.',
        exitCode: response.status,
      });
    }
    if (structured.action === 'block') {
      return {
        action: 'block',
        message: structured.message ?? structured.reason,
        reason: structured.reason,
        retry: structured.retry,
        watchPaths: structured.watchPaths,
        elicitationResponse: structured.elicitationResponse,
        stdout: body,
        exitCode: response.status,
        structuredOutput: true,
      };
    }
    return allowResult({
      message: structured.message,
      retry: structured.retry,
      watchPaths: structured.watchPaths,
      elicitationResponse: structured.elicitationResponse,
      stdout: body,
      exitCode: response.status,
      structuredOutput: true,
    });
  } catch (error) {
    return allowResult({
      stderr: options.signal?.aborted === true ? undefined : errorMessage(error),
    });
  } finally {
    await dispatcher?.close().catch(() => {});
  }
}

function httpHookHeaders(
  hook: HttpHookDef,
  policyAllowedEnvVars: readonly string[] | undefined,
): Record<string, string> {
  const hookAllowed = hook.allowedEnvVars ?? [];
  const allowed =
    policyAllowedEnvVars === undefined
      ? new Set(hookAllowed)
      : new Set(hookAllowed.filter((name) => policyAllowedEnvVars.includes(name)));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  for (const [name, value] of Object.entries(hook.headers ?? {})) {
    headers[name] = value
      .replace(
        /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g,
        (_match, braced: string | undefined, unbraced: string | undefined) => {
          const variable = braced ?? unbraced;
          return variable !== undefined && allowed.has(variable)
            ? (process.env[variable] ?? '')
            : '';
        },
      )
      .replaceAll(/[\r\n\u0000]/g, '');
  }
  return headers;
}

function urlMatchesPattern(url: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'u').test(url);
}

function timeoutSeconds(timeout: number): number {
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_SECONDS;
}

function resultFromExitCode(exitCode: number, stdout: string, stderr: string): HookResult {
  if (exitCode === 2) {
    const message = stderr.trim();
    return {
      action: 'block',
      message,
      reason: message,
      stdout,
      stderr,
      exitCode,
    };
  }

  const structured = exitCode === 0 ? structuredOutput(stdout) : undefined;
  if (structured?.action === 'block') {
    return {
      action: 'block',
      message: structured.message ?? structured.reason,
      reason: structured.reason,
      retry: structured.retry,
      watchPaths: structured.watchPaths,
      elicitationResponse: structured.elicitationResponse,
      stdout,
      stderr,
      exitCode,
      structuredOutput: structured.structuredOutput,
    };
  }

  return allowResult({
    message: structured?.message,
    retry: structured?.retry,
    watchPaths: structured?.watchPaths,
    elicitationResponse: structured?.elicitationResponse,
    stdout,
    stderr,
    exitCode,
    structuredOutput: structured?.structuredOutput,
  });
}

function structuredOutput(
  stdout: string,
):
  | {
      action?: 'block';
      reason?: string;
      message?: string;
      retry?: boolean;
      watchPaths?: readonly string[];
      elicitationResponse?: ElicitationHookResponse;
      structuredOutput: true;
    }
  | undefined {
  const text = stdout.trim();
  if (text.length === 0) return undefined;

  try {
    const parsed = JSON.parse(text) as unknown;
    const output = HookJsonOutputSchema.safeParse(parsed);
    if (!output.success) return undefined;

    const { message, hookSpecificOutput } = output.data;
    const result = {
      message: message ?? hookSpecificOutput?.message,
      retry: hookSpecificOutput?.retry,
      watchPaths: hookSpecificOutput?.watchPaths,
      elicitationResponse:
        hookSpecificOutput?.action === undefined
          ? undefined
          : {
              action: hookSpecificOutput.action,
              content: hookSpecificOutput.content,
            },
      structuredOutput: true as const,
    };
    if (hookSpecificOutput?.permissionDecision !== 'deny') {
      return result;
    }
    return {
      action: 'block',
      message: result.message,
      reason: hookSpecificOutput.permissionDecisionReason,
      retry: result.retry,
      watchPaths: result.watchPaths,
      elicitationResponse: result.elicitationResponse,
      structuredOutput: true,
    };
  } catch {
    return undefined;
  }
}

function allowResult(input: {
  readonly message?: string;
  readonly retry?: boolean;
  readonly watchPaths?: readonly string[];
  readonly elicitationResponse?: ElicitationHookResponse;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly structuredOutput?: boolean;
}): HookResult {
  return {
    action: 'allow',
    message: input.message,
    retry: input.retry,
    watchPaths: input.watchPaths,
    elicitationResponse: input.elicitationResponse,
    stdout: input.stdout,
    stderr: input.stderr,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    structuredOutput: input.structuredOutput,
  };
}

function killProcess(child: ChildProcessWithoutNullStreams): void {
  tryKillProcess(child, 'SIGTERM');
  const killTimer = setTimeout(() => {
    tryKillProcess(child, 'SIGKILL');
  }, KILL_GRACE_MS);
  killTimer.unref();
}

function tryKillProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (process.platform !== 'win32' && child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
