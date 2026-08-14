import type { Kaos, StatResult } from '@pymodel/kaos';
import type { ContentPart } from '@pymodel/kosong';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { renderPrompt } from '../../../utils/render-prompt';
import { resolvePathAccessPath } from '../../policies/path-access';
import { MEDIA_SNIFF_BYTES, detectFileType } from '../../support/file-type';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '../../support/rule-match';
import type { WorkspaceConfig } from '../../support/workspace';
import { makeCarriageReturnsVisible, type LineEndingStyle } from './line-endings';
import readDescriptionTemplate from './read.md?raw';

export const MAX_LINES: number = 1000;
export const MAX_LINE_LENGTH: number = 2000;
export const MAX_BYTES: number = 100 * 1024;
export const MAX_NOTEBOOK_BYTES: number = 256 * 1024;
export const FILE_UNCHANGED_STUB =
  'File unchanged since last read. The content from the earlier Read tool result in this conversation is still current.';
export interface FileReadSnapshot {
  readonly mtime: number;
  readonly range: string;
  readonly isPartialView?: boolean;
}
export type FileReadState = Map<string, FileReadSnapshot>;
const LARGE_NOTEBOOK_OUTPUT_BYTES = 10_000;
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const DAY_SECONDS = 86_400;

const PositiveLineOffsetSchema = z.number().int().min(1);
const TailLineOffsetSchema = z.number().int().min(-MAX_LINES).max(-1);

export const ReadInputSchema = z.object({
  path: z
    .string()
    .describe(
      'Path to a text file. Relative paths resolve against the working directory; a path outside the working directory must be absolute. Directories are not supported; use `ls` via Bash for a known directory, or Glob for pattern search.',
    ),
  line_offset: z
    .union([PositiveLineOffsetSchema, TailLineOffsetSchema])
    .optional()
    .describe(
      `The line number to start reading from. Omit to start at line 1. Negative values read from the end of the file; the absolute value cannot exceed ${String(MAX_LINES)}.`,
    ),
  n_lines: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      `The number of lines to read; the tool also applies its internal cap. Omit to read up to the internal cap of ${String(MAX_LINES)} lines.`,
    ),
});

export const ReadOutputSchema = z.object({
  content: z.string(),
  lineCount: z.number().int().nonnegative(),
});

export type ReadInput = z.Infer<typeof ReadInputSchema>;
export type ReadOutput = z.Infer<typeof ReadOutputSchema>;

interface LineEndingFlags {
  hasCrLf: boolean;
  hasLf: boolean;
  hasLoneCr: boolean;
}

interface ReadLineEntry {
  readonly lineNo: number;
  readonly rawContent: string;
}

interface RenderedLine {
  readonly line: string;
  readonly wasTruncated: boolean;
}

interface FinishReadResultInput {
  readonly renderedLines: readonly string[];
  readonly truncatedLineNumbers: readonly number[];
  readonly maxLinesReached: boolean;
  readonly maxBytesReached: boolean;
  readonly lineEndingStyle: LineEndingStyle;
  readonly startLine: number;
  readonly totalLines: number;
  readonly requestedLines: number;
}

type TextPreviewKaos = Kaos & {
  readTextPreview?: (path: string, n: number) => Promise<Buffer>;
};

async function readTextHeader(kaos: TextPreviewKaos, path: string, n: number): Promise<Buffer> {
  if (kaos.readTextPreview !== undefined) {
    return kaos.readTextPreview(path, n);
  }
  return kaos.readBytes(path, n);
}

function truncateLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line;
  const marker = '...';
  const target = Math.max(maxLength, marker.length);
  return line.slice(0, target - marker.length) + marker;
}

function stripTrailingLf(line: string): string {
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

function updateLineEndingFlags(flags: LineEndingFlags, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.codePointAt(i);
    if (code === 13) {
      if (text.codePointAt(i + 1) === 10) {
        flags.hasCrLf = true;
        i += 1;
      } else {
        flags.hasLoneCr = true;
      }
    } else if (code === 10) {
      flags.hasLf = true;
    }
  }
}

function lineEndingStyleFromFlags(flags: LineEndingFlags): LineEndingStyle {
  if (flags.hasLoneCr || (flags.hasCrLf && flags.hasLf)) return 'mixed';
  if (flags.hasCrLf) return 'crlf';
  return 'lf';
}

function renderLine(entry: ReadLineEntry, lineEndingStyle: LineEndingStyle): RenderedLine {
  const modelContent =
    lineEndingStyle === 'crlf' && entry.rawContent.endsWith('\r')
      ? entry.rawContent.slice(0, -1)
      : entry.rawContent;
  const truncated = truncateLine(modelContent, MAX_LINE_LENGTH);
  const renderedContent =
    lineEndingStyle === 'mixed' ? makeCarriageReturnsVisible(truncated) : truncated;
  return {
    line: `${String(entry.lineNo)}\t${renderedContent}`,
    wasTruncated: truncated !== modelContent,
  };
}

function renderedLineBytes(renderedLine: string, isFirst: boolean): number {
  return (isFirst ? 0 : 1) + Buffer.byteLength(renderedLine, 'utf8');
}

function isRegularFileMode(stMode: number): boolean {
  return (stMode & S_IFMT) === S_IFREG;
}

function isFileNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown })['code'];
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isTextDecodeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown })['code'];
  if (code === 'ERR_ENCODING_INVALID_ENCODED_DATA') return true;
  if (!(error instanceof Error)) return false;
  return /encoded data was not valid|invalid.*encoding|invalid.*utf-?8/i.test(error.message);
}

function containsNulByte(text: string): boolean {
  return text.includes('\u0000');
}

function notReadableFileOutput(path: string): string {
  return (
    `"${path}" is not readable as UTF-8 text. ` +
    'If it is an image or video, use ReadMediaFile. ' +
    'For other binary formats, use Bash or an MCP tool if available.'
  );
}

function memoryFreshnessNote(path: string, mtimeSeconds: number): string {
  if (!/(?:^|[\\/])agent-memory(?:-local)?(?:[\\/]|$)/u.test(path)) return '';
  const ageDays = Math.max(0, Math.floor((Date.now() / 1000 - mtimeSeconds) / DAY_SECONDS));
  if (ageDays <= 1) return '';
  return (
    `<system-reminder>This memory is ${String(ageDays)} days old. ` +
    'Memories are point-in-time observations, not live state. ' +
    'Claims about code behavior or file and line references may be outdated. ' +
    'Verify against current code before asserting them as fact.</system-reminder>'
  );
}

const READ_DESCRIPTION = renderPrompt(readDescriptionTemplate, {
  MAX_LINES,
  MAX_BYTES_KB: MAX_BYTES / 1024,
  MAX_LINE_LENGTH,
});

export class ReadTool implements BuiltinTool<ReadInput> {
  readonly name = 'Read' as const;
  readonly description = READ_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ReadInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly readState: FileReadState = new Map(),
  ) {}

  resolveExecution(args: ReadInput): ToolExecution {
    const path = resolvePathAccessPath(args.path, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'read',
    });
    return {
      accesses: ToolAccesses.readFile(path),
      description: `Reading ${args.path}`,
      display: { kind: 'file_io', operation: 'read', path },
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

  private async execution(args: ReadInput, safePath: string): Promise<ExecutableToolResult> {
    try {
      let stat: StatResult;
      try {
        stat = await this.kaos.stat(safePath);
      } catch (error) {
        if (isFileNotFoundError(error)) {
          return { isError: true, output: `"${args.path}" does not exist.` };
        }
        throw error;
      }
      if (!isRegularFileMode(stat.stMode)) {
        return { isError: true, output: `"${args.path}" is not a file.` };
      }

      const range = `${String(args.line_offset ?? 1)}:${String(args.n_lines ?? MAX_LINES)}`;
      const previous = this.readState.get(safePath);
      if (previous?.mtime === stat.stMtime && previous.range === range) {
        return { output: FILE_UNCHANGED_STUB };
      }

      if (safePath.toLowerCase().endsWith('.ipynb')) {
        const result = await this.readNotebook(safePath, args.path, stat);
        if (result.isError !== true) {
          this.readState.set(safePath, {
            mtime: stat.stMtime,
            range,
            isPartialView: false,
          });
        }
        return result;
      }

      const header = await readTextHeader(this.kaos, safePath, MEDIA_SNIFF_BYTES);
      const fileType = detectFileType(safePath, header);
      if (fileType.kind === 'image' || fileType.kind === 'video') {
        return {
          isError: true,
          output: `"${args.path}" is a ${fileType.kind} file. Use ReadMediaFile to read image or video files.`,
        };
      }
      if (fileType.kind === 'unknown') {
        return {
          isError: true,
          output: notReadableFileOutput(args.path),
        };
      }

      const lineOffset = args.line_offset ?? 1;
      const requestedLines = args.n_lines ?? MAX_LINES;
      const effectiveLimit = Math.min(requestedLines, MAX_LINES);

      let result: ExecutableToolResult;
      if (lineOffset < 0) {
        result = await this.readTail(
          safePath,
          args.path,
          lineOffset,
          effectiveLimit,
          requestedLines,
        );
      } else {
        result = await this.readForward(
          safePath,
          args.path,
          lineOffset,
          effectiveLimit,
          requestedLines,
        );
      }
      if (result.isError !== true) {
        const note = memoryFreshnessNote(safePath, stat.stMtime);
        if (note !== '' && typeof result.output === 'string') {
          result = {
            ...result,
            output: result.output === '' ? note : `${result.output}\n${note}`,
          };
        }
        const output = typeof result.output === 'string' ? result.output : '';
        this.readState.set(safePath, {
          mtime: stat.stMtime,
          range,
          isPartialView:
            args.line_offset !== undefined ||
            args.n_lines !== undefined ||
            output.includes(`Max ${String(MAX_LINES)} lines reached.`) ||
            output.includes(`Max ${String(MAX_BYTES)} bytes reached.`) ||
            output.includes(' were truncated.'),
        });
      }
      return result;
    } catch (error) {
      if (isTextDecodeError(error)) {
        return { isError: true, output: notReadableFileOutput(args.path) };
      }
      return {
        isError: true,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async readNotebook(
    safePath: string,
    displayPath: string,
    stat: StatResult,
  ): Promise<ExecutableToolResult> {
    if (stat.stSize > MAX_NOTEBOOK_BYTES) {
      return {
        isError: true,
        output:
          `"${displayPath}" exceeds the notebook read limit of ` +
          `${String(MAX_NOTEBOOK_BYTES)} bytes. Use Bash with jq to inspect selected cells.`,
      };
    }

    const raw = await this.kaos.readText(safePath, { errors: 'strict' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      return {
        isError: true,
        output: `"${displayPath}" is not valid notebook JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    const notebook = asRecord(parsed);
    if (!Array.isArray(notebook?.['cells'])) {
      return {
        isError: true,
        output: `"${displayPath}" is not a valid Jupyter notebook: cells must be an array.`,
      };
    }

    const cells = notebook['cells'];
    const languageInfo = asRecord(asRecord(notebook['metadata'])?.['language_info']);
    const language =
      typeof languageInfo?.['name'] === 'string' ? languageInfo['name'] : 'python';
    const parts: ContentPart[] = [];
    const appendText = (text: string): void => {
      const previous = parts.at(-1);
      if (previous?.type === 'text') {
        previous.text += text;
      } else {
        parts.push({ type: 'text', text });
      }
    };

    appendText(
      `<system>Read Jupyter notebook "${displayPath}" with ${String(cells.length)} cells.</system>\n`,
    );
    for (const [index, value] of cells.entries()) {
      if (index > 0) appendText('\n');
      const cell = asRecord(value);
      if (cell === undefined) {
        return {
          isError: true,
          output: `"${displayPath}" contains an invalid cell at index ${String(index)}.`,
        };
      }
      const cellType = typeof cell['cell_type'] === 'string' ? cell['cell_type'] : 'unknown';
      const cellId =
        typeof cell['id'] === 'string'
          ? cell['id'].replaceAll('"', '&quot;')
          : `cell-${String(index)}`;
      const metadata =
        cellType === 'code'
          ? language === 'python'
            ? ''
            : `<language>${language}</language>`
          : `<cell_type>${cellType}</cell_type>`;
      appendText(
        `<cell id="${cellId}">${metadata}${notebookText(cell['source'])}</cell id="${cellId}">`,
      );

      if (cellType !== 'code' || !Array.isArray(cell['outputs'])) continue;
      const outputs = cell['outputs'];
      if (notebookOutputSize(outputs) > LARGE_NOTEBOOK_OUTPUT_BYTES) {
        appendText(
          `\nOutputs are too large to include. Use Bash with jq '.cells[${String(index)}].outputs' on the notebook.`,
        );
        continue;
      }
      for (const outputValue of outputs) {
        const output = asRecord(outputValue);
        if (output === undefined) continue;
        const outputType = output['output_type'];
        if (outputType === 'stream') {
          appendText(`\n${notebookText(output['text'])}`);
          continue;
        }
        if (outputType === 'error') {
          const name = typeof output['ename'] === 'string' ? output['ename'] : 'Error';
          const message = typeof output['evalue'] === 'string' ? output['evalue'] : '';
          const traceback = notebookText(output['traceback']);
          appendText(`\n${name}: ${message}${traceback ? `\n${traceback}` : ''}`);
          continue;
        }
        if (outputType !== 'execute_result' && outputType !== 'display_data') continue;
        const data = asRecord(output['data']);
        if (data === undefined) continue;
        const text = notebookText(data['text/plain']);
        if (text) appendText(`\n${text}`);
        const image = notebookImage(data);
        if (image !== undefined) {
          parts.push({
            type: 'image_url',
            imageUrl: { url: `data:${image.mimeType};base64,${image.data}` },
          });
        }
      }
    }
    return { output: parts };
  }

  private async readForward(
    safePath: string,
    displayPath: string,
    lineOffset: number,
    effectiveLimit: number,
    requestedLines: number,
  ): Promise<ExecutableToolResult> {
    const selectedEntries: ReadLineEntry[] = [];
    const flags: LineEndingFlags = { hasCrLf: false, hasLf: false, hasLoneCr: false };
    let currentLineNo = 0;
    let maxLinesReached = false;
    let collectionClosed = false;

    for await (const rawLine of this.kaos.readLines(safePath, { errors: 'strict' })) {
      if (containsNulByte(rawLine)) {
        return { isError: true, output: notReadableFileOutput(displayPath) };
      }
      currentLineNo += 1;
      updateLineEndingFlags(flags, rawLine);
      if (collectionClosed) {
        if (effectiveLimit >= MAX_LINES && currentLineNo >= lineOffset) {
          maxLinesReached = true;
        }
        continue;
      }
      if (currentLineNo < lineOffset) continue;
      if (selectedEntries.length >= effectiveLimit) {
        if (effectiveLimit >= MAX_LINES) {
          maxLinesReached = true;
        }
        collectionClosed = true;
        continue;
      }
      selectedEntries.push({
        lineNo: currentLineNo,
        rawContent: stripTrailingLf(rawLine),
      });
      if (selectedEntries.length >= effectiveLimit) {
        collectionClosed = true;
      }
    }

    const lineEndingStyle = lineEndingStyleFromFlags(flags);
    const renderedLines: string[] = [];
    const truncatedLineNumbers: number[] = [];
    let bytes = 0;
    let maxBytesReached = false;

    for (const entry of selectedEntries) {
      const rendered = renderLine(entry, lineEndingStyle);
      const lineBytes = renderedLineBytes(rendered.line, renderedLines.length === 0);
      if (renderedLines.length > 0 && bytes + lineBytes > MAX_BYTES) {
        maxBytesReached = true;
        break;
      }

      if (rendered.wasTruncated) {
        truncatedLineNumbers.push(entry.lineNo);
      }
      renderedLines.push(rendered.line);
      bytes += lineBytes;
      if (bytes >= MAX_BYTES) {
        maxBytesReached = true;
        break;
      }
    }

    return this.finishReadResult({
      renderedLines,
      truncatedLineNumbers,
      maxLinesReached,
      maxBytesReached,
      lineEndingStyle,
      startLine: renderedLines.length > 0 ? lineOffset : 0,
      totalLines: currentLineNo,
      requestedLines,
    });
  }

  private async readTail(
    safePath: string,
    displayPath: string,
    lineOffset: number,
    effectiveLimit: number,
    requestedLines: number,
  ): Promise<ExecutableToolResult> {
    const tailCount = Math.abs(lineOffset);
    const entries: ReadLineEntry[] = [];
    const flags: LineEndingFlags = { hasCrLf: false, hasLf: false, hasLoneCr: false };
    let currentLineNo = 0;

    for await (const rawLine of this.kaos.readLines(safePath, { errors: 'strict' })) {
      if (containsNulByte(rawLine)) {
        return { isError: true, output: notReadableFileOutput(displayPath) };
      }
      currentLineNo += 1;
      updateLineEndingFlags(flags, rawLine);
      entries.push({
        lineNo: currentLineNo,
        rawContent: stripTrailingLf(rawLine),
      });
      if (entries.length > tailCount) {
        entries.shift();
      }
    }

    const lineEndingStyle = lineEndingStyleFromFlags(flags);
    let renderedCandidates = entries.slice(0, effectiveLimit).map((entry) => {
      return { entry, rendered: renderLine(entry, lineEndingStyle) };
    });

    let totalBytes = 0;
    for (const [index, candidate] of renderedCandidates.entries()) {
      totalBytes += renderedLineBytes(candidate.rendered.line, index === 0);
    }

    let maxBytesReached = false;
    if (totalBytes > MAX_BYTES) {
      maxBytesReached = true;
      const kept: typeof renderedCandidates = [];
      let bytes = 0;
      for (let i = renderedCandidates.length - 1; i >= 0; i -= 1) {
        const candidate = renderedCandidates[i];
        if (candidate === undefined) continue;
        const lineBytes = renderedLineBytes(candidate.rendered.line, kept.length === 0);
        if (bytes + lineBytes > MAX_BYTES) break;
        kept.unshift(candidate);
        bytes += lineBytes;
      }
      renderedCandidates = kept;
    }

    const renderedLines: string[] = [];
    const truncatedLineNumbers: number[] = [];
    for (const candidate of renderedCandidates) {
      renderedLines.push(candidate.rendered.line);
      if (candidate.rendered.wasTruncated) {
        truncatedLineNumbers.push(candidate.entry.lineNo);
      }
    }

    return this.finishReadResult({
      renderedLines,
      truncatedLineNumbers,
      maxLinesReached: false,
      maxBytesReached,
      lineEndingStyle,
      startLine: renderedCandidates[0]?.entry.lineNo ?? 0,
      totalLines: currentLineNo,
      requestedLines,
    });
  }

  private finishReadResult(input: FinishReadResultInput): ExecutableToolResult {
    return {
      output: this.finishOutput(input.renderedLines, this.finishMessage(input)),
    };
  }

  private finishOutput(renderedLines: readonly string[], message: string): string {
    const rendered = renderedLines.join('\n');
    const status = `<system>${message}</system>`;
    return rendered.length > 0 ? `${rendered}\n${status}` : status;
  }

  private finishMessage(input: FinishReadResultInput): string {
    const lineCount = input.renderedLines.length;
    const lineWord = lineCount === 1 ? 'line' : 'lines';
    const parts =
      lineCount > 0
        ? [
            `${String(lineCount)} ${lineWord} read from file starting from line ${String(input.startLine)}.`,
          ]
        : ['No lines read from file.'];

    parts.push(`Total lines in file: ${String(input.totalLines)}.`);
    if (input.maxLinesReached) {
      parts.push(`Max ${String(MAX_LINES)} lines reached.`);
    } else if (input.maxBytesReached) {
      parts.push(`Max ${String(MAX_BYTES)} bytes reached.`);
    } else if (lineCount < input.requestedLines) {
      parts.push('End of file reached.');
    }
    if (input.truncatedLineNumbers.length > 0) {
      parts.push(`Lines [${input.truncatedLineNumbers.join(', ')}] were truncated.`);
    }
    if (input.lineEndingStyle === 'mixed') {
      parts.push(
        'Mixed or lone carriage-return line endings are shown as \\r. Use exact \\r\\n or \\r escapes in Edit.old_string for those lines.',
      );
    }
    return parts.join(' ');
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function notebookText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.filter((item): item is string => typeof item === 'string').join('');
}

function notebookOutputSize(outputs: readonly unknown[]): number {
  let size = 0;
  for (const value of outputs) {
    const output = asRecord(value);
    if (output === undefined) continue;
    size += Buffer.byteLength(notebookText(output['text']));
    size += Buffer.byteLength(notebookText(output['traceback']));
    size += Buffer.byteLength(notebookText(output['evalue']));
    const data = asRecord(output['data']);
    if (data !== undefined) {
      size += Buffer.byteLength(notebookText(data['text/plain']));
      size += Buffer.byteLength(notebookText(data['image/png']));
      size += Buffer.byteLength(notebookText(data['image/jpeg']));
    }
    if (size > LARGE_NOTEBOOK_OUTPUT_BYTES) break;
  }
  return size;
}

function notebookImage(
  data: Record<string, unknown>,
): { mimeType: 'image/png' | 'image/jpeg'; data: string } | undefined {
  for (const mimeType of ['image/png', 'image/jpeg'] as const) {
    const encoded = data[mimeType];
    if (typeof encoded === 'string' && encoded.trim() !== '') {
      return { mimeType, data: encoded.replaceAll(/\s/gu, '') };
    }
  }
  return undefined;
}
