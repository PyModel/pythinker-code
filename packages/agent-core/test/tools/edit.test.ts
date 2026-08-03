import { describe, expect, it, vi } from 'vitest';

import { type EditInput, EditInputSchema, EditTool } from '../../src/tools/builtin/file/edit';
import type { FileReadState } from '../../src/tools/builtin/file/read';
import { createFakeKaos, PERMISSIVE_WORKSPACE } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function context(args: EditInput) {
  return { turnId: '0', toolCallId: 'call_edit', args, signal };
}

describe('EditTool', () => {
  it('exposes before/after on the file_io display so the approval panel can render a diff', () => {
    const tool = new EditTool(createFakeKaos(), PERMISSIVE_WORKSPACE);
    const execution = tool.resolveExecution({
      path: '/tmp/foo.ts',
      old_string: 'a\nb\nc',
      new_string: 'a\nB\nc',
    });
    if (execution.isError === true) {
      throw new TypeError('expected runnable execution');
    }
    expect(execution.display).toEqual({
      kind: 'file_io',
      operation: 'edit',
      path: '/tmp/foo.ts',
      before: 'a\nb\nc',
      after: 'a\nB\nc',
    });
  });

  it('exposes current metadata and schema', () => {
    const tool = new EditTool(createFakeKaos(), PERMISSIVE_WORKSPACE);

    expect(tool.name).toBe('Edit');
    expect(tool.description).toContain('Read the target file before every Edit');
    expect(tool.description).toContain('DO NOT call Edit from memory');
    expect(tool.description).toContain('Read output view');
    expect(tool.description).toContain('line-number prefix');
    expect(tool.description).toContain('`old_string` must be unique');
    expect(tool.description).toContain('only when they do not target the same file');
    expect(tool.description).toContain('DO NOT issue consecutive Edit calls on the same file');
    // Editing files should go through Edit, not Write and not a Bash `sed`
    // command. The prompt names both alternatives explicitly.
    expect(tool.description).toContain('DO NOT use Write or Bash `sed`');
    // Parallel Edit calls on the same file are serialized and applied in
    // response order; mismatched old_string fails explicitly.
    expect(tool.description).toContain('same-file edits in response order');
    expect(tool.description).toContain('old_string not found');
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: expect.stringContaining('working directory'),
        },
        old_string: {
          type: 'string',
          description: expect.stringContaining('without the line-number prefix'),
        },
        new_string: {
          type: 'string',
          description: expect.stringContaining('same Read output view'),
        },
      },
    });
    expect(
      EditInputSchema.safeParse({
        path: '/tmp/a.txt',
        old_string: 'old',
        new_string: 'new',
      }).success,
    ).toBe(true);
    expect(
      EditInputSchema.safeParse({
        path: '/tmp/a.txt',
        old_string: '',
        new_string: 'new',
      }).success,
    ).toBe(false);
  });

  it('replaces a unique first occurrence and writes the updated content', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha beta'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'beta', new_string: 'gamma' }),
    );

    expect(result.output).toContain('Replaced 1 occurrence');
    expect(writeText).toHaveBeenCalledWith('/tmp/a.txt', 'alpha gamma');
  });

  it('captures the safe path after validation and immediately before writing', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const beforeWrite = vi.fn(async (path: string) => {
      expect(path).toBe('/tmp/a.txt');
      expect(writeText).not.toHaveBeenCalled();
    });
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha beta'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
      undefined,
      beforeWrite,
    );

    await executeTool(
      tool,
      context({ path: '/tmp/a.txt', old_string: 'beta', new_string: 'gamma' }),
    );

    expect(beforeWrite).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledOnce();
  });

  it('requires a prior Read when shared read state is enabled', async () => {
    const readText = vi.fn().mockResolvedValue('alpha beta');
    const tool = new EditTool(
      createFakeKaos({ readText, writeText: vi.fn() }),
      PERMISSIVE_WORKSPACE,
      new Map(),
    );

    const result = await executeTool(
      tool,
      context({ path: '/tmp/a.txt', old_string: 'beta', new_string: 'gamma' }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('has not been read');
    expect(readText).not.toHaveBeenCalled();
  });

  it('does not capture when old_string is missing', async () => {
    const beforeWrite = vi.fn();
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha beta'),
        writeText: vi.fn(),
      }),
      PERMISSIVE_WORKSPACE,
      undefined,
      beforeWrite,
    );

    await executeTool(
      tool,
      context({ path: '/tmp/a.txt', old_string: 'missing', new_string: 'gamma' }),
    );

    expect(beforeWrite).not.toHaveBeenCalled();
  });

  it('rejects an edit when the file mtime changed after Read', async () => {
    const state: FileReadState = new Map([
      ['/tmp/a.txt', { mtime: 1, range: '1:1000' }],
    ]);
    const readText = vi.fn().mockResolvedValue('alpha beta');
    const tool = new EditTool(
      createFakeKaos({
        stat: vi.fn().mockResolvedValue({ stMtime: 2 }),
        readText,
        writeText: vi.fn(),
      }),
      PERMISSIVE_WORKSPACE,
      state,
    );

    const result = await executeTool(
      tool,
      context({ path: '/tmp/a.txt', old_string: 'beta', new_string: 'gamma' }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('modified since it was read');
    expect(readText).not.toHaveBeenCalled();
  });

  it('rejects an edit after a partial Read', async () => {
    const state: FileReadState = new Map([
      ['/tmp/a.txt', { mtime: 1, range: '2:1', isPartialView: true }],
    ]);
    const readText = vi.fn().mockResolvedValue('alpha beta');
    const tool = new EditTool(
      createFakeKaos({ readText, writeText: vi.fn() }),
      PERMISSIVE_WORKSPACE,
      state,
    );

    const result = await executeTool(
      tool,
      context({ path: '/tmp/a.txt', old_string: 'beta', new_string: 'gamma' }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('complete Read');
    expect(readText).not.toHaveBeenCalled();
  });

  it('matches straight quotes against curly file quotes and preserves their style', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('He said “hello”.'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(
      tool,
      context({
        path: '/tmp/quotes.txt',
        old_string: '"hello"',
        new_string: '"goodbye"',
      }),
    );

    expect(result.isError).toBeFalsy();
    expect(writeText).toHaveBeenCalledWith('/tmp/quotes.txt', 'He said “goodbye”.');
  });

  it('removes the following newline when deleting a whole line', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha\nbeta\n'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(
      tool,
      context({ path: '/tmp/lines.txt', old_string: 'alpha', new_string: '' }),
    );

    expect(result.isError).toBeFalsy();
    expect(writeText).toHaveBeenCalledWith('/tmp/lines.txt', 'beta\n');
  });

  it('directs notebook edits to NotebookEdit', async () => {
    const readText = vi.fn();
    const tool = new EditTool(
      createFakeKaos({ readText, writeText: vi.fn() }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(
      tool,
      context({ path: '/tmp/demo.ipynb', old_string: 'old', new_string: 'new' }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('NotebookEdit');
    expect(readText).not.toHaveBeenCalled();
  });

  it('expands leading tilde paths using the kaos home directory', async () => {
    const readText = vi.fn().mockResolvedValue('alpha beta');
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(createFakeKaos({ readText, writeText }), PERMISSIVE_WORKSPACE);

    const result = await executeTool(tool,
      context({ path: '~/notes/today.txt', old_string: 'beta', new_string: 'gamma' }),
    );

    expect(result.output).toContain('Replaced 1 occurrence');
    expect(readText).toHaveBeenCalledWith('/home/test/notes/today.txt');
    expect(writeText).toHaveBeenCalledWith('/home/test/notes/today.txt', 'alpha gamma');
  });

  it('treats replacement dollar sequences literally for single edits', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha beta gamma'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'beta', new_string: "$& $$ $` $'" }),
    );

    expect(result.output).toContain('Replaced 1 occurrence');
    expect(writeText).toHaveBeenCalledWith('/tmp/a.txt', "alpha $& $$ $` $' gamma");
  });

  it('treats replacement dollar sequences literally for replace_all edits', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('a b a'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'a', new_string: '$&', replace_all: true }),
    );

    expect(result.output).toContain('Replaced 2 occurrences');
    expect(writeText).toHaveBeenCalledWith('/tmp/a.txt', '$& b $&');
  });

  it('matches pure CRLF files through the LF model view and writes back CRLF', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha\r\nbeta\r\ngamma\r\n'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'alpha\nbeta', new_string: 'one\ntwo' }),
    );

    expect(result.output).toContain('Replaced 1 occurrence');
    expect(writeText).toHaveBeenCalledWith('/tmp/a.txt', 'one\r\ntwo\r\ngamma\r\n');
  });

  it('does not double carriage returns when editing pure CRLF files', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha\r\nbeta\r\n'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'alpha\nbeta', new_string: 'one\r\ntwo' }),
    );

    expect(result.output).toContain('Replaced 1 occurrence');
    expect(writeText).toHaveBeenCalledWith('/tmp/a.txt', 'one\r\ntwo\r\n');
  });

  it('keeps mixed line ending files on the raw exact path', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha\r\nbeta\ngamma\r\n'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'alpha\nbeta', new_string: 'one\ntwo' }),
    );

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('old_string not found');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('allows exact raw edits in mixed line ending files without normalizing the rest', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha\r\nbeta\ngamma\r\n'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'alpha\r\nbeta', new_string: 'one\r\ntwo' }),
    );

    expect(result.output).toContain('Replaced 1 occurrence');
    expect(writeText).toHaveBeenCalledWith('/tmp/a.txt', 'one\r\ntwo\ngamma\r\n');
  });

  it('replace_all replaces every occurrence', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('a b a'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'a', new_string: 'x', replace_all: true }),
    );

    expect(result.output).toContain('Replaced 2 occurrences');
    expect(writeText).toHaveBeenCalledWith('/tmp/a.txt', 'x b x');
  });

  it('rejects no-op edits before file I/O', async () => {
    const readText = vi.fn().mockResolvedValue('same');
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(createFakeKaos({ readText, writeText }), PERMISSIVE_WORKSPACE);

    const result = await executeTool(tool,
      context({
        path: '/tmp/a.txt',
        old_string: 'same',
        new_string: 'same',
        replace_all: true,
      }),
    );

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('No changes to make');
    expect(readText).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('errors when old_string is missing', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('alpha beta'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'delta', new_string: 'gamma' }),
    );

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('old_string not found');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('errors when old_string is not unique and replace_all is false', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('same same'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/a.txt', old_string: 'same', new_string: 'other' }),
    );

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('not unique');
    expect(result.output).toContain('set replace_all=true');
    expect(result.output).toContain('include more surrounding context');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('rejects relative traversal edits before reading', async () => {
    const readText = vi.fn().mockResolvedValue('secret');
    const tool = new EditTool(createFakeKaos({ readText }), {
      workspaceDir: '/workspace/project',
      additionalDirs: [],
    });

    const result = await executeTool(tool,
      context({ path: '../outside.txt', old_string: 'secret', new_string: 'x' }),
    );

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('absolute path');
    expect(readText).not.toHaveBeenCalled();
  });

  it('replaces unicode strings (CJK) and round-trips the surrounding text', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('Hello world! café'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/u.txt', old_string: 'world', new_string: 'earth' }),
    );

    expect(result.output).toContain('Replaced 1 occurrence');
    expect(writeText).toHaveBeenCalledWith('/tmp/u.txt', 'Hello earth! café');
  });

  it('leaves the file byte-identical when old_string is not present', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const original = 'Hello world!';
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue(original),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/n.txt', old_string: 'notfound', new_string: 'replacement' }),
    );

    expect(result.isError).toBe(true);
    // Lockdown the negative side-effect: no write should have been issued.
    expect(writeText).not.toHaveBeenCalled();
  });

  it('errors with an is-not-a-file phrasing when the path resolves to a directory', async () => {
    // py wording is "is not a file"; TS currently relies on readText to fail.
    // fake-kaos's notImplemented() defaults make this surface a generic
    // readText error today — fail-divergent until the path-type check moves
    // upstream of read.
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockRejectedValue(
          Object.assign(new Error('EISDIR: illegal operation on a directory'), {
            code: 'EISDIR',
          }),
        ),
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/dir', old_string: 'old', new_string: 'new' }),
    );

    expect(result.isError).toBe(true);
    expect(result.output).toContain('is not a file');
  });

  it('replaces a substring with an empty new_string (deletion)', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('Hello world!'),
        writeText,
      }),
      PERMISSIVE_WORKSPACE,
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/e.txt', old_string: 'world', new_string: '' }),
    );

    expect(result.output).toContain('Replaced 1 occurrence');
    expect(writeText).toHaveBeenCalledWith('/tmp/e.txt', 'Hello !');
  });

  it('allows absolute edits outside the workspace under default policy', async () => {
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('old content'),
        writeText,
      }),
      { workspaceDir: '/workspace', additionalDirs: [] },
    );

    const result = await executeTool(tool,
      context({ path: '/tmp/outside.txt', old_string: 'old', new_string: 'new' }),
    );

    expect(result.isError).toBeFalsy();
    expect(writeText).toHaveBeenCalledWith('/tmp/outside.txt', 'new content');
  });

  it('allows absolute edits to a sibling dir that merely shares the work-dir prefix', async () => {
    // /workspace-sneaky/* is outside /workspace — string prefix check must not
    // mistake "shares a prefix" for "inside workspace".
    const writeText = vi.fn().mockResolvedValue(0);
    const tool = new EditTool(
      createFakeKaos({
        readText: vi.fn().mockResolvedValue('content'),
        writeText,
      }),
      { workspaceDir: '/workspace', additionalDirs: [] },
    );

    const result = await executeTool(tool,
      context({ path: '/workspace-sneaky/test.txt', old_string: 'content', new_string: 'new' }),
    );

    expect(result.isError).toBeFalsy();
    expect(writeText).toHaveBeenCalledWith('/workspace-sneaky/test.txt', 'new');
  });
});
