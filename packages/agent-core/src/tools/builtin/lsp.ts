import { posix, win32 } from 'node:path';

import type { Kaos } from '@pythoughts/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../agent/tool';
import { fileUri, type LspManager } from '../../lsp';
import { ToolAccesses } from '../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../loop/types';
import { runGitCommand } from '../../session/git-context';
import { resolvePathAccessPath } from '../policies/path-access';
import { toInputJsonSchema } from '../support/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '../support/rule-match';
import { ToolResultBuilder } from '../support/result-builder';
import type { WorkspaceConfig } from '../support/workspace';

const OPERATIONS = [
  'goToDefinition',
  'findReferences',
  'hover',
  'documentSymbol',
  'workspaceSymbol',
  'goToImplementation',
  'prepareCallHierarchy',
  'incomingCalls',
  'outgoingCalls',
] as const;

const MAX_LSP_FILE_BYTES = 10_000_000;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

export const LspInputSchema = z
  .object({
    operation: z.enum(OPERATIONS).describe('The code-intelligence operation to perform.'),
    filePath: z.string().min(1).describe('Absolute or workspace-relative source file path.'),
    line: z.number().int().positive().describe('One-based editor line number.'),
    character: z.number().int().positive().describe('One-based editor character offset.'),
  })
  .strict();

export type LspInput = z.infer<typeof LspInputSchema>;

const DESCRIPTION = `Interact with configured Language Server Protocol servers.

Supported operations: ${OPERATIONS.join(', ')}.
All positions are 1-based, matching editor line and character positions. The source file must exist and have a configured plugin LSP server.`;

export class LspTool implements BuiltinTool<LspInput> {
  readonly name = 'LSP' as const;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LspInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly manager: LspManager,
  ) {}

  resolveExecution(args: LspInput): ToolExecution {
    if (this.kaos.pathClass() === 'win32' && /^(?:\\\\|\/\/)/u.test(args.filePath)) {
      throw new Error('LSP refuses UNC paths to avoid sending credentials to a remote share');
    }
    const filePath = resolvePathAccessPath(args.filePath, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'read',
    });
    return {
      accesses: ToolAccesses.readFile(filePath),
      description: `${operationLabel(args.operation)} ${args.filePath}:${String(args.line)}:${String(args.character)}`,
      display: {
        kind: 'generic',
        summary: `${operationLabel(args.operation)} ${args.filePath}`,
        detail: {
          operation: args.operation,
          filePath: args.filePath,
          line: args.line,
          character: args.character,
        },
      },
      approvalRule: literalRulePattern(this.name, filePath),
      matchesRule: (ruleArgs) =>
        matchesPathRuleSubject(ruleArgs, filePath, { pathClass: this.kaos.pathClass() }),
      execute: ({ signal }) => this.execute({ ...args, filePath }, signal),
    };
  }

  private async execute(args: LspInput, signal: AbortSignal): Promise<ExecutableToolResult> {
    try {
      const stat = await this.kaos.stat(args.filePath);
      if ((stat.stMode & S_IFMT) !== S_IFREG) {
        return new ToolResultBuilder().error(`Path is not a file: ${args.filePath}`);
      }
      if (stat.stSize > MAX_LSP_FILE_BYTES) {
        return new ToolResultBuilder().error(
          `File is too large for LSP analysis: ${String(stat.stSize)} bytes`,
        );
      }
      const extension = extname(args.filePath, this.kaos.pathClass());
      if (!this.manager.hasServerForFile(args.filePath)) {
        return new ToolResultBuilder().ok(
          `No LSP server configured for ${extension || 'extensionless'} files`,
        );
      }

      const content = await this.kaos.readText(args.filePath);
      await this.manager.openFile(args.filePath, content);
      const { method, params } = methodAndParams(args, this.kaos.pathClass());
      let result = await this.manager.request(args.filePath, method, params, signal);
      if (args.operation === 'incomingCalls' || args.operation === 'outgoingCalls') {
        const item = Array.isArray(result) ? result[0] : undefined;
        if (item === undefined) {
          return resultText('No call hierarchy item found at this position');
        }
        result = await this.manager.request(
          args.filePath,
          args.operation === 'incomingCalls'
            ? 'callHierarchy/incomingCalls'
            : 'callHierarchy/outgoingCalls',
          { item },
          signal,
        );
      }
      result = await filterGitIgnoredResult(
        args.operation,
        result,
        this.workspace.workspaceDir,
        this.kaos,
      );

      return resultText(formatResult(args.operation, result, this.workspace.workspaceDir));
    } catch (error) {
      return new ToolResultBuilder().error(
        `LSP ${args.operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function resultText(text: string): ExecutableToolResult {
  const builder = new ToolResultBuilder({ maxChars: 100_000 });
  builder.write(text);
  return builder.ok('LSP request completed');
}

function methodAndParams(
  input: LspInput,
  pathClass: 'posix' | 'win32',
): { readonly method: string; readonly params: unknown } {
  const uri = fileUri(input.filePath, pathClass);
  const position = { line: input.line - 1, character: input.character - 1 };
  const textDocument = { uri };
  switch (input.operation) {
    case 'goToDefinition':
      return { method: 'textDocument/definition', params: { textDocument, position } };
    case 'findReferences':
      return {
        method: 'textDocument/references',
        params: { textDocument, position, context: { includeDeclaration: true } },
      };
    case 'hover':
      return { method: 'textDocument/hover', params: { textDocument, position } };
    case 'documentSymbol':
      return { method: 'textDocument/documentSymbol', params: { textDocument } };
    case 'workspaceSymbol':
      return { method: 'workspace/symbol', params: { query: '' } };
    case 'goToImplementation':
      return { method: 'textDocument/implementation', params: { textDocument, position } };
    case 'prepareCallHierarchy':
    case 'incomingCalls':
    case 'outgoingCalls':
      return {
        method: 'textDocument/prepareCallHierarchy',
        params: { textDocument, position },
      };
  }
}

function formatResult(operation: LspInput['operation'], result: unknown, cwd: string): string {
  switch (operation) {
    case 'goToDefinition':
    case 'goToImplementation':
      return formatLocations(result, cwd, 'definition');
    case 'findReferences':
      return formatLocations(result, cwd, 'reference');
    case 'hover':
      return formatHover(result);
    case 'documentSymbol':
      return formatDocumentSymbols(result);
    case 'workspaceSymbol':
      return formatWorkspaceSymbols(result, cwd);
    case 'prepareCallHierarchy':
      return formatCallItems(result, cwd);
    case 'incomingCalls':
      return formatCalls(result, cwd, 'from');
    case 'outgoingCalls':
      return formatCalls(result, cwd, 'to');
  }
}

async function filterGitIgnoredResult(
  operation: LspInput['operation'],
  result: unknown,
  cwd: string,
  kaos: Kaos,
): Promise<unknown> {
  // Keep navigation results focused on source files inside the workspace,
  // not ignored build artifacts or generated outputs.
  if (
    !Array.isArray(result) ||
    !['findReferences', 'goToDefinition', 'goToImplementation', 'workspaceSymbol'].includes(
      operation,
    )
  ) {
    return result;
  }

  const pathByItem = new Map<unknown, string>();
  for (const item of result) {
    const uri = locationResultUri(operation, item);
    if (uri === undefined) continue;
    const relativePath = workspaceRelativeUriPath(uri, cwd);
    if (relativePath !== undefined) pathByItem.set(item, relativePath);
  }
  const paths = [...new Set(pathByItem.values())];
  if (paths.length === 0) return result;

  const ignored = new Set<string>();
  for (let index = 0; index < paths.length; index += 50) {
    const output = await runGitCommand(
      kaos,
      cwd,
      ['check-ignore', '-z', '--', ...paths.slice(index, index + 50)],
      5_000,
      [0, 1],
    );
    if (output === null) continue;
    for (const path of output.split('\0')) {
      if (path.length > 0) ignored.add(path);
    }
  }
  return ignored.size === 0
    ? result
    : result.filter((item) => !ignored.has(pathByItem.get(item) ?? ''));
}

function locationResultUri(
  operation: LspInput['operation'],
  value: unknown,
): string | undefined {
  if (!isRecord(value)) return undefined;
  if (operation === 'workspaceSymbol') {
    const location = value['location'];
    return isRecord(location) && typeof location['uri'] === 'string'
      ? location['uri']
      : undefined;
  }
  if (typeof value['targetUri'] === 'string') return value['targetUri'];
  return typeof value['uri'] === 'string' ? value['uri'] : undefined;
}

function workspaceRelativeUriPath(uri: string, cwd: string): string | undefined {
  const path = uriPath(uri);
  const relative = posix.relative(cwd.replaceAll('\\', '/'), path.replaceAll('\\', '/'));
  return relative.length > 0 && !relative.startsWith('../') && !posix.isAbsolute(relative)
    ? relative
    : undefined;
}

function formatLocations(result: unknown, cwd: string, noun: string): string {
  const raw = Array.isArray(result) ? result : result === null || result === undefined ? [] : [result];
  const locations = raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item['targetUri'] === 'string') {
      return [{ uri: item['targetUri'], range: item['targetSelectionRange'] ?? item['targetRange'] }];
    }
    return typeof item['uri'] === 'string' ? [item] : [];
  });
  if (locations.length === 0) return `No ${noun}s found.`;
  return locations
    .map((location) => formatLocation(location, cwd))
    .filter((location): location is string => location !== undefined)
    .join('\n');
}

function formatHover(result: unknown): string {
  if (!isRecord(result)) return 'No hover information available.';
  return markupText(result['contents']) || 'No hover information available.';
}

function markupText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(markupText).filter(Boolean).join('\n\n');
  if (!isRecord(value)) return '';
  return typeof value['value'] === 'string' ? value['value'] : '';
}

function formatDocumentSymbols(result: unknown): string {
  if (!Array.isArray(result) || result.length === 0) return 'No symbols found in document.';
  const lines: string[] = [];
  for (const symbol of result) appendSymbol(lines, symbol, 0);
  return lines.join('\n');
}

function appendSymbol(lines: string[], value: unknown, depth: number): void {
  if (!isRecord(value) || typeof value['name'] !== 'string') return;
  const range = isRecord(value['range'])
    ? value['range']
    : isRecord(value['location']) && isRecord(value['location']['range'])
      ? value['location']['range']
      : undefined;
  const start = isRecord(range) && isRecord(range['start']) ? range['start'] : undefined;
  const line = isRecord(start) && typeof start['line'] === 'number'
    ? ` - Line ${String(start['line'] + 1)}`
    : '';
  lines.push(`${'  '.repeat(depth)}${value['name']}${line}`);
  if (Array.isArray(value['children'])) {
    for (const child of value['children']) appendSymbol(lines, child, depth + 1);
  }
}

function formatWorkspaceSymbols(result: unknown, cwd: string): string {
  if (!Array.isArray(result) || result.length === 0) return 'No workspace symbols found.';
  const lines: string[] = [];
  for (const symbol of result) {
    if (!isRecord(symbol) || typeof symbol['name'] !== 'string') continue;
    const location = isRecord(symbol['location']) ? formatLocation(symbol['location'], cwd) : undefined;
    lines.push(location === undefined ? symbol['name'] : `${symbol['name']} - ${location}`);
  }
  return lines.join('\n');
}

function formatCallItems(result: unknown, cwd: string): string {
  if (!Array.isArray(result) || result.length === 0) return 'No call hierarchy item found.';
  return result
    .flatMap((item) => {
      if (!isRecord(item) || typeof item['name'] !== 'string') return [];
      const location = formatLocation(
        { uri: item['uri'], range: item['selectionRange'] ?? item['range'] },
        cwd,
      );
      return [location === undefined ? item['name'] : `${item['name']} - ${location}`];
    })
    .join('\n');
}

function formatCalls(result: unknown, cwd: string, side: 'from' | 'to'): string {
  if (!Array.isArray(result) || result.length === 0) {
    return side === 'from' ? 'No incoming calls found.' : 'No outgoing calls found.';
  }
  return result
    .flatMap((call) => {
      if (!isRecord(call) || !isRecord(call[side])) return [];
      const item = call[side];
      const name = typeof item['name'] === 'string' ? item['name'] : '<anonymous>';
      const location = formatLocation(
        { uri: item['uri'], range: item['selectionRange'] ?? item['range'] },
        cwd,
      );
      return [location === undefined ? name : `${name} - ${location}`];
    })
    .join('\n');
}

function formatLocation(value: unknown, cwd: string): string | undefined {
  if (!isRecord(value) || typeof value['uri'] !== 'string' || !isRecord(value['range'])) {
    return undefined;
  }
  const start = value['range']['start'];
  if (!isRecord(start) || typeof start['line'] !== 'number' || typeof start['character'] !== 'number') {
    return undefined;
  }
  const path = displayUri(value['uri'], cwd);
  return `${path}:${String(start['line'] + 1)}:${String(start['character'] + 1)}`;
}

function displayUri(uri: string, cwd: string): string {
  const path = uriPath(uri);
  const relative = posix.relative(cwd.replaceAll('\\', '/'), path.replaceAll('\\', '/'));
  return relative.length > 0 && !relative.startsWith('../') ? relative : path;
}

function uriPath(uri: string): string {
  let path = uri.replace(/^file:\/\//u, '');
  if (/^\/[A-Za-z]:/u.test(path)) path = path.slice(1);
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep malformed URIs readable instead of losing the result.
  }
  return path;
}

function operationLabel(operation: LspInput['operation']): string {
  return operation.replaceAll(/([A-Z])/g, ' $1').toLowerCase();
}

function extname(value: string, pathClass: 'posix' | 'win32'): string {
  return (pathClass === 'win32' ? win32 : posix).extname(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
