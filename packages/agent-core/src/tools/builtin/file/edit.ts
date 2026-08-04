/**
 * EditTool — exact string replacement in a file.
 *
 * Replaces the first occurrence of `old_string` with `new_string` by
 * default. When `replace_all` is true, replaces all occurrences.
 * Errors when `old_string` is not found or not unique (when
 * `replace_all=false`). Path access policy is resolved before any
 * Kaos I/O.
 */

import type { Kaos } from '@pythoughts/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import { materializeModelText, toModelTextView } from './line-endings';
import type { FileReadState } from './read';
import EDIT_DESCRIPTION from './edit.md?raw';

// `old_string` must be non-empty: the non-replace_all branch walks
// occurrences with `content.indexOf("", pos)`, which would loop forever
// on an empty search string.
export const EditInputSchema = z.object({
  path: z
    .string()
    .describe(
      'Path to the text file to edit. Relative paths resolve against the working directory; a path outside the working directory must be absolute.',
    ),
  old_string: z
    .string()
    .min(1)
    .describe(
      'Exact content to replace from the Read output view, without the line-number prefix. Use LF for pure CRLF files; use actual \\r escapes where Read shows \\r.',
    ),
  new_string: z
    .string()
    .describe(
      'Replacement text in the same Read output view. LF is written back as CRLF only for pure CRLF files.',
    ),
  replace_all: z
    .boolean()
    .optional()
    .describe('Set true only when every occurrence of old_string should be replaced.'),
});

export type EditInput = z.Infer<typeof EditInputSchema>;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function replaceOnceLiteral(content: string, oldString: string, newString: string): string {
  const index = content.indexOf(oldString);
  if (index === -1) return content;
  return content.slice(0, index) + newString + content.slice(index + oldString.length);
}

function normalizeQuotes(value: string): string {
  return value
    .replaceAll('‘', "'")
    .replaceAll('’', "'")
    .replaceAll('“', '"')
    .replaceAll('”', '"');
}

function findActualString(content: string, search: string): string | undefined {
  if (content.includes(search)) return search;
  const index = normalizeQuotes(content).indexOf(normalizeQuotes(search));
  return index === -1 ? undefined : content.slice(index, index + search.length);
}

function isOpeningQuote(chars: readonly string[], index: number): boolean {
  if (index === 0) return true;
  return [' ', '\t', '\n', '\r', '(', '[', '{', '—', '–'].includes(chars[index - 1] ?? '');
}

function curlQuotes(value: string, quote: "'" | '"'): string {
  const chars = Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
  return chars
    .map((char, index) => {
      if (char !== quote) return char;
      if (
        quote === "'" &&
        /\p{L}/u.test(chars[index - 1] ?? '') &&
        /\p{L}/u.test(chars[index + 1] ?? '')
      ) {
        return '’';
      }
      if (quote === '"') return isOpeningQuote(chars, index) ? '“' : '”';
      return isOpeningQuote(chars, index) ? '‘' : '’';
    })
    .join('');
}

function preserveQuoteStyle(oldString: string, actualOldString: string, newString: string): string {
  if (oldString === actualOldString) return newString;
  let result = newString;
  if (actualOldString.includes('“') || actualOldString.includes('”')) {
    result = curlQuotes(result, '"');
  }
  if (actualOldString.includes('‘') || actualOldString.includes('’')) {
    result = curlQuotes(result, "'");
  }
  return result;
}

const FILE_NOT_READ_ERROR = 'File has not been read yet. Use Read before editing it.';
const FILE_MODIFIED_ERROR =
  'File has been modified since it was read. Read it again before editing.';

export class EditTool implements BuiltinTool<EditInput> {
  readonly name = 'Edit' as const;
  readonly description = EDIT_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(EditInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly readState?: FileReadState,
    private readonly beforeWrite?: (path: string) => Promise<void>,
  ) {}

  resolveExecution(args: EditInput): ToolExecution {
    const path = resolvePathAccessPath(args.path, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'write',
    });
    return {
      accesses: ToolAccesses.readWriteFile(path),
      description: `Editing ${args.path}`,
      display: {
        kind: 'file_io',
        operation: 'edit',
        path,
        before: args.old_string,
        after: args.new_string,
      },
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

  private async execution(args: EditInput, safePath: string): Promise<ExecutableToolResult> {
    if (args.old_string === args.new_string) {
      return {
        isError: true,
        output: 'No changes to make: old_string and new_string are exactly the same.',
      };
    }
    if (safePath.toLowerCase().endsWith('.ipynb')) {
      return {
        isError: true,
        output: 'Jupyter notebooks must be edited with NotebookEdit.',
      };
    }

    try {
      const snapshot = this.readState?.get(safePath);
      if (this.readState !== undefined && snapshot === undefined) {
        return { isError: true, output: FILE_NOT_READ_ERROR };
      }
      if (snapshot?.isPartialView === true) {
        return {
          isError: true,
          output: 'A complete Read is required before editing this file.',
        };
      }

      const mtimeBeforeRead =
        snapshot === undefined ? undefined : (await this.kaos.stat(safePath)).stMtime;
      if (snapshot !== undefined && mtimeBeforeRead !== snapshot.mtime) {
        return { isError: true, output: FILE_MODIFIED_ERROR };
      }

      const raw = await this.kaos.readText(safePath);
      if (
        mtimeBeforeRead !== undefined &&
        (await this.kaos.stat(safePath)).stMtime !== mtimeBeforeRead
      ) {
        return { isError: true, output: FILE_MODIFIED_ERROR };
      }

      const modelView = toModelTextView(raw);
      const content = modelView.text;
      const replaceAll = args.replace_all ?? false;
      const actualOldString = findActualString(content, args.old_string);

      if (actualOldString === undefined) {
        return { isError: true, output: `old_string not found in ${args.path}, the file contents may be out of date. Please use the Read Tool to reload the content.
` };
      }

      const replacementCount = content.split(actualOldString).length - 1;
      if (!replaceAll && replacementCount > 1) {
        return {
          isError: true,
          output:
            `old_string is not unique in ${args.path} (found ${String(replacementCount)} occurrences). ` +
            'To replace every occurrence, set replace_all=true. To replace only one occurrence, include more surrounding context in old_string.',
        };
      }

      const actualNewString = preserveQuoteStyle(
        args.old_string,
        actualOldString,
        args.new_string,
      );
      const stringToReplace =
        actualNewString === '' &&
        !actualOldString.endsWith('\n') &&
        content.includes(`${actualOldString}\n`)
          ? `${actualOldString}\n`
          : actualOldString;
      const newContent = replaceAll
        ? content.split(stringToReplace).join(actualNewString)
        : replaceOnceLiteral(content, stringToReplace, actualNewString);

      await this.beforeWrite?.(safePath);
      await this.kaos.writeText(
        safePath,
        materializeModelText(newContent, modelView.lineEndingStyle),
      );
      if (this.readState !== undefined) {
        try {
          this.readState.set(safePath, {
            mtime: (await this.kaos.stat(safePath)).stMtime,
            range: 'edited',
            isPartialView: false,
          });
        } catch {
          this.readState.delete(safePath);
        }
      }
      return {
        output: `Replaced ${String(replaceAll ? replacementCount : 1)} occurrence${
          replaceAll && replacementCount !== 1 ? 's' : ''
        } in ${args.path}`,
      };
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 'EISDIR') {
        return { isError: true, output: `${args.path} is not a file.` };
      }
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
