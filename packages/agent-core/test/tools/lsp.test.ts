import { PassThrough, Readable, Writable } from 'node:stream';

import type { KaosProcess } from '@pythoughts/kaos';
import { describe, expect, it, vi } from 'vitest';

import { LspManager } from '../../src/lsp';
import { LspInputSchema, LspTool, type LspInput } from '../../src/tools/builtin/lsp';
import { createFakeKaos, toolContentString } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

function context(args: LspInput) {
  return {
    turnId: '0',
    toolCallId: 'call_lsp',
    args,
    signal: new AbortController().signal,
  };
}

function fakeLanguageServer(
  respond: (message: Record<string, unknown>) => unknown,
): {
  process: KaosProcess;
  messages: Array<Record<string, unknown>>;
  notify: (method: string, params: unknown) => void;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const messages: Array<Record<string, unknown>> = [];
  let input = Buffer.alloc(0);
  let resolveWait: (code: number) => void = () => {};
  const wait = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  const writeMessage = (message: Record<string, unknown>): void => {
    const payload = Buffer.from(JSON.stringify(message), 'utf8');
    stdout.write(`Content-Length: ${String(payload.length)}\r\n\r\n`);
    stdout.write(payload);
  };

  const stdin = new Writable({
    write(chunk, _encoding, done) {
      input = Buffer.concat([input, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      while (true) {
        const separator = input.indexOf('\r\n\r\n');
        if (separator < 0) break;
        const header = input.subarray(0, separator).toString('ascii');
        const length = Number(/Content-Length:\s*(\d+)/iu.exec(header)?.[1] ?? -1);
        if (length < 0 || input.length < separator + 4 + length) break;
        const body = input.subarray(separator + 4, separator + 4 + length);
        input = input.subarray(separator + 4 + length);
        const message = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
        messages.push(message);
        if (message['method'] === 'exit') {
          stdout.end();
          stderr.end();
          resolveWait(0);
          continue;
        }
        if (message['id'] === undefined) continue;
        let response: Record<string, unknown>;
        try {
          response = { result: respond(message) };
        } catch (error) {
          response = {
            error: {
              code: (error as { code?: unknown }).code,
              message: error instanceof Error ? error.message : String(error),
            },
          };
        }
        writeMessage({ jsonrpc: '2.0', id: message['id'], ...response });
      }
      done();
    },
  });

  return {
    process: {
      stdin,
      stdout,
      stderr,
      pid: 321,
      exitCode: null,
      wait: vi.fn(async () => wait),
      kill: vi.fn(async () => {
        stdout.end();
        stderr.end();
        resolveWait(143);
      }),
      dispose: vi.fn(async () => {
        stdin.destroy();
        stdout.destroy();
        stderr.destroy();
      }),
    },
    messages,
    notify: (method, params) => {
      writeMessage({ jsonrpc: '2.0', method, params });
    },
  };
}

function completedProcess(stdout: string, exitCode = 0): KaosProcess {
  return {
    stdin: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
    stdout: Readable.from([stdout]),
    stderr: Readable.from([]),
    pid: 654,
    exitCode,
    wait: vi.fn().mockResolvedValue(exitCode),
    kill: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

describe('LspTool', () => {
  it('restarts configured servers when the workspace root changes', async () => {
    const respond = (message: Record<string, unknown>): unknown => {
      if (message['method'] === 'initialize') return { capabilities: {} };
      if (message['method'] === 'textDocument/hover') return { contents: 'hover' };
      if (message['method'] === 'shutdown') return null;
      throw new Error(`Unexpected LSP request: ${String(message['method'])}`);
    };
    const firstServer = fakeLanguageServer(respond);
    const secondServer = fakeLanguageServer(respond);
    const kaos = createFakeKaos({
      execWithEnv: vi
        .fn()
        .mockResolvedValueOnce(firstServer.process)
        .mockResolvedValueOnce(secondServer.process),
    });
    const manager = new LspManager(kaos, '/workspace', {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    });

    await manager.request('/workspace/src/example.ts', 'textDocument/hover', {});
    await manager.rebindRoot('/workspace/.worktrees/feature');
    await manager.request(
      '/workspace/.worktrees/feature/src/example.ts',
      'textDocument/hover',
      {},
    );

    expect(initializeRoot(firstServer.messages)).toBe('/workspace');
    expect(initializeRoot(secondServer.messages)).toBe('/workspace/.worktrees/feature');
    await manager.shutdown();
  });

  it('collects new passive diagnostics for the next model step', async () => {
    const server = fakeLanguageServer((message) => {
      if (message['method'] === 'initialize') return { capabilities: {} };
      if (message['method'] === 'shutdown') return null;
      throw new Error(`Unexpected LSP request: ${String(message['method'])}`);
    });
    const manager = new LspManager(
      createFakeKaos({ execWithEnv: vi.fn().mockResolvedValue(server.process) }),
      '/workspace',
      {
        typescript: {
          command: 'typescript-language-server',
          extensionToLanguage: { '.ts': 'typescript' },
        },
      },
    );
    await manager.openFile('/workspace/src/example.ts', 'const answer = 42;\n');

    server.notify('textDocument/publishDiagnostics', {
      uri: 'file:///workspace/src/example.ts',
      diagnostics: [
        {
          message: 'Missing semicolon',
          severity: 2,
          source: 'typescript',
          code: 1005,
          range: {
            start: { line: 0, character: 17 },
            end: { line: 0, character: 18 },
          },
        },
      ],
    });

    expect(manager.drainDiagnostics()).toContain(
      'Warning /workspace/src/example.ts:1:18 [typescript 1005] Missing semicolon',
    );
    expect(manager.drainDiagnostics()).toBeUndefined();
    await manager.shutdown();
  });

  it('retries transient content-modified responses', async () => {
    let hoverAttempts = 0;
    const server = fakeLanguageServer((message) => {
      if (message['method'] === 'initialize') return { capabilities: {} };
      if (message['method'] === 'textDocument/hover') {
        hoverAttempts += 1;
        if (hoverAttempts === 1) {
          const error = new Error('content modified') as Error & { code: number };
          error.code = -32801;
          throw error;
        }
        return { contents: 'stable hover result' };
      }
      if (message['method'] === 'shutdown') return null;
      throw new Error(`Unexpected LSP request: ${String(message['method'])}`);
    });
    const kaos = createFakeKaos({
      execWithEnv: vi.fn().mockResolvedValue(server.process),
      readText: vi.fn().mockResolvedValue('const answer = 42;\n'),
      stat: vi.fn().mockResolvedValue({
        stMode: 0o100644,
        stIno: 1,
        stDev: 1,
        stNlink: 1,
        stUid: 1,
        stGid: 1,
        stSize: 19,
        stAtime: 0,
        stMtime: 0,
        stCtime: 0,
      }),
    });
    const manager = new LspManager(kaos, '/workspace', {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    });
    const tool = new LspTool(kaos, { workspaceDir: '/workspace', additionalDirs: [] }, manager);

    const result = await executeTool(
      tool,
      context({
        operation: 'hover',
        filePath: 'src/example.ts',
        line: 1,
        character: 7,
      }),
    );

    expect(result.isError).toBe(false);
    expect(toolContentString(result)).toContain('stable hover result');
    expect(hoverAttempts).toBe(2);
    await manager.shutdown();
  });

  it('uses 1-based input, opens the file, and returns hover information', async () => {
    const server = fakeLanguageServer((message) => {
      if (message['method'] === 'initialize') return { capabilities: {} };
      if (message['method'] === 'textDocument/hover') {
        return { contents: { kind: 'markdown', value: '`const answer: number`' } };
      }
      if (message['method'] === 'shutdown') return null;
      throw new Error(`Unexpected LSP request: ${String(message['method'])}`);
    });
    const kaos = createFakeKaos({
      execWithEnv: vi.fn().mockResolvedValue(server.process),
      readText: vi.fn().mockResolvedValue('const answer = 42;\n'),
      stat: vi.fn().mockResolvedValue({
        stMode: 0o100644,
        stIno: 1,
        stDev: 1,
        stNlink: 1,
        stUid: 1,
        stGid: 1,
        stSize: 19,
        stAtime: 0,
        stMtime: 0,
        stCtime: 0,
      }),
    });
    const manager = new LspManager(kaos, '/workspace', {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    });
    const tool = new LspTool(kaos, { workspaceDir: '/workspace', additionalDirs: [] }, manager);

    const result = await executeTool(
      tool,
      context({
        operation: 'hover',
        filePath: 'src/example.ts',
        line: 1,
        character: 7,
      }),
    );

    expect(tool.name).toBe('LSP');
    expect(toolContentString(result)).toContain('const answer: number');
    expect(server.messages).toContainEqual(
      expect.objectContaining({
        method: 'textDocument/didOpen',
        params: expect.objectContaining({
          textDocument: expect.objectContaining({
            uri: 'file:///workspace/src/example.ts',
            languageId: 'typescript',
          }),
        }),
      }),
    );
    expect(server.messages).toContainEqual(
      expect.objectContaining({
        method: 'textDocument/hover',
        params: {
          textDocument: { uri: 'file:///workspace/src/example.ts' },
          position: { line: 0, character: 6 },
        },
      }),
    );

    await manager.shutdown();
  });

  it('filters gitignored files from location results', async () => {
    const server = fakeLanguageServer((message) => {
      if (message['method'] === 'initialize') return { capabilities: {} };
      if (message['method'] === 'textDocument/references') {
        return ['source.ts', 'generated.ts'].map((name) => ({
          uri: `file:///workspace/src/${name}`,
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        }));
      }
      if (message['method'] === 'shutdown') return null;
      throw new Error(`Unexpected LSP request: ${String(message['method'])}`);
    });
    const exec = vi.fn().mockResolvedValue(completedProcess('src/generated.ts\0'));
    const kaos = createFakeKaos({
      exec,
      execWithEnv: vi.fn().mockResolvedValue(server.process),
      readText: vi.fn().mockResolvedValue('const source = true;\n'),
      stat: vi.fn().mockResolvedValue({
        stMode: 0o100644,
        stIno: 1,
        stDev: 1,
        stNlink: 1,
        stUid: 1,
        stGid: 1,
        stSize: 21,
        stAtime: 0,
        stMtime: 0,
        stCtime: 0,
      }),
    });
    const manager = new LspManager(kaos, '/workspace', {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    });
    const tool = new LspTool(kaos, { workspaceDir: '/workspace', additionalDirs: [] }, manager);

    const result = await executeTool(
      tool,
      context({
        operation: 'findReferences',
        filePath: 'src/source.ts',
        line: 1,
        character: 1,
      }),
    );

    expect(toolContentString(result)).toContain('src/source.ts:1:1');
    expect(toolContentString(result)).not.toContain('src/generated.ts');
    expect(exec).toHaveBeenCalledWith(
      'git',
      '-C',
      '/workspace',
      'check-ignore',
      '-z',
      '--',
      'src/source.ts',
      'src/generated.ts',
    );
    await manager.shutdown();
  });

  it('validates positions and reports an unconfigured file type without spawning', async () => {
    const execWithEnv = vi.fn();
    const kaos = createFakeKaos({
      execWithEnv,
      readText: vi.fn().mockResolvedValue('package demo\n'),
      stat: vi.fn().mockResolvedValue({
        stMode: 0o100644,
        stIno: 1,
        stDev: 1,
        stNlink: 1,
        stUid: 1,
        stGid: 1,
        stSize: 13,
        stAtime: 0,
        stMtime: 0,
        stCtime: 0,
      }),
    });
    const manager = new LspManager(kaos, '/workspace', {});
    const tool = new LspTool(kaos, { workspaceDir: '/workspace', additionalDirs: [] }, manager);

    expect(
      LspInputSchema.safeParse({
        operation: 'hover',
        filePath: 'main.go',
        line: 0,
        character: 1,
      }).success,
    ).toBe(false);
    const result = await executeTool(
      tool,
      context({ operation: 'goToDefinition', filePath: 'main.go', line: 1, character: 1 }),
    );

    expect(toolContentString(result)).toContain('No LSP server configured for .go files');
    expect(execWithEnv).not.toHaveBeenCalled();
  });

  it('prepares a call hierarchy before requesting incoming calls', async () => {
    const item = {
      name: 'callee',
      uri: 'file:///workspace/src/example.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
    };
    const server = fakeLanguageServer((message) => {
      if (message['method'] === 'initialize') return { capabilities: {} };
      if (message['method'] === 'textDocument/prepareCallHierarchy') return [item];
      if (message['method'] === 'callHierarchy/incomingCalls') {
        return [
          {
            from: {
              ...item,
              name: 'caller',
              uri: 'file:///workspace/src/caller.ts',
              selectionRange: {
                start: { line: 2, character: 1 },
                end: { line: 2, character: 7 },
              },
            },
            fromRanges: [],
          },
        ];
      }
      if (message['method'] === 'shutdown') return null;
      throw new Error(`Unexpected LSP request: ${String(message['method'])}`);
    });
    const kaos = createFakeKaos({
      execWithEnv: vi.fn().mockResolvedValue(server.process),
      readText: vi.fn().mockResolvedValue('function callee() {}\n'),
      stat: vi.fn().mockResolvedValue({
        stMode: 0o100644,
        stIno: 1,
        stDev: 1,
        stNlink: 1,
        stUid: 1,
        stGid: 1,
        stSize: 21,
        stAtime: 0,
        stMtime: 0,
        stCtime: 0,
      }),
    });
    const manager = new LspManager(kaos, '/workspace', {
      typescript: {
        command: 'typescript-language-server',
        args: ['--stdio'],
        extensionToLanguage: { '.ts': 'typescript' },
      },
    });
    const tool = new LspTool(kaos, { workspaceDir: '/workspace', additionalDirs: [] }, manager);

    const result = await executeTool(
      tool,
      context({
        operation: 'incomingCalls',
        filePath: 'src/example.ts',
        line: 1,
        character: 1,
      }),
    );

    expect(toolContentString(result)).toContain('caller - src/caller.ts:3:2');
    expect(
      server.messages.filter((message) =>
        ['textDocument/prepareCallHierarchy', 'callHierarchy/incomingCalls'].includes(
          String(message['method']),
        ),
      ),
    ).toEqual([
      expect.objectContaining({ method: 'textDocument/prepareCallHierarchy' }),
      expect.objectContaining({
        method: 'callHierarchy/incomingCalls',
        params: { item },
      }),
    ]);

    await manager.shutdown();
  });
});

function initializeRoot(messages: Array<Record<string, unknown>>): unknown {
  const initialize = messages.find((message) => message['method'] === 'initialize');
  return (initialize?.['params'] as Record<string, unknown> | undefined)?.['rootPath'];
}
