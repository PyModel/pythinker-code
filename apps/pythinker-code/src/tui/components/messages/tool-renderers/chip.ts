/**
 * Header chip providers — produce a short "stat" suffix appended to the
 * tool call header once a result has arrived. Chips own the *numeric*
 * summary (line counts, exit codes, byte sizes), so summary renderers
 * below don't repeat them.
 *
 * A chip returning `''` is suppressed; tools without an entry in the
 * registry get no chip at all.
 */

import { computeDiffLines } from '#/tui/components/media/diff-preview';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

import { goalStatusChip } from './goal';
import { readMediaChip } from './media';
import { strArg } from './types';

export type ChipProvider = (toolCall: ToolCallBlockData, result: ToolResultBlockData) => string;

export function countNonEmptyLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (const line of text.split('\n')) if (line.length > 0) n++;
  return n;
}

function pluralize(n: number, singular: string, plural?: string): string {
  return `${String(n)} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface EditStats {
  readonly added: number;
  readonly removed: number;
}

export interface WriteStats {
  readonly lines: number;
}

export function computeEditStats(args: Record<string, unknown>): EditStats {
  const oldStr = strArg(args, 'old_string');
  const newStr = strArg(args, 'new_string');
  if (oldStr.length === 0 && newStr.length === 0) return { added: 0, removed: 0 };
  const diff = computeDiffLines(oldStr, newStr);
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.kind === 'add') added++;
    else if (line.kind === 'delete') removed++;
  }
  return { added, removed };
}

export function computeWriteStats(args: Record<string, unknown>): WriteStats {
  const content = strArg(args, 'content');
  const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
  const lines = normalized.length > 0 ? normalized.split('\n').length : 0;
  return { lines };
}

export function formatEditChip(stats: EditStats): string {
  const parts: string[] = [];
  if (stats.added > 0) parts.push(`+${String(stats.added)}`);
  if (stats.removed > 0) parts.push(`-${String(stats.removed)}`);
  return parts.join(' ');
}

export function formatWriteChip(stats: WriteStats): string {
  return pluralize(stats.lines, 'line');
}

const editChip: ChipProvider = (toolCall) => {
  const stats = computeEditStats(toolCall.args);
  if (stats.added === 0 && stats.removed === 0) return '';
  return formatEditChip(stats);
};

const writeChip: ChipProvider = (toolCall) => formatWriteChip(computeWriteStats(toolCall.args));

const notebookEditChip: ChipProvider = () => '1 cell';

const readChip: ChipProvider = (_toolCall, result) => {
  const cells = notebookCellCount(result.output);
  return cells > 0
    ? pluralize(cells, 'cell')
    : pluralize(countNonEmptyLines(result.output), 'line');
};

const grepChip: ChipProvider = (_toolCall, result) => {
  const matches = countNonEmptyLines(result.output);
  if (matches === 0) return 'no matches';
  return pluralize(matches, 'match', 'matches');
};

const globChip: ChipProvider = (_toolCall, result) => {
  const files = countNonEmptyLines(result.output);
  if (files === 0) return 'no files';
  return pluralize(files, 'file');
};

const fetchChip: ChipProvider = (_toolCall, result) =>
  formatBytes(Buffer.byteLength(result.output, 'utf8'));

const webSearchChip: ChipProvider = (_toolCall, result) => {
  const lines = result.output.split('\n').filter((l) => l.trim().length > 0);
  let count = 0;
  for (const line of lines) {
    if (/^\s*(\d+\.|[-*])\s+/.test(line)) count++;
  }
  if (count === 0) return lines.length === 0 ? 'no results' : 'web result';
  return pluralize(count, 'result');
};

const goalStatusOutputChip: ChipProvider = (_toolCall, result) =>
  result.is_error ? '' : goalStatusChip(result.output);

const listMcpResourcesChip: ChipProvider = (_toolCall, result) => {
  const parsed = parseJson(result.output);
  return Array.isArray(parsed) ? pluralize(parsed.length, 'resource') : '';
};

const readMcpResourceChip: ChipProvider = (_toolCall, result) => {
  const parsed = parseJson(result.output);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const contents = (parsed as Record<string, unknown>)['contents'];
  return Array.isArray(contents) ? pluralize(contents.length, 'content', 'contents') : '';
};

const projectTaskChip: ChipProvider = (toolCall, result) => {
  const id = strArg(toolCall.args, 'taskId') || result.output.match(/\bTask #(\d+)/u)?.[1];
  return id === undefined || id.length === 0 ? '' : `task #${id}`;
};

const taskListChip: ChipProvider = (toolCall, result) => {
  if (toolCall.args['background'] === true) return '';
  const count = result.output.split('\n').filter((line) => /^#\d+\s/u.test(line)).length;
  return count === 0 ? 'no tasks' : pluralize(count, 'task');
};

const teamCreateChip: ChipProvider = (toolCall) => strArg(toolCall.args, 'team_name');

const sendMessageChip: ChipProvider = (toolCall, result) => {
  const target = strArg(toolCall.args, 'to');
  if (target !== '*') return target.length === 0 ? '' : `@${target}`;
  const parsed = parseJson(result.output);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
  const recipients = (parsed as Record<string, unknown>)['recipients'];
  return Array.isArray(recipients) ? pluralize(recipients.length, 'teammate') : '';
};

const teamDeleteChip: ChipProvider = (_toolCall, result) => {
  const parsed = parseJson(result.output);
  return parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>)['success'] === true
    ? 'deleted'
    : '';
};

const enterWorktreeChip: ChipProvider = (toolCall) =>
  strArg(toolCall.args, 'name') || 'worktree';

const exitWorktreeChip: ChipProvider = (toolCall) =>
  toolCall.args['action'] === 'remove' ? 'removed' : 'kept';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function notebookCellCount(output: string): number {
  const parsed = parseJson(output);
  const text = Array.isArray(parsed)
    ? parsed
        .filter(
          (part): part is { type: 'text'; text: string } =>
            typeof part === 'object' &&
            part !== null &&
            (part as { type?: unknown }).type === 'text' &&
            typeof (part as { text?: unknown }).text === 'string',
        )
        .map((part) => part.text)
        .join('')
    : output;
  return [...text.matchAll(/<cell id=/gu)].length;
}

const REGISTRY: Record<string, ChipProvider> = {
  Edit: editChip,
  NotebookEdit: notebookEditChip,
  Write: writeChip,
  Read: readChip,
  ReadMediaFile: readMediaChip,
  Grep: grepChip,
  Glob: globChip,
  FetchURL: fetchChip,
  WebSearch: webSearchChip,
  ListMcpResourcesTool: listMcpResourcesChip,
  ReadMcpResourceTool: readMcpResourceChip,
  TaskCreate: projectTaskChip,
  TaskGet: projectTaskChip,
  TaskUpdate: projectTaskChip,
  TaskList: taskListChip,
  TeamCreate: teamCreateChip,
  TeamDelete: teamDeleteChip,
  SendMessage: sendMessageChip,
  EnterWorktree: enterWorktreeChip,
  ExitWorktree: exitWorktreeChip,
  CreateGoal: goalStatusOutputChip,
  GetGoal: goalStatusOutputChip,
};

export function pickChip(toolName: string): ChipProvider | undefined {
  return REGISTRY[toolName];
}
