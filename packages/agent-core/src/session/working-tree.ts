import path from 'node:path';

import type { Kaos } from '@pythoughts/kaos';

import { ErrorCodes, PythinkerError } from '../errors';
import { canonicalizePath, isWithinDirectory } from '../tools/policies/path-access';
import { runGitCommand } from './git-context';

const MAX_CHANGED_FILES = 500;
const MAX_DIFF_BYTES = 1024 * 1024;

export type WorkingTreeChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'conflicted'
  | 'untracked';

export interface WorkingTreeChange {
  readonly path: string;
  readonly status: WorkingTreeChangeStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

export interface WorkingTreeChanges {
  readonly branch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly truncated: boolean;
  readonly files: readonly WorkingTreeChange[];
}

export interface WorkingTreeFileDiff {
  readonly path: string;
  readonly diff: string;
  readonly truncated: boolean;
}

export async function listWorkingTreeChanges(
  kaos: Kaos,
  cwd: string,
): Promise<WorkingTreeChanges> {
  await assertGitWorkingTree(kaos, cwd);
  const [branch, statusOutput, numstatOutput] = await Promise.all([
    runGitCommand(kaos, cwd, ['branch', '--show-current']),
    runGitCommand(kaos, cwd, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]),
    runGitCommand(kaos, cwd, ['diff', '--numstat', '-z', 'HEAD', '--']),
  ]);
  if (statusOutput === null) throw gitUnavailable(cwd);

  const stats = parseNumstat(numstatOutput ?? '');
  const files = parseStatus(statusOutput)
    .map((file) => ({ ...file, ...(stats.byPath.get(file.path) ?? emptyStats()) }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  return {
    branch: branch ?? '',
    additions: stats.additions,
    deletions: stats.deletions,
    truncated: files.length > MAX_CHANGED_FILES,
    files: files.slice(0, MAX_CHANGED_FILES),
  };
}

export async function readWorkingTreeDiff(
  kaos: Kaos,
  cwd: string,
  inputPath: string,
): Promise<WorkingTreeFileDiff> {
  const pathClass = kaos.pathClass();
  const pathApi = pathClass === 'win32' ? path.win32 : path.posix;
  let absolute: string;
  try {
    absolute = canonicalizePath(inputPath.trim(), cwd, pathClass);
  } catch (error) {
    throw new PythinkerError(ErrorCodes.REQUEST_INVALID, 'Working-tree path is invalid', {
      cause: error,
    });
  }
  if (!isWithinDirectory(absolute, cwd, pathClass) || absolute === cwd) {
    throw new PythinkerError(
      ErrorCodes.REQUEST_INVALID,
      `Path "${inputPath}" is outside the working directory`,
    );
  }
  const relativePath = pathApi.relative(cwd, absolute).split(pathApi.sep).join('/');

  await assertGitWorkingTree(kaos, cwd);
  const [status, head] = await Promise.all([
    runGitCommand(kaos, cwd, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--',
      relativePath,
    ]),
    runGitCommand(kaos, cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']),
  ]);
  if (status === null) throw gitUnavailable(cwd);
  const untracked = status.startsWith('??');
  const args =
    untracked || head === null
      ? ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', relativePath]
      : ['diff', '--no-color', '--no-ext-diff', 'HEAD', '--', relativePath];
  const diff = await runGitCommand(
    kaos,
    cwd,
    args,
    5_000,
    untracked || head === null ? [0, 1] : [0],
  );
  if (diff === null) throw gitUnavailable(cwd);

  const bytes = Buffer.from(diff, 'utf8');
  const truncated = bytes.length > MAX_DIFF_BYTES;
  return {
    path: relativePath,
    diff: truncated ? bytes.subarray(0, MAX_DIFF_BYTES).toString('utf8') : diff,
    truncated,
  };
}

async function assertGitWorkingTree(kaos: Kaos, cwd: string): Promise<void> {
  if ((await runGitCommand(kaos, cwd, ['rev-parse', '--is-inside-work-tree'])) !== 'true') {
    throw gitUnavailable(cwd);
  }
}

function gitUnavailable(cwd: string): PythinkerError {
  return new PythinkerError(
    ErrorCodes.REQUEST_INVALID,
    `Working directory "${cwd}" is not an accessible Git worktree`,
  );
}

function parseStatus(output: string): WorkingTreeChange[] {
  const records = output.split('\0');
  const files: WorkingTreeChange[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record === undefined || record.length < 4) continue;
    const xy = record.slice(0, 2);
    const filePath = record.slice(3);
    files.push({
      path: filePath,
      status: statusFromXY(xy),
      ...emptyStats(),
    });
    if (xy.includes('R') || xy.includes('C')) index++;
  }
  return files;
}

function statusFromXY(xy: string): WorkingTreeChangeStatus {
  if (xy === '??') return 'untracked';
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(xy)) return 'conflicted';
  if (xy.includes('D')) return 'deleted';
  if (xy.includes('R') || xy.includes('C')) return 'renamed';
  if (xy.includes('A')) return 'added';
  return 'modified';
}

function parseNumstat(output: string): {
  readonly additions: number;
  readonly deletions: number;
  readonly byPath: ReadonlyMap<string, ReturnType<typeof emptyStats>>;
} {
  let additions = 0;
  let deletions = 0;
  const byPath = new Map<string, ReturnType<typeof emptyStats>>();
  const records = output.split('\0');
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record === undefined || record.length === 0) continue;
    const firstTab = record.indexOf('\t');
    const secondTab = record.indexOf('\t', firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const addedText = record.slice(0, firstTab);
    const deletedText = record.slice(firstTab + 1, secondTab);
    let filePath = record.slice(secondTab + 1);
    if (filePath.length === 0) {
      index++;
      index++;
      filePath = records[index] ?? '';
    }
    if (filePath.length === 0) continue;
    const binary = addedText === '-' || deletedText === '-';
    const added = binary ? 0 : positiveInteger(addedText);
    const deleted = binary ? 0 : positiveInteger(deletedText);
    additions += added;
    deletions += deleted;
    byPath.set(filePath, {
      additions: added,
      deletions: deleted,
      binary,
    });
  }
  return { additions, deletions, byPath };
}

function positiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function emptyStats(): {
  readonly additions: number;
  readonly deletions: number;
  readonly binary: boolean;
} {
  return { additions: 0, deletions: 0, binary: false };
}
