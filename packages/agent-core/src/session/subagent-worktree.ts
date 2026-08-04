import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Kaos } from '@pythoughts/kaos';

import { runGitCommand } from './git-context';
import type { HookEngine, HookResult } from './hooks';

const GIT_WORKTREE_TIMEOUT_MS = 30_000;

export type SubagentWorktree =
  | {
      readonly hookBased: true;
      readonly worktreePath: string;
      readonly repoRoot?: undefined;
      readonly originalHead?: undefined;
      readonly worktreeBranch?: undefined;
    }
  | {
      readonly hookBased?: false;
      readonly repoRoot: string;
      readonly originalHead: string;
      readonly worktreePath: string;
      readonly worktreeBranch: string;
    };

export interface WorktreeHookOptions {
  readonly hooks?: HookEngine;
  readonly agentId?: string;
}

export interface SettledSubagentWorktree {
  readonly kept: boolean;
  readonly worktreePath?: string;
  readonly worktreeBranch?: string;
}

export interface WorktreeChangeSummary {
  readonly changedFiles: number;
  readonly commits: number;
}

export async function createSubagentWorktree(
  kaos: Kaos,
  cwd: string,
  options?: {
    readonly name?: string;
    readonly branchPrefix?: string;
  } & WorktreeHookOptions,
): Promise<SubagentWorktree> {
  const pathApi = kaos.pathClass() === 'win32' ? path.win32 : path.posix;
  if (options?.name !== undefined) validateWorktreeName(options.name);
  const id = options?.name ?? randomUUID().slice(0, 12);
  if ((options?.hooks?.summary?.['WorktreeCreate'] ?? 0) > 0) {
    const results = await options!.hooks!.trigger('WorktreeCreate', {
      matcherValue: id,
      inputData: { agentId: options?.agentId, name: id },
    });
    const worktreePath = firstWorktreePath(results);
    if (worktreePath === undefined) {
      throw new Error('WorktreeCreate hook failed: no successful hook returned a path');
    }
    if (!pathApi.isAbsolute(worktreePath)) {
      throw new Error(`WorktreeCreate hook must return an absolute path: ${worktreePath}`);
    }
    return { hookBased: true, worktreePath: pathApi.normalize(worktreePath) };
  }

  const [repoRoot, originalHead] = await Promise.all([
    runGitCommand(kaos, cwd, ['rev-parse', '--show-toplevel']),
    runGitCommand(kaos, cwd, ['rev-parse', 'HEAD']),
  ]);
  if (!repoRoot || !originalHead) {
    throw new Error('Worktree isolation requires a Git repository with a valid HEAD commit');
  }

  const pathId = options?.name === undefined ? id : id.replaceAll('/', '+');
  const worktreesDir = pathApi.join(kaos.gethome(), '.pythinker-code', 'worktrees');
  const worktreePath = pathApi.join(
    worktreesDir,
    `${sanitizePathSegment(pathApi.basename(repoRoot))}-${pathId}`,
  );
  const worktreeBranch = `${options?.branchPrefix ?? 'pythinker-agent'}-${pathId}`;
  await kaos.mkdir(worktreesDir, { parents: true, existOk: true });

  if (options?.name !== undefined) {
    const existingBranch = await runGitCommand(kaos, worktreePath, [
      'branch',
      '--show-current',
    ]);
    if (existingBranch !== null && existingBranch.length > 0) {
      if (existingBranch !== worktreeBranch) {
        throw new Error(
          `Existing worktree at ${worktreePath} uses branch ${existingBranch}, expected ${worktreeBranch}`,
        );
      }
      return { repoRoot, originalHead, worktreePath, worktreeBranch };
    }
  }

  const created = await runGitCommand(
    kaos,
    repoRoot,
    ['worktree', 'add', '-b', worktreeBranch, worktreePath, originalHead],
    GIT_WORKTREE_TIMEOUT_MS,
  );
  if (created === null) {
    if (options?.name !== undefined) {
      const attached = await runGitCommand(
        kaos,
        repoRoot,
        ['worktree', 'add', worktreePath, worktreeBranch],
        GIT_WORKTREE_TIMEOUT_MS,
      );
      if (attached !== null) {
        return { repoRoot, originalHead, worktreePath, worktreeBranch };
      }
      throw new Error(
        `Failed to create or resume named worktree "${options.name}" without modifying its existing branch`,
      );
    }
    await runGitCommand(
      kaos,
      repoRoot,
      ['worktree', 'remove', '--force', worktreePath],
      GIT_WORKTREE_TIMEOUT_MS,
    );
    await runGitCommand(kaos, repoRoot, ['branch', '-D', worktreeBranch]);
    throw new Error('Failed to create an isolated Git worktree');
  }

  return { repoRoot, originalHead, worktreePath, worktreeBranch };
}

export async function settleSubagentWorktree(
  kaos: Kaos,
  worktree: SubagentWorktree,
  hooks?: HookEngine,
  agentId?: string,
): Promise<SettledSubagentWorktree> {
  if (worktree.hookBased === true) {
    return (await removeHookWorktree(hooks, worktree.worktreePath, agentId))
      ? { kept: false }
      : kept(worktree);
  }
  const summary = await inspectWorktree(kaos, worktree);
  if (summary === null || summary.changedFiles > 0 || summary.commits > 0) {
    return kept(worktree);
  }
  if (!(await removeWorktree(kaos, worktree))) return kept(worktree);
  return { kept: false };
}

export async function inspectWorktree(
  kaos: Kaos,
  worktree: SubagentWorktree,
): Promise<WorktreeChangeSummary | null> {
  if (worktree.hookBased === true) return null;
  const [status, commitCountText] = await Promise.all([
    runGitCommand(kaos, worktree.worktreePath, ['status', '--porcelain']),
    runGitCommand(kaos, worktree.worktreePath, [
      'rev-list',
      '--count',
      `${worktree.originalHead}..HEAD`,
    ]),
  ]);
  const commitCount = commitCountText === null ? Number.NaN : Number(commitCountText);
  if (status === null || !Number.isSafeInteger(commitCount)) return null;
  return {
    changedFiles: status.split('\n').filter((line) => line.trim().length > 0).length,
    commits: commitCount,
  };
}

export async function removeWorktree(
  kaos: Kaos,
  worktree: SubagentWorktree,
  hooks?: HookEngine,
  agentId?: string,
): Promise<boolean> {
  if (worktree.hookBased === true) {
    return removeHookWorktree(hooks, worktree.worktreePath, agentId);
  }
  const removed = await runGitCommand(
    kaos,
    worktree.repoRoot,
    ['worktree', 'remove', '--force', worktree.worktreePath],
    GIT_WORKTREE_TIMEOUT_MS,
  );
  if (removed === null) return false;
  await runGitCommand(kaos, worktree.repoRoot, ['branch', '-D', worktree.worktreeBranch]);
  return true;
}

export function validateWorktreeName(name: string): void {
  if (name.length > 64) {
    throw new Error(`Invalid worktree name: must be 64 characters or fewer (got ${name.length})`);
  }
  for (const segment of name.split('/')) {
    if (
      segment === '.' ||
      segment === '..' ||
      segment.length === 0 ||
      !/^[a-zA-Z0-9._-]+$/u.test(segment)
    ) {
      throw new Error(
        `Invalid worktree name "${name}": each "/"-separated segment must contain only letters, digits, dots, underscores, and dashes`,
      );
    }
  }
}

function kept(worktree: SubagentWorktree): SettledSubagentWorktree {
  return {
    kept: true,
    worktreePath: worktree.worktreePath,
    worktreeBranch: worktree.worktreeBranch,
  };
}

async function removeHookWorktree(
  hooks: HookEngine | undefined,
  worktreePath: string,
  agentId: string | undefined,
): Promise<boolean> {
  if ((hooks?.summary?.['WorktreeRemove'] ?? 0) === 0) return false;
  await hooks!.trigger('WorktreeRemove', {
    matcherValue: worktreePath,
    inputData: { agentId, worktreePath },
  });
  return true;
}

function firstWorktreePath(results: readonly HookResult[]): string | undefined {
  for (const result of results) {
    if (
      result.action !== 'allow' ||
      result.timedOut === true ||
      (result.exitCode !== undefined &&
        result.exitCode !== 0 &&
        (result.exitCode < 200 || result.exitCode >= 300))
    ) {
      continue;
    }
    const stdout = result.stdout?.trim();
    if (stdout === undefined || stdout === '') continue;
    try {
      const parsed = JSON.parse(stdout) as {
        hookSpecificOutput?: { worktreePath?: unknown };
      };
      if (typeof parsed.hookSpecificOutput?.worktreePath === 'string') {
        return parsed.hookSpecificOutput.worktreePath.trim();
      }
    } catch {}
    return stdout;
  }
  return undefined;
}

function sanitizePathSegment(value: string): string {
  const sanitized = value.replaceAll(/[^a-zA-Z0-9._-]/gu, '-');
  return sanitized.length > 0 ? sanitized : 'repo';
}
