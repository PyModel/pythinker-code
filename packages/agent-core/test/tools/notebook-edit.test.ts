import type { Kaos } from '@pymodel/kaos';
import { describe, expect, it, vi } from 'vitest';

import {
  type NotebookEditInput,
  NotebookEditInputSchema,
  NotebookEditTool,
} from '../../src/tools/builtin/file/notebook-edit';
import type { FileReadState } from '../../src/tools/builtin/file/read';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function context(args: NotebookEditInput) {
  return { turnId: '0', toolCallId: 'call_notebook_edit', args, signal };
}

function notebook(cells: readonly Record<string, unknown>[], minor = 5): string {
  return JSON.stringify({
    cells,
    metadata: { language_info: { name: 'python' } },
    nbformat: 4,
    nbformat_minor: minor,
  });
}

function state(): FileReadState {
  return new Map([
    ['/tmp/demo.ipynb', { mtime: 1, range: '1:1000', isPartialView: false }],
  ]);
}

function kaosFor(content: string, writeText = vi.fn<Kaos['writeText']>().mockResolvedValue(0)) {
  return {
    kaos: createFakeKaos({
      stat: vi
        .fn<Kaos['stat']>()
        .mockResolvedValueOnce({ stMtime: 1 } as Awaited<ReturnType<Kaos['stat']>>)
        .mockResolvedValueOnce({ stMtime: 1 } as Awaited<ReturnType<Kaos['stat']>>)
        .mockResolvedValue({ stMtime: 2 } as Awaited<ReturnType<Kaos['stat']>>),
      readText: vi.fn<Kaos['readText']>().mockResolvedValue(content),
      writeText,
    }),
    writeText,
  };
}

describe('NotebookEditTool', () => {
  it('exposes the cell edit contract', () => {
    const tool = new NotebookEditTool(createFakeKaos(), PERMISSIVE_WORKSPACE, new Map());

    expect(tool.name).toBe('NotebookEdit');
    expect(tool.description).toContain('Read');
    expect(tool.description).toContain('cell_id');
    expect(
      NotebookEditInputSchema.safeParse({
        notebook_path: '/tmp/demo.ipynb',
        cell_id: 'cell-0',
        new_source: 'print("ok")',
      }).success,
    ).toBe(true);
    expect(
      NotebookEditInputSchema.safeParse({
        notebook_path: '/tmp/demo.txt',
        new_source: '',
        edit_mode: 'unknown',
      }).success,
    ).toBe(false);
  });

  it('requires a prior Read', async () => {
    const readText = vi.fn<Kaos['readText']>();
    const tool = new NotebookEditTool(
      createFakeKaos({ readText }),
      PERMISSIVE_WORKSPACE,
      new Map(),
    );

    const result = await executeTool(
      tool,
      context({
        notebook_path: '/tmp/demo.ipynb',
        cell_id: 'cell-0',
        new_source: 'changed',
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('has not been read');
    expect(readText).not.toHaveBeenCalled();
  });

  it('replaces a cell by ID and clears stale code outputs', async () => {
    const raw = notebook([
      {
        id: 'intro',
        cell_type: 'code',
        source: 'print("old")',
        metadata: { trusted: true },
        execution_count: 7,
        outputs: [{ output_type: 'stream', text: 'old' }],
      },
    ]);
    const { kaos, writeText } = kaosFor(raw);
    const tool = new NotebookEditTool(kaos, PERMISSIVE_WORKSPACE, state());

    const result = await executeTool(
      tool,
      context({
        notebook_path: '/tmp/demo.ipynb',
        cell_id: 'intro',
        new_source: 'print("new")',
      }),
    );

    expect(result.isError).toBeFalsy();
    const written = writeText.mock.calls[0]?.[1];
    expect(typeof written).toBe('string');
    const parsed = JSON.parse(String(written)) as {
      cells: Array<Record<string, unknown>>;
    };
    expect(parsed.cells[0]).toMatchObject({
      id: 'intro',
      cell_type: 'code',
      source: 'print("new")',
      metadata: { trusted: true },
      execution_count: null,
      outputs: [],
    });
  });

  it('captures the safe path after notebook validation and immediately before writing', async () => {
    const raw = notebook([
      { id: 'intro', cell_type: 'markdown', source: 'old', metadata: {} },
    ]);
    const { kaos, writeText } = kaosFor(raw);
    const beforeWrite = vi.fn(async (path: string) => {
      expect(path).toBe('/tmp/demo.ipynb');
      expect(writeText).not.toHaveBeenCalled();
    });
    const tool = new NotebookEditTool(
      kaos,
      PERMISSIVE_WORKSPACE,
      state(),
      beforeWrite,
    );

    await executeTool(
      tool,
      context({
        notebook_path: '/tmp/demo.ipynb',
        cell_id: 'intro',
        new_source: 'new',
      }),
    );

    expect(beforeWrite).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it('resolves Read fallback IDs and deletes the selected cell', async () => {
    const raw = notebook(
      [
        { cell_type: 'markdown', source: 'first', metadata: {} },
        { cell_type: 'markdown', source: 'second', metadata: {} },
      ],
      4,
    );
    const { kaos, writeText } = kaosFor(raw);
    const tool = new NotebookEditTool(kaos, PERMISSIVE_WORKSPACE, state());

    const result = await executeTool(
      tool,
      context({
        notebook_path: '/tmp/demo.ipynb',
        cell_id: 'cell-0',
        new_source: '',
        edit_mode: 'delete',
      }),
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(String(writeText.mock.calls[0]?.[1])) as {
      cells: Array<Record<string, unknown>>;
    };
    expect(parsed.cells).toHaveLength(1);
    expect(parsed.cells[0]?.['source']).toBe('second');
  });

  it('inserts after a selected cell and generates an ID for notebook 4.5+', async () => {
    const raw = notebook([
      { id: 'first', cell_type: 'markdown', source: 'first', metadata: {} },
    ]);
    const { kaos, writeText } = kaosFor(raw);
    const tool = new NotebookEditTool(kaos, PERMISSIVE_WORKSPACE, state());

    const result = await executeTool(
      tool,
      context({
        notebook_path: '/tmp/demo.ipynb',
        cell_id: 'first',
        new_source: 'print("next")',
        cell_type: 'code',
        edit_mode: 'insert',
      }),
    );

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(String(writeText.mock.calls[0]?.[1])) as {
      cells: Array<Record<string, unknown>>;
    };
    expect(parsed.cells[1]).toMatchObject({
      cell_type: 'code',
      source: 'print("next")',
      metadata: {},
      execution_count: null,
      outputs: [],
    });
    expect(parsed.cells[1]?.['id']).toMatch(/^[0-9a-f]{12}$/u);
  });

  it('rejects stale notebooks and missing cells without writing', async () => {
    const writeText = vi.fn<Kaos['writeText']>();
    const raw = notebook([{ id: 'only', cell_type: 'markdown', source: 'text' }]);
    const tool = new NotebookEditTool(
      createFakeKaos({
        stat: vi
          .fn<Kaos['stat']>()
          .mockResolvedValue({ stMtime: 2 } as Awaited<ReturnType<Kaos['stat']>>),
        readText: vi.fn<Kaos['readText']>().mockResolvedValue(raw),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
      state(),
    );

    const stale = await executeTool(
      tool,
      context({
        notebook_path: '/tmp/demo.ipynb',
        cell_id: 'only',
        new_source: 'changed',
      }),
    );

    expect(stale.isError).toBe(true);
    expect(stale.output).toContain('modified since it was read');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does not capture when the selected cell is missing', async () => {
    const raw = notebook([{ id: 'only', cell_type: 'markdown', source: 'text' }]);
    const beforeWrite = vi.fn();
    const { kaos } = kaosFor(raw);
    const tool = new NotebookEditTool(
      kaos,
      PERMISSIVE_WORKSPACE,
      state(),
      beforeWrite,
    );

    await executeTool(
      tool,
      context({
        notebook_path: '/tmp/demo.ipynb',
        cell_id: 'missing',
        new_source: 'changed',
      }),
    );

    expect(beforeWrite).not.toHaveBeenCalled();
  });
});
