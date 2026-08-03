import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'pathe';
import { z } from 'zod';

import type { Agent } from '../agent';
import {
  createSubagentWorktree,
  inspectWorktree,
  removeWorktree,
  type SubagentWorktree,
} from './subagent-worktree';

const SessionWorktreeStateSchema = z.union([
  z.object({
    version: z.literal(1),
    originalCwd: z.string(),
    hookBased: z.literal(true),
    worktreePath: z.string(),
    repoRoot: z.undefined().optional(),
    originalHead: z.undefined().optional(),
    worktreeBranch: z.undefined().optional(),
  }),
  z.object({
    version: z.literal(1),
    originalCwd: z.string(),
    hookBased: z.literal(false).optional(),
    repoRoot: z.string(),
    originalHead: z.string(),
    worktreePath: z.string(),
    worktreeBranch: z.string(),
  }),
]);

export type SessionWorktreeState = z.infer<typeof SessionWorktreeStateSchema>;

export interface ExitSessionWorktreeResult {
  readonly action: 'keep' | 'remove';
  readonly originalCwd: string;
  readonly worktreePath: string;
  readonly worktreeBranch?: string;
  readonly discardedFiles?: number;
  readonly discardedCommits?: number;
}

export class SessionWorktree {
  private state: SessionWorktreeState | null = null;
  private readonly ready: Promise<void>;
  private mutation = Promise.resolve();

  constructor(private readonly persistencePath?: string) {
    this.ready = this.load();
  }

  async get(): Promise<SessionWorktreeState | null> {
    await this.ready;
    return this.state === null ? null : { ...this.state };
  }

  enter(agent: Agent, name?: string): Promise<SessionWorktreeState> {
    return this.mutate(async () => {
      if (this.state !== null) throw new Error('Already in a worktree session');
      const originalCwd = agent.config.cwd;
      const worktree = await createSubagentWorktree(agent.kaos, originalCwd, {
        name,
        branchPrefix: 'pythinker-worktree',
        hooks: agent.hooks,
        agentId: agent.agentId,
      });
      this.state = { version: 1, originalCwd, ...worktree };
      try {
        await switchAgentCwd(agent, worktree.worktreePath);
        await this.persist();
      } catch (error) {
        await removeWorktree(agent.kaos, worktree, agent.hooks, agent.agentId);
        this.state = null;
        throw error;
      }
      return { ...this.state };
    });
  }

  exit(
    agent: Agent,
    input: { readonly action: 'keep' | 'remove'; readonly discardChanges?: boolean },
  ): Promise<ExitSessionWorktreeResult> {
    return this.mutate(async () => {
      const state = this.state;
      if (state === null) {
        throw new Error(
          'No-op: there is no active EnterWorktree session to exit. No filesystem changes were made.',
        );
      }
      const worktree: SubagentWorktree = state;
      let changedFiles = 0;
      let commits = 0;
      let restoredCwd = false;
      if (input.action === 'remove') {
        if (worktree.hookBased === true) {
          if ((agent.hooks?.summary?.['WorktreeRemove'] ?? 0) === 0) {
            throw new Error(
              `No WorktreeRemove hook is configured for hook-created worktree ${state.worktreePath}`,
            );
          }
          await switchAgentCwd(agent, state.originalCwd);
          restoredCwd = true;
        } else {
          const summary = await inspectWorktree(agent.kaos, worktree);
          if (summary === null && input.discardChanges !== true) {
            throw new Error(
              `Could not verify worktree state at ${state.worktreePath}. Refusing to remove without discard_changes: true.`,
            );
          }
          changedFiles = summary?.changedFiles ?? 0;
          commits = summary?.commits ?? 0;
          if ((changedFiles > 0 || commits > 0) && input.discardChanges !== true) {
            throw new Error(changeWarning(state, changedFiles, commits));
          }
        }
        if (!(await removeWorktree(agent.kaos, worktree, agent.hooks, agent.agentId))) {
          throw new Error(`Failed to remove worktree at ${state.worktreePath}`);
        }
      }

      if (!restoredCwd) await switchAgentCwd(agent, state.originalCwd);
      this.state = null;
      await this.removePersisted();
      return {
        action: input.action,
        originalCwd: state.originalCwd,
        worktreePath: state.worktreePath,
        worktreeBranch: state.worktreeBranch,
        discardedFiles: input.action === 'remove' ? changedFiles : undefined,
        discardedCommits: input.action === 'remove' ? commits : undefined,
      };
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(async () => {
      await this.ready;
      return operation();
    });
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<void> {
    if (this.persistencePath === undefined) return;
    try {
      this.state = SessionWorktreeStateSchema.parse(
        JSON.parse(await readFile(this.persistencePath, 'utf-8')) as unknown,
      );
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }

  private async persist(): Promise<void> {
    if (this.persistencePath === undefined || this.state === null) return;
    await mkdir(dirname(this.persistencePath), { recursive: true });
    const temporaryPath = `${this.persistencePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf-8');
    await rename(temporaryPath, this.persistencePath);
  }

  private async removePersisted(): Promise<void> {
    if (this.persistencePath === undefined) return;
    try {
      await unlink(this.persistencePath);
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
  }
}

async function switchAgentCwd(agent: Agent, cwd: string): Promise<void> {
  const oldCwd = agent.config.cwd;
  await agent.kaos.chdir(cwd);
  agent.setKaos(agent.kaos.withCwd(cwd));
  // Recreate LSP connections under the new worktree root so workspace paths stay aligned.
  await agent.lsp?.rebindRoot(cwd);
  agent.config.update({ cwd });
  await agent.hooks?.setCwd(cwd);
  await agent.hooks?.trigger('CwdChanged', {
    inputData: {
      agentId: agent.agentId,
      oldCwd,
      newCwd: cwd,
    },
  });
  agent.context.appendSystemReminder(`The session working directory is now ${cwd}.`, {
    kind: 'system_trigger',
    name: 'worktree',
  });
}

function changeWarning(
  state: SessionWorktreeState,
  changedFiles: number,
  commits: number,
): string {
  const parts: string[] = [];
  if (changedFiles > 0) {
    parts.push(`${changedFiles} uncommitted ${changedFiles === 1 ? 'file' : 'files'}`);
  }
  if (commits > 0) {
    parts.push(`${commits} ${commits === 1 ? 'commit' : 'commits'}`);
  }
  return `Worktree has ${parts.join(' and ')}. Removing will discard work from ${state.worktreePath}. Confirm with the user, then re-invoke with discard_changes: true.`;
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
