/**
 * WriteTool — overwrite or append to a file.
 *
 * Creates the file and any missing parent directories if needed.
 * Path access policy is resolved before any Kaos I/O.
 */

import type { Kaos } from '@pythoughts/kaos';
import { dirname } from 'pathe';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import type { FileReadState } from './read';
import WRITE_DESCRIPTION from './write.md?raw';

/** Mask isolating the file-type bits of a stat mode. */
const S_IFMT = 0o170000;
/** File-type bits of a directory. */
const S_IFDIR = 0o040000;

function isFileNotFoundError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

export const WriteInputSchema = z.object({
  path: z
    .string()
    .describe(
      'Path to the file to create, append to, or completely overwrite. Relative paths resolve against the working directory; a path outside the working directory must be absolute. Missing parent directories are created.',
    ),
  content: z
    .string()
    .describe(
      'Raw full file content to write exactly as provided. This does not use the Read/Edit text view.',
    ),
  mode: z
    .enum(['overwrite', 'append'])
    .optional()
    .describe(
      'Write mode. Defaults to overwrite. append adds content to the end exactly as provided and does not add a newline.',
    ),
});

export const WriteOutputSchema = z.object({
  /** Number of UTF-8 bytes written to disk by this call. */
  bytesWritten: z.number().int().nonnegative(),
});

export type WriteInput = z.Infer<typeof WriteInputSchema>;
export type WriteOutput = z.Infer<typeof WriteOutputSchema>;

export class WriteTool implements BuiltinTool<WriteInput> {
  readonly name = 'Write' as const;
  readonly description = WRITE_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WriteInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly readState?: FileReadState,
    private readonly beforeWrite?: (path: string) => Promise<void>,
  ) {}

  resolveExecution(args: WriteInput): ToolExecution {
    const path = resolvePathAccessPath(args.path, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'write',
    });
    return {
      accesses: ToolAccesses.writeFile(path),
      description: `Writing ${args.path}`,
      display: { kind: 'file_io', operation: 'write', path, content: args.content },
      approvalRule: literalRulePattern(this.name, path),
      matchesRule: (ruleArgs) =>
        matchesPathRuleSubject(ruleArgs, path, {
          cwd: this.workspace.workspaceDir,
          pathClass: this.kaos.pathClass(),
          homeDir: this.kaos.gethome(),
        }),
      execute: () => this.execution(args, path),
    };
  }

  private async execution(args: WriteInput, safePath: string): Promise<ExecutableToolResult> {
    const parentError = await this.prepareParentDirectory(safePath);
    if (parentError !== undefined) {
      return { isError: true, output: parentError };
    }

    try {
      if (this.readState !== undefined) {
        let mtime: number | undefined;
        try {
          mtime = (await this.kaos.stat(safePath)).stMtime;
        } catch (error) {
          if (!isFileNotFoundError(error)) throw error;
        }
        if (mtime !== undefined) {
          const snapshot = this.readState.get(safePath);
          if (snapshot === undefined) {
            return {
              isError: true,
              output: 'File has not been read yet. Use Read before overwriting it.',
            };
          }
          if (snapshot.isPartialView === true) {
            return {
              isError: true,
              output: 'A complete Read is required before overwriting this file.',
            };
          }
          if (snapshot.mtime !== mtime) {
            return {
              isError: true,
              output:
                'File has been modified since it was read. Read it again before overwriting.',
            };
          }
        }
      }

      const mode = args.mode ?? 'overwrite';
      await this.beforeWrite?.(safePath);
      if (mode === 'append') {
        await this.kaos.writeText(safePath, args.content, { mode: 'a' });
      } else {
        await this.kaos.writeText(safePath, args.content);
      }
      if (this.readState !== undefined) {
        try {
          this.readState.set(safePath, {
            mtime: (await this.kaos.stat(safePath)).stMtime,
            range: 'written',
            isPartialView: false,
          });
        } catch {
          this.readState.delete(safePath);
        }
      }
      // Report the number of UTF-8 bytes this call wrote to disk. The string
      // length would only equal the byte count for pure ASCII content, so it
      // is not used here.
      const bytesWritten = Buffer.byteLength(args.content, 'utf8');
      return {
        output: `${mode === 'append' ? 'Appended' : 'Wrote'} ${String(bytesWritten)} bytes to ${args.path}`,
      };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'ENOENT') {
        return {
          isError: true,
          output: `Failed to write ${args.path}: parent directory does not exist.`,
        };
      }
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Ensure that the parent directory exists and is a directory.
   *
   * The path schema documents this precondition; probing it up front turns a
   * missing parents are created using Kaos' platform-neutral recursive mkdir.
   * Returns an error string when the precondition is definitively violated,
   * or `undefined` otherwise. Any other `stat` failure (permissions, an
   * environment without `stat`) is treated as inconclusive: the check is
   * skipped and the write proceeds, surfacing the real I/O error if any.
   */
  private async prepareParentDirectory(safePath: string): Promise<string | undefined> {
    const parent = dirname(safePath);
    let stat;
    try {
      stat = await this.kaos.stat(parent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          await this.kaos.mkdir(parent, { parents: true, existOk: true });
          return;
        } catch (mkdirError) {
          return `Failed to create parent directory ${parent}: ${
            mkdirError instanceof Error ? mkdirError.message : String(mkdirError)
          }`;
        }
      }
      return undefined;
    }
    if ((stat.stMode & S_IFMT) !== S_IFDIR) {
      return `Parent path is not a directory: ${parent}.`;
    }
    return undefined;
  }
}
