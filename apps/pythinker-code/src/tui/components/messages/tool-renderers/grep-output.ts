import type { ToolCallBlockData } from '#/tui/types';

import { strArg, stripSpillPointer } from './types';

export type GrepMode = 'files_with_matches' | 'content' | 'count_matches';

export interface GrepEntry {
  readonly path: string;
  readonly label: string;
}

export interface GrepStats {
  readonly mode: GrepMode;
  readonly entries: readonly GrepEntry[];
  readonly total: number;
  readonly matches: number | null;
  readonly files: number;
  readonly filesPartial: boolean;
  readonly partial: boolean;
}

export interface GlobStats {
  readonly entries: readonly string[];
  readonly partial: boolean;
}

const NOTICE =
  /^(?:No matches found|No non-sensitive matches found|Found \d+ total (?:non-sensitive )?occurrences? across |Found \d+ matches$|Filtered \d+ sensitive file|Results truncated to \d+ lines|\[Output truncated at \d+ bytes|Grep timed out after |Glob timed out after |Glob completed with warnings|\[stdout truncated at |\[Truncated at |Only the first |rg: )/;

const GLOB_META =
  /^(?:Showing matches \d+|Continue with the same search arguments|To remove the match-count limit|No more matches at offset=|No matches collected; search incomplete)/;

const COUNT_SUMMARY = /^Found (\d+) total (?:non-sensitive )?occurrences? across (\d+) files?\.$/m;
const PAGINATION_TOTAL = /^Results truncated to \d+ lines \(total: (\d+)/m;
const INCOMPLETE =
  /^(?:\[Output truncated at \d+ bytes|Grep timed out after |Glob timed out after |Glob completed with warnings|\[stdout truncated at |\[Truncated at \d+ matches|Only the first \d+ matches)/m;

const GLOB_PAGE_HEADER =
  /^Showing matches (\d+)\u2013(\d+) of (\d+)( collected matches \(partial result set\))?\.$/;

const CONTENT_MATCH = /^(.+?):(\d+):/;
const COUNT_LINE = /^(.+):(\d+)$/;
const DRIVE_PREFIX = /^[A-Za-z]:[\\/]/;

function resultLines(output: string): string[] {
  if (output.length === 0) return [];
  return stripSpillPointer(output)
    .split('\n')
    .filter((line) => line.length > 0 && line !== '--' && !NOTICE.test(line));
}

export function grepMode(toolCall: ToolCallBlockData): GrepMode {
  const mode = strArg(toolCall.args, 'output_mode');
  return mode === 'content' || mode === 'count_matches' ? mode : 'files_with_matches';
}

export function parseGrepOutput(toolCall: ToolCallBlockData, output: string): GrepStats {
  const mode = grepMode(toolCall);
  const lines = resultLines(output);
  const partial = INCOMPLETE.test(output);

  if (mode === 'files_with_matches') {
    const entries = lines.map((path) => ({ path, label: path }));
    const total = PAGINATION_TOTAL.exec(output)?.[1];
    const files = total === undefined ? entries.length : Number(total);
    return { mode, entries, total: files, matches: files, files, filesPartial: false, partial };
  }

  if (mode === 'count_matches') {
    const entries: GrepEntry[] = [];
    let matches = 0;
    for (const line of lines) {
      const [, path, count] = COUNT_LINE.exec(line) ?? [];
      if (path === undefined || count === undefined) continue;
      entries.push({ path, label: line });
      matches += Number(count);
    }
    const [, totalMatches, totalFiles] = COUNT_SUMMARY.exec(output) ?? [];
    if (totalMatches !== undefined && totalFiles !== undefined) {
      return {
        mode,
        entries,
        total: Number(totalFiles),
        matches: Number(totalMatches),
        files: Number(totalFiles),
        filesPartial: false,
        partial,
      };
    }
    return {
      mode,
      entries,
      total: entries.length,
      matches,
      files: entries.length,
      filesPartial: false,
      partial,
    };
  }

  const numbered = toolCall.args['-n'] !== false;
  const positive = (flag: string): boolean => {
    const value = toolCall.args[flag];
    return typeof value === 'number' && value > 0;
  };
  const hasContext =
    typeof toolCall.args['-C'] === 'number' ? positive('-C') : positive('-A') || positive('-B');
  const countable = numbered || !hasContext;
  const entries: GrepEntry[] = [];
  const paths = new Set<string>();
  let rows = 0;
  for (const line of lines) {
    if (numbered) {
      const [, path, lineNumber] = CONTENT_MATCH.exec(line) ?? [];
      if (path === undefined || lineNumber === undefined) continue;
      rows++;
      paths.add(path);
      entries.push({ path, label: `${path}:${lineNumber}` });
      continue;
    }
    const idx = line.indexOf(':', DRIVE_PREFIX.test(line) ? 2 : 0);
    const path = idx > 0 ? line.slice(0, idx) : line;
    rows++;
    if (paths.has(path)) continue;
    paths.add(path);
    entries.push({ path, label: path });
  }
  const paginatedTotal = hasContext ? undefined : PAGINATION_TOTAL.exec(output)?.[1];
  const matches = countable ? (paginatedTotal === undefined ? rows : Number(paginatedTotal)) : null;
  return {
    mode,
    entries,
    total: numbered && matches !== null ? matches : paths.size,
    matches,
    files: paths.size,
    filesPartial: paginatedTotal !== undefined,
    partial,
  };
}

function globPagePartial(output: string): boolean {
  for (const line of output.split('\n')) {
    const page = GLOB_PAGE_HEADER.exec(line);
    if (page === null) continue;
    const end = Number(page[2]);
    const total = Number(page[3]);
    return end < total || page[4] !== undefined;
  }
  return false;
}

export function parseGlobOutput(output: string): GlobStats {
  return {
    entries: resultLines(output).filter((line) => !GLOB_META.test(line)),
    partial: INCOMPLETE.test(output) || globPagePartial(output),
  };
}

const SENSITIVE_ONLY = /^No non-sensitive matches found/m;

export function searchNoticeOnly(toolCall: ToolCallBlockData, output: string): boolean {
  const noRows =
    toolCall.name === 'Glob'
      ? parseGlobOutput(output).entries.length === 0
      : parseGrepOutput(toolCall, output).entries.length === 0;
  return noRows && (INCOMPLETE.test(output) || SENSITIVE_ONLY.test(output));
}
