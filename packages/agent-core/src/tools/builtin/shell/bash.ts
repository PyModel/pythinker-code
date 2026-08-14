/**
 * BashTool — execute shell commands.
 *
 * Invokes bash (POSIX) according to an injected `Environment`. On Windows
 * the shell is Git Bash; the path is resolved by `detectEnvironment`.
 *
 * Dependencies injected via constructor:
 *   - `Kaos`        — shell execution abstraction (exec / execWithEnv)
 *   - `cwd`         — default working directory for commands
 *   - `Environment` — cross-platform probe (shellName / shellPath)
 *   - `BackgroundManager?` — optional: required iff run_in_background=true
 *
 * Execution goes through Kaos, never directly via node:child_process.
 *
 * Hardening:
 *   - `args.timeout` (seconds) and the ambient `signal` both drive
 *     `Promise.race`; fire-a-kill on either edge.
 *   - stdin is closed immediately so interactive commands (`cat`, `read`,
 *     `python -c 'input()'`) receive EOF instead of hanging.
 *   - Two-phase kill: SIGTERM → 5s grace → SIGKILL (Kaos honours this
 *     contract cross-platform).
 *   - stdout/stderr stream into ToolResultBuilder; excess is replaced with a
 *     truncation marker so a runaway command cannot OOM the host.
 */

import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type { Kaos, KaosProcess } from '@pymodel/kaos';
import { z } from 'zod';

import { ProcessBackgroundTask, type BackgroundManager } from '../../../agent/background';
import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution, ToolUpdate } from '../../../loop/types';
import { renderPrompt } from '../../../utils/render-prompt';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '../../support/rule-match';
import { ToolResultBuilder } from '../../support/result-builder';
import { isPrematureCloseError } from '../../support/stream';
import bashDescriptionTemplate from './bash.md?raw';

const MS_PER_SECOND = 1000;
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 5 * 60;
const DEFAULT_BACKGROUND_TIMEOUT_S = 10 * 60;
const MAX_BACKGROUND_TIMEOUT_S = 24 * 60 * 60;
const SIGTERM_GRACE_MS = 5_000;
const MAX_PERSISTED_OUTPUT_BYTES = 64 * 1024 * 1024;

type ShellDialect = 'bash' | 'powershell';

export const BashInputSchema = z
  .object({
    command: z.string().min(1, 'Command cannot be empty.').describe('The command to execute.'),
    cwd: z
      .string()
      .optional()
      .describe(
        "The working directory in which to run the command. When omitted, the command runs in the session's working directory.",
      ),
    timeout: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_TIMEOUT_S)
      .describe(
        `Optional timeout in seconds for the command to execute. Foreground default ${String(DEFAULT_TIMEOUT_S)}s, max ${String(MAX_TIMEOUT_S)}s. Background default ${String(DEFAULT_BACKGROUND_TIMEOUT_S)}s, max ${String(MAX_BACKGROUND_TIMEOUT_S)}s. Ignored for background commands when disable_timeout=true.`,
      )
      .optional(),
    description: z
      .string()
      .optional()
      .describe(
        'A short description for the background task. Required when run_in_background is true.',
      ),
    run_in_background: z
      .boolean()
      .optional()
      .describe('Whether to run the command as a background task.'),
    disable_timeout: z
      .boolean()
      .optional()
      .describe(
        'If true, do not apply a timeout to the command. Only applies when run_in_background is true.',
      ),
  })
  .superRefine((val, ctx) => {
    if (val.timeout === undefined) return;
    const isBackground = val.run_in_background === true;
    if (!isValidTimeoutValue(val.timeout, isBackground)) {
      const cap = isBackground ? MAX_BACKGROUND_TIMEOUT_S : MAX_TIMEOUT_S;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeout'],
        message: `timeout must be ≤ ${String(cap)}s (${isBackground ? 'background' : 'foreground'})`,
      });
    }
  });

export const BashOutputSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

export type BashInput = z.Infer<typeof BashInputSchema>;
export type BashOutput = z.Infer<typeof BashOutputSchema>;

const SHELL_TIMEOUT_VARS = {
  DEFAULT_TIMEOUT_S,
  DEFAULT_BACKGROUND_TIMEOUT_S,
  MAX_TIMEOUT_S,
  MAX_BACKGROUND_TIMEOUT_S,
};

function timeoutCapS(isBackground: boolean): number {
  return isBackground ? MAX_BACKGROUND_TIMEOUT_S : MAX_TIMEOUT_S;
}

function isValidTimeoutValue(timeout: number, isBackground: boolean): boolean {
  return timeout <= timeoutCapS(isBackground);
}

function normalizeTimeoutMs(timeout: number | undefined, isBackground: boolean): number {
  const defaultSeconds = isBackground ? DEFAULT_BACKGROUND_TIMEOUT_S : DEFAULT_TIMEOUT_S;
  const value = timeout ?? defaultSeconds;
  return Math.min(value, timeoutCapS(isBackground)) * MS_PER_SECOND;
}

function interpretExitCode(command: string, exitCode: number, dialect: ShellDialect): {
  readonly isError: boolean;
  readonly message?: string;
} {
  if (dialect === 'powershell') {
    const segments = command.split(/[;|]/u);
    const last = segments.findLast((segment) => segment.trim().length > 0) ?? command;
    const token = last
      .trim()
      .replace(/^[&.]\s+/u, '')
      .split(/\s+/u)[0]
      ?.replaceAll(/^["']|["']$/gu, '')
      .split(/[\\/]/u)
      .at(-1)
      ?.toLowerCase()
      .replace(/\.exe$/u, '');
    if ((token === 'grep' || token === 'rg' || token === 'findstr') && exitCode === 1) {
      return { isError: false, message: 'No matches found' };
    }
    if (token === 'robocopy' && exitCode < 8) {
      if (exitCode === 0) return { isError: false, message: 'No files copied (already in sync)' };
      return {
        isError: false,
        message: (exitCode & 1) === 1 ? 'Files copied successfully' : 'Robocopy completed (no errors)',
      };
    }
    return { isError: exitCode !== 0 };
  }

  const segments = command.split(/&&|\|\||[;|\n]/u);
  const last = segments.findLast((segment) => segment.trim().length > 0) ?? command;
  const baseCommand = last.trim().split(/\s+/u)[0] ?? '';
  if (exitCode === 1) {
    switch (baseCommand) {
      case 'grep':
      case 'rg':
        return { isError: false, message: 'No matches found' };
      case 'find':
        return { isError: false, message: 'Some directories were inaccessible' };
      case 'diff':
        return { isError: false, message: 'Files differ' };
      case 'test':
      case '[':
        return { isError: false, message: 'Condition is false' };
    }
  }
  return { isError: exitCode !== 0 };
}

class BashOutputSpool {
  private readonly directory: string;
  private readonly filepath: string;
  private queue = Promise.resolve();
  private buffered = '';
  private persisted = false;
  private failed = false;
  private bytes = 0;

  constructor(
    private readonly kaos: Kaos,
    dialect: ShellDialect,
  ) {
    const paths = kaos.pathClass() === 'win32' ? win32 : posix;
    this.directory = paths.join(kaos.gethome(), '.pythinker-code', 'tool-results');
    this.filepath = paths.join(this.directory, `${dialect}-${randomUUID()}.log`);
  }

  write(text: string, force: boolean): Promise<void> {
    if (text.length === 0 || this.failed) return this.queue;
    this.queue = this.queue
      .then(() => this.writeNow(text, force))
      .catch(() => {
        this.failed = true;
        this.buffered = '';
      });
    return this.queue;
  }

  async flush(): Promise<string | undefined> {
    await this.queue;
    return this.persisted && !this.failed ? this.filepath : undefined;
  }

  private async writeNow(text: string, force: boolean): Promise<void> {
    const remaining = MAX_PERSISTED_OUTPUT_BYTES - this.bytes;
    if (remaining <= 0) return;
    const bytes = Buffer.from(text, 'utf8');
    const chunk =
      bytes.length <= remaining ? text : bytes.subarray(0, remaining).toString('utf8');
    this.bytes += Buffer.byteLength(chunk, 'utf8');

    if (!this.persisted) {
      this.buffered += chunk;
      if (!force) return;
      await this.kaos.mkdir(this.directory, { parents: true, existOk: true });
      await this.kaos.writeText(this.filepath, this.buffered);
      this.buffered = '';
      this.persisted = true;
      return;
    }
    await this.kaos.writeText(this.filepath, chunk, { mode: 'a' });
  }
}

function withPersistedOutput(
  result: ExecutableToolResult,
  filepath: string | undefined,
): ExecutableToolResult {
  if (filepath === undefined) return result;
  const suffix = `Full output saved to: ${filepath}`;
  const output =
    typeof result.output === 'string'
      ? `${result.output}${result.output.endsWith('\n') ? '' : '\n'}${suffix}`
      : result.output;
  return { ...result, output };
}

async function disposeProcess(proc: KaosProcess): Promise<void> {
  try {
    await proc.dispose();
  } catch {
    /* best-effort cleanup */
  }
}

function renderBashDescription(shellName: string): string {
  return renderPrompt(bashDescriptionTemplate, { ...SHELL_TIMEOUT_VARS, SHELL_NAME: shellName });
}

function renderPowerShellDescription(): string {
  return `Executes a PowerShell command in the session workspace with \`-NoProfile -NonInteractive\`.

Use this for Windows terminal operations and PowerShell cmdlets. Prefer Read, Write, Edit, Glob, and Grep for file operations.

PowerShell syntax:
- Use \`$env:NAME\` for environment variables and \`Get-ChildItem\`, \`Get-Content\`, and other Verb-Noun cmdlets.
- Windows PowerShell 5.1 does not support \`&&\`, \`||\`, \`??\`, or the ternary operator.
- Interactive prompts cannot be answered. Avoid \`Read-Host\`, \`Get-Credential\`, and interactive editors.

Foreground commands default to ${String(DEFAULT_TIMEOUT_S)}s and allow up to ${String(MAX_TIMEOUT_S)}s. Background commands require a description, notify on completion, and can run up to ${String(MAX_BACKGROUND_TIMEOUT_S)}s.`;
}

function withoutBackgroundDescription(description: string): string {
  return description
    .replace(
      /\n\nIf `run_in_background=true`,[\s\S]*?point them to the `\/tasks` command, which opens an interactive panel; it has no subcommands\./,
      '\n\nBackground execution is disabled for this agent. Do not set `run_in_background=true`.',
    )
    .replace(
      ` For possibly long-running foreground commands, set the \`timeout\` argument in seconds. Foreground commands default to ${String(DEFAULT_TIMEOUT_S)}s and allow up to ${String(MAX_TIMEOUT_S)}s.`,
      ` For possibly long-running commands, set the \`timeout\` argument in seconds. The default is ${String(DEFAULT_TIMEOUT_S)}s; foreground commands allow up to ${String(MAX_TIMEOUT_S)}s.`,
    )
    .replace(
      /\n- Prefer `run_in_background=true`[\s\S]*?conversation to continue before the command finishes\./,
      '\n- Do not set `run_in_background=true`; background task management tools are not available.',
    );
}

export class BashTool implements BuiltinTool<BashInput> {
  readonly name: 'Bash' | 'PowerShell';
  readonly description: string;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(BashInputSchema);

  private readonly isWindowsBash: boolean;

  private readonly allowBackground: boolean;

  private readonly dialect: ShellDialect;

  constructor(
    private readonly kaos: Kaos,
    private readonly cwd: string,
    private readonly backgroundManager?: BackgroundManager,
    options?: {
      allowBackground?: boolean | undefined;
      dialect?: ShellDialect | undefined;
    },
  ) {
    this.dialect = options?.dialect ?? 'bash';
    this.name = this.dialect === 'powershell' ? 'PowerShell' : 'Bash';
    this.isWindowsBash = this.kaos.osEnv.osKind === 'Windows';
    this.allowBackground = options?.allowBackground ?? this.backgroundManager !== undefined;
    const rendered =
      this.dialect === 'powershell'
        ? renderPowerShellDescription()
        : renderBashDescription(this.kaos.osEnv.shellName);
    this.description = this.allowBackground
      ? rendered
      : this.dialect === 'powershell'
        ? rendered.replace(
            / Background commands require[\s\S]*$/u,
            ' Background execution is disabled for this agent.',
          )
        : withoutBackgroundDescription(rendered);
  }

  resolveExecution(args: BashInput): ToolExecution {
    const preview = args.command.length > 50 ? `${args.command.slice(0, 50)}…` : args.command;
    return {
      description: args.run_in_background
        ? `Starting background: ${preview}`
        : `Running: ${preview}`,
      display: {
        kind: 'command',
        command: args.command,
        cwd: args.cwd ?? this.cwd,
        description: args.description,
        language: this.dialect,
      },
      approvalRule: literalRulePattern(this.name, args.command),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.command),
      execute: ({ signal, onUpdate }) => this.execution(args, signal, onUpdate),
    };
  }

  private async spawn(effectiveCwd: string, command: string): Promise<KaosProcess> {
    if (this.dialect === 'powershell') {
      const commandWithExitCode =
        `${command}\n` +
        '; $__pythinkerExitCode = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }; exit $__pythinkerExitCode';
      const args = ['-NoProfile', '-NonInteractive', '-Command', commandWithExitCode];
      const env = {
        ...(process.env as Record<string, string>),
        NO_COLOR: '1',
        TERM: 'dumb',
      };
      const kaos = this.kaos.withCwd(effectiveCwd);
      try {
        return await kaos.execWithEnv(['pwsh.exe', ...args], env);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return kaos.execWithEnv(['powershell.exe', ...args], env);
      }
    }

    const shellCwd = this.isWindowsBash ? windowsPathToPosixPath(effectiveCwd) : effectiveCwd;
    const shellArgs = [
      this.kaos.osEnv.shellPath,
      '-c',
      `cd ${shellQuote(shellCwd)} && ${command}`,
    ];

    const noninteractiveEnv: Record<string, string> = {
      NO_COLOR: '1',
      TERM: 'dumb',
      // Default to '0' so git fails fast on private remotes if a TTY happens
      // to be inherited; honour an explicit ambient value when the user has
      // set one.
      GIT_TERMINAL_PROMPT: process.env['GIT_TERMINAL_PROMPT'] ?? '0',
      SHELL: this.kaos.osEnv.shellPath,
    };

    // Merge ambient env + noninteractive knobs so tools like git / node
    // don't open a pager and paints don't colour the stream.
    const mergedEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...noninteractiveEnv,
    };
    return this.kaos.execWithEnv(shellArgs, mergedEnv);
  }

  private async execution(
    args: BashInput,
    signal: AbortSignal,
    onUpdate?: ((update: ToolUpdate) => void) | undefined,
  ): Promise<ExecutableToolResult> {
    if (signal.aborted) {
      return { isError: true, output: 'Aborted before command started' };
    }
    if (args.command.length === 0) {
      return { isError: true, output: 'Command cannot be empty.' };
    }

    if (args.run_in_background) {
      if (!this.allowBackground) {
        return {
          isError: true,
          output:
            'Background execution is not available for this agent because TaskOutput and TaskStop are not enabled.',
        };
      }
      return this.executeInBackground(args);
    }

    const timeoutMs = normalizeTimeoutMs(args.timeout, false);

    let proc: KaosProcess;
    const command =
      this.dialect === 'bash' && this.isWindowsBash
        ? rewriteWindowsNullRedirect(args.command)
        : args.command;
    try {
      const effectiveCwd = args.cwd ?? this.cwd;
      proc = await this.spawn(effectiveCwd, command);
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      proc.stdin.end();
    } catch {
      // Closing stdin on a process that has already exited is a no-op on
      // some platforms and throws on others — either is safe to ignore.
    }

    let timedOut = false;
    let aborted = false;
    let killed = false;

    const killProc = async (): Promise<void> => {
      if (killed) return;
      killed = true;
      try {
        await proc.kill('SIGTERM');
      } catch {
        /* process already gone */
      }
      const exited = proc
        .wait()
        .then(() => true)
        .catch(() => true);
      const raced = await Promise.race([
        exited,
        new Promise<false>((resolve) => {
          setTimeout(() => {
            resolve(false);
          }, SIGTERM_GRACE_MS);
        }),
      ]);
      if (!raced && proc.exitCode === null) {
        try {
          await proc.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }

      await disposeProcess(proc);
    };

    const onAbort = (): void => {
      aborted = true;
      void killProc();
    };
    signal.addEventListener('abort', onAbort);

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      void killProc();
    }, timeoutMs);

    try {
      const builder = new ToolResultBuilder();
      const spool = new BashOutputSpool(this.kaos, this.dialect);
      const isTerminating = (): boolean => timedOut || aborted || killed;
      const [, exitCode] = await Promise.all([
        Promise.all([
          readStreamIntoBuilder(
            proc.stdout,
            builder,
            spool,
            'stdout',
            onUpdate,
            isTerminating,
          ),
          readStreamIntoBuilder(
            proc.stderr,
            builder,
            spool,
            'stderr',
            onUpdate,
            isTerminating,
          ),
        ]),
        proc.wait(),
      ]);
      const persistedOutput = await spool.flush();

      if (timedOut) {
        const timeoutLabel =
          timeoutMs % 1000 === 0 ? `${String(timeoutMs / 1000)}s` : `${String(timeoutMs)}ms`;
        return withPersistedOutput(
          builder.error(`Command killed by timeout (${timeoutLabel})`, {
            brief: `Killed by timeout (${timeoutLabel})`,
          }),
          persistedOutput,
        );
      }
      if (aborted) {
        return withPersistedOutput(
          builder.error('Interrupted by user', { brief: 'Interrupted by user' }),
          persistedOutput,
        );
      }

      const interpretation = interpretExitCode(args.command, exitCode, this.dialect);
      const isError = interpretation.isError;
      if (isError && builder.nChars === 0) {
        builder.write(`Process exited with code ${String(exitCode)}`);
      }

      if (!isError) {
        return withPersistedOutput(
          builder.ok(interpretation.message ?? 'Command executed successfully.'),
          persistedOutput,
        );
      }
      return withPersistedOutput(
        builder.error(`Command failed with exit code: ${String(exitCode)}.`, {
          brief: `Failed with exit code: ${String(exitCode)}`,
        }),
        persistedOutput,
      );
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeoutHandle);
      signal.removeEventListener('abort', onAbort);
      await disposeProcess(proc);
    }
  }

  private async executeInBackground(args: BashInput): Promise<ExecutableToolResult> {
    if (!this.backgroundManager) {
      return {
        isError: true,
        output: 'Background execution is not available (no BackgroundManager configured).',
      };
    }
    const backgroundManager = this.backgroundManager;

    if (!args.description?.trim()) {
      return {
        isError: true,
        output: 'description is required when run_in_background is true.',
      };
    }

    const timeoutMs = args.disable_timeout ? undefined : normalizeTimeoutMs(args.timeout, true);

    let proc: KaosProcess;
    const command =
      this.dialect === 'bash' && this.isWindowsBash
        ? rewriteWindowsNullRedirect(args.command)
        : args.command;
    try {
      const effectiveCwd = args.cwd ?? this.cwd;
      proc = await this.spawn(effectiveCwd, command);
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      proc.stdin.end();
    } catch {
      /* process already gone */
    }

    let taskId: string;
    try {
      taskId = backgroundManager.registerTask(
        new ProcessBackgroundTask(
          proc,
          command,
          args.description.trim(),
          this.dialect === 'powershell' ? 'powershell' : 'bash',
        ),
      );
    } catch (error) {
      try {
        await proc.kill('SIGTERM');
      } catch {
        /* process already gone */
      }
      await disposeProcess(proc);
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }

    if (timeoutMs !== undefined) {
      const timeoutHandle = setTimeout(() => {
        void (async (): Promise<void> => {
          if (proc.exitCode !== null) return;
          const info = backgroundManager.getTask(taskId);
          if (info && info.status === 'running') {
            void backgroundManager.stop(taskId, 'Timed out');
          }
        })();
      }, timeoutMs);
      timeoutHandle.unref?.();
    }

    // registerTask() synchronously inserts taskId into the manager's Map, so
    // this lookup in the same tick cannot return undefined.
    const status = backgroundManager.getTask(taskId)!.status;
    const builder = new ToolResultBuilder();
    builder.write(
      `task_id: ${taskId}\n` +
        `pid: ${String(proc.pid)}\n` +
        `description: ${args.description.trim()}\n` +
        `status: ${status}\n` +
        `automatic_notification: true\n` +
        'next_step: You will be automatically notified when it completes.\n' +
        'next_step: Use TaskOutput with this task_id for a non-blocking status/output snapshot.\n' +
        'next_step: Use TaskStop only if the task must be cancelled.\n' +
        'human_shell_hint: Tell the human to run /tasks to open the interactive background-task panel.',
    );
    return builder.ok('Background task started', { brief: `Started ${taskId}` });
  }
}

export class PowerShellTool extends BashTool {
  constructor(
    kaos: Kaos,
    cwd: string,
    backgroundManager?: BackgroundManager,
    options?: {
      allowBackground?: boolean | undefined;
    },
  ) {
    super(kaos, cwd, backgroundManager, { ...options, dialect: 'powershell' });
  }
}

async function readStreamIntoBuilder(
  stream: Readable,
  builder: ToolResultBuilder,
  spool: BashOutputSpool,
  kind: 'stdout' | 'stderr',
  onUpdate?: ((update: ToolUpdate) => void) | undefined,
  suppressPrematureClose?: () => boolean,
): Promise<void> {
  const decoder = new StringDecoder('utf8');
  try {
    for await (const chunk of stream) {
      const buf: Buffer =
        typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer);
      const text = decoder.write(buf);
      if (text.length > 0) onUpdate?.({ kind, text });
      builder.write(text);
      await spool.write(text, builder.truncated);
    }
  } catch (error) {
    if (!isPrematureCloseError(error) || suppressPrematureClose?.() !== true) {
      throw error;
    }
  }
  const trailing = decoder.end();
  if (trailing.length > 0) onUpdate?.({ kind, text: trailing });
  builder.write(trailing);
  await spool.write(trailing, builder.truncated);
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

function windowsPathToPosixPath(path: string): string {
  if (path.startsWith('\\\\')) {
    return path.replaceAll('\\', '/');
  }

  const driveMatch = /^([A-Za-z]):(?:[\\/]|$)/.exec(path);
  if (driveMatch !== null) {
    const drive = driveMatch[1]!.toLowerCase();
    const rest = path.slice(2).replaceAll('\\', '/');
    return `/${drive}${rest.startsWith('/') ? rest : `/${rest}`}`;
  }

  return path.replaceAll('\\', '/');
}

const WINDOWS_NUL_REDIRECT = /(\d?&?>+\s*)[Nn][Uu][Ll](?=\s|$|[|&;)\n])/g;

function rewriteWindowsNullRedirect(command: string): string {
  return command.replace(WINDOWS_NUL_REDIRECT, '$1/dev/null');
}
