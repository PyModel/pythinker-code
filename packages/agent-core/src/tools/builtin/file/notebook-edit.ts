import { randomUUID } from 'node:crypto';

import type { Kaos } from '@pymodel/kaos';
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
import NOTEBOOK_EDIT_DESCRIPTION from './notebook-edit.md?raw';

export const NotebookEditInputSchema = z
  .object({
    notebook_path: z
      .string()
      .describe(
        'Path to an existing Jupyter notebook. Relative paths resolve against the working directory; the file must end in .ipynb.',
      ),
    cell_id: z
      .string()
      .optional()
      .describe(
        'Cell ID shown by Read. Required for replace and delete; insert places the new cell after it, or at the beginning when omitted.',
      ),
    new_source: z.string().describe('Complete replacement source for the cell.'),
    cell_type: z
      .enum(['code', 'markdown'])
      .optional()
      .describe('New cell type. Required for insert; otherwise preserves the existing type.'),
    edit_mode: z
      .enum(['replace', 'insert', 'delete'])
      .optional()
      .describe('Cell operation. Defaults to replace.'),
  })
  .strict();

export type NotebookEditInput = z.Infer<typeof NotebookEditInputSchema>;

type NotebookCell = Record<string, unknown> & {
  cell_type?: unknown;
  id?: unknown;
  source?: unknown;
};

type Notebook = Record<string, unknown> & {
  cells: unknown[];
};

function asNotebook(value: unknown): Notebook | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const notebook = value as Record<string, unknown>;
  return Array.isArray(notebook['cells']) ? (notebook as Notebook) : undefined;
}

function asCell(value: unknown): NotebookCell | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as NotebookCell)
    : undefined;
}

function cellIndex(cells: readonly unknown[], id: string): number {
  const byId = cells.findIndex((value) => {
    const storedId = asCell(value)?.id;
    return (
      storedId === id ||
      (typeof storedId === 'string' && storedId.replaceAll('"', '&quot;') === id)
    );
  });
  if (byId !== -1) return byId;
  const fallback = /^cell-(\d+)$/u.exec(id);
  if (fallback === null) return -1;
  const index = Number(fallback[1]);
  return Number.isSafeInteger(index) && index < cells.length ? index : -1;
}

function notebookSupportsCellIds(notebook: Notebook): boolean {
  const major = notebook['nbformat'];
  const minor = notebook['nbformat_minor'];
  return (
    typeof major === 'number' &&
    typeof minor === 'number' &&
    (major > 4 || (major === 4 && minor >= 5))
  );
}

function generatedCellId(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12);
}

function modifiedError(): ExecutableToolResult {
  return {
    isError: true,
    output: 'File has been modified since it was read. Read it again before editing.',
  };
}

export class NotebookEditTool implements BuiltinTool<NotebookEditInput> {
  readonly name = 'NotebookEdit' as const;
  readonly description = NOTEBOOK_EDIT_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(NotebookEditInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly readState: FileReadState,
    private readonly beforeWrite?: (path: string) => Promise<void>,
  ) {}

  resolveExecution(args: NotebookEditInput): ToolExecution {
    const path = resolvePathAccessPath(args.notebook_path, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'write',
    });
    const mode = args.edit_mode ?? 'replace';
    return {
      accesses: ToolAccesses.readWriteFile(path),
      description: `${mode === 'delete' ? 'Deleting' : mode === 'insert' ? 'Inserting' : 'Editing'} notebook cell`,
      display: {
        kind: 'file_io',
        operation: 'edit',
        path,
        detail: `${mode} ${args.cell_id ?? 'at beginning'}`,
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

  private async execution(
    args: NotebookEditInput,
    safePath: string,
  ): Promise<ExecutableToolResult> {
    if (!safePath.toLowerCase().endsWith('.ipynb')) {
      return {
        isError: true,
        output: 'NotebookEdit only supports .ipynb files. Use Edit for other files.',
      };
    }

    const mode = args.edit_mode ?? 'replace';
    if (mode === 'insert' && args.cell_type === undefined) {
      return { isError: true, output: 'cell_type is required when edit_mode is insert.' };
    }
    if (mode !== 'insert' && args.cell_id === undefined) {
      return {
        isError: true,
        output: 'cell_id is required when edit_mode is replace or delete.',
      };
    }

    const snapshot = this.readState.get(safePath);
    if (snapshot === undefined) {
      return {
        isError: true,
        output: 'File has not been read yet. Use Read before editing it.',
      };
    }
    if (snapshot.isPartialView === true) {
      return {
        isError: true,
        output: 'A complete Read is required before editing this notebook.',
      };
    }

    try {
      const mtimeBeforeRead = (await this.kaos.stat(safePath)).stMtime;
      if (mtimeBeforeRead !== snapshot.mtime) return modifiedError();

      const raw = await this.kaos.readText(safePath, { errors: 'strict' });
      if ((await this.kaos.stat(safePath)).stMtime !== mtimeBeforeRead) {
        return modifiedError();
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch (error) {
        return {
          isError: true,
          output: `Notebook is not valid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      const notebook = asNotebook(parsed);
      if (notebook === undefined) {
        return {
          isError: true,
          output: 'Notebook is not valid: cells must be an array.',
        };
      }

      const selectedIndex =
        args.cell_id === undefined ? 0 : cellIndex(notebook.cells, args.cell_id);
      if (args.cell_id !== undefined && selectedIndex === -1) {
        return {
          isError: true,
          output: `Cell "${args.cell_id}" was not found in the notebook.`,
        };
      }

      let resultCellId = args.cell_id;
      if (mode === 'delete') {
        notebook.cells.splice(selectedIndex, 1);
      } else if (mode === 'insert') {
        resultCellId = notebookSupportsCellIds(notebook) ? generatedCellId() : undefined;
        notebook.cells.splice(selectedIndex + (args.cell_id === undefined ? 0 : 1), 0, {
          cell_type: args.cell_type,
          id: resultCellId,
          source: args.new_source,
          metadata: {},
          execution_count: args.cell_type === 'code' ? null : undefined,
          outputs: args.cell_type === 'code' ? [] : undefined,
        });
      } else {
        const cell = asCell(notebook.cells[selectedIndex]);
        if (cell === undefined) {
          return {
            isError: true,
            output: `Cell "${args.cell_id ?? ''}" is not a valid notebook cell.`,
          };
        }
        const currentType = cell.cell_type;
        const targetType = args.cell_type ?? currentType;
        if (targetType !== 'code' && targetType !== 'markdown') {
          return {
            isError: true,
            output: `Cell "${args.cell_id ?? ''}" has unsupported type "${String(currentType)}".`,
          };
        }
        cell.source = args.new_source;
        cell.cell_type = targetType;
        if (targetType === 'code') {
          cell['execution_count'] = null;
          cell['outputs'] = [];
        } else {
          delete cell['execution_count'];
          delete cell['outputs'];
        }
      }

      const modelView = toModelTextView(raw);
      const updated = JSON.stringify(notebook, null, 1);
      await this.beforeWrite?.(safePath);
      await this.kaos.writeText(
        safePath,
        materializeModelText(updated, modelView.lineEndingStyle),
      );
      try {
        this.readState.set(safePath, {
          mtime: (await this.kaos.stat(safePath)).stMtime,
          range: 'notebook-edited',
          isPartialView: false,
        });
      } catch {
        this.readState.delete(safePath);
      }

      const verb = mode === 'delete' ? 'Deleted' : mode === 'insert' ? 'Inserted' : 'Updated';
      return {
        output: `${verb} notebook cell ${resultCellId ?? args.cell_id ?? 'at beginning'} in ${args.notebook_path}`,
      };
    } catch (error) {
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
