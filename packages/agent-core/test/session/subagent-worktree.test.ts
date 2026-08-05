import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import type { HookEngine } from '../../src/session/hooks';
import { runGitCommand } from '../../src/session/git-context';
import {
  createSubagentWorktree,
  settleSubagentWorktree,
  type SubagentWorktree,
} from '../../src/session/subagent-worktree';
import {
  listWorkingTreeChanges,
  readWorkingTreeDiff,
} from '../../src/session/working-tree';
import { SessionWorktree } from '../../src/session/worktree';
import {
  EnterWorktreeInputSchema,
  EnterWorktreeTool,
  ExitWorktreeTool,
} from '../../src/tools/builtin/worktree';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';
import { executeTool } from '../tools/fixtures/execute-tool';

vi.mock('../../src/session/git-context', () => ({
  runGitCommand: vi.fn(),
}));

afterEach(() => {
  vi.mocked(runGitCommand).mockReset();
});

describe('subagent worktree isolation', () => {
  it('uses configured worktree hooks as the create and remove backend', async () => {
    const trigger = vi
      .fn()
      .mockResolvedValueOnce([
        { action: 'allow', stdout: '/hook/worktree', exitCode: 0 },
      ])
      .mockResolvedValueOnce([{ action: 'allow', exitCode: 0 }]);
    const hooks = {
      summary: { WorktreeCreate: 1, WorktreeRemove: 1 },
      trigger,
    } as unknown as HookEngine;
    const kaos = createFakeKaos({ pathClass: () => 'posix' });

    const worktree = await createSubagentWorktree(kaos, '/repo/example', {
      name: 'feature',
      hooks,
      agentId: 'main',
    });
    const settled = await settleSubagentWorktree(kaos, worktree, hooks, 'main');

    expect(worktree).toEqual({
      hookBased: true,
      worktreePath: '/hook/worktree',
    });
    expect(settled).toEqual({ kept: false });
    expect(trigger).toHaveBeenNthCalledWith(1, 'WorktreeCreate', {
      matcherValue: 'feature',
      inputData: { agentId: 'main', name: 'feature' },
    });
    expect(trigger).toHaveBeenNthCalledWith(2, 'WorktreeRemove', {
      matcherValue: '/hook/worktree',
      inputData: { agentId: 'main', worktreePath: '/hook/worktree' },
    });
    expect(runGitCommand).not.toHaveBeenCalled();
  });

  it('creates a branch-backed worktree under the Pythinker home', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const kaos = createFakeKaos({
      gethome: () => '/home/example',
      pathClass: () => 'posix',
      mkdir,
    });
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('/repo/example')
      .mockResolvedValueOnce('abc123')
      .mockResolvedValueOnce('');

    const result = await createSubagentWorktree(kaos, '/repo/example');

    expect(mkdir).toHaveBeenCalledWith('/home/example/.pythinker-code/worktrees', {
      parents: true,
      existOk: true,
    });
    expect(result.worktreePath).toMatch(
      /^\/home\/example\/\.pythinker-code\/worktrees\/example-[0-9a-f-]{12}$/u,
    );
    expect(result.worktreeBranch).toMatch(/^pythinker-agent-[0-9a-f-]{12}$/u);
    expect(runGitCommand).toHaveBeenLastCalledWith(
      kaos,
      '/repo/example',
      ['worktree', 'add', '-b', result.worktreeBranch, result.worktreePath, 'abc123'],
      30_000,
    );
  });

  it('uses a validated explicit name for a session worktree', async () => {
    const kaos = createFakeKaos({
      gethome: () => '/home/example',
      pathClass: () => 'posix',
      mkdir: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('/repo/example')
      .mockResolvedValueOnce('abc123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('');

    const result = await createSubagentWorktree(kaos, '/repo/example', {
      name: 'user/feature',
      branchPrefix: 'pythinker-worktree',
    });

    expect(result.worktreePath).toBe(
      '/home/example/.pythinker-code/worktrees/example-user+feature',
    );
    expect(result.worktreeBranch).toBe('pythinker-worktree-user+feature');
  });

  it('resumes an existing named worktree without recreating its branch', async () => {
    const kaos = createFakeKaos({
      gethome: () => '/home/example',
      pathClass: () => 'posix',
      mkdir: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('/repo/example')
      .mockResolvedValueOnce('abc123')
      .mockResolvedValueOnce('pythinker-worktree-feature');

    await expect(
      createSubagentWorktree(kaos, '/repo/example', {
        name: 'feature',
        branchPrefix: 'pythinker-worktree',
      }),
    ).resolves.toMatchObject({
      worktreeBranch: 'pythinker-worktree-feature',
    });
    expect(runGitCommand).toHaveBeenCalledTimes(3);
  });

  it('keeps a worktree when it has changes', async () => {
    const kaos = createFakeKaos();
    const worktree = fixture();
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(' M src/index.ts')
      .mockResolvedValueOnce('0');

    await expect(settleSubagentWorktree(kaos, worktree)).resolves.toEqual({
      kept: true,
      worktreePath: worktree.worktreePath,
      worktreeBranch: worktree.worktreeBranch,
    });
    expect(runGitCommand).toHaveBeenCalledTimes(2);
  });

  it('removes only a verified clean worktree and its generated branch', async () => {
    const kaos = createFakeKaos();
    const worktree = fixture();
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');

    await expect(settleSubagentWorktree(kaos, worktree)).resolves.toEqual({ kept: false });
    expect(runGitCommand).toHaveBeenNthCalledWith(
      3,
      kaos,
      worktree.repoRoot,
      ['worktree', 'remove', '--force', worktree.worktreePath],
      30_000,
    );
    expect(runGitCommand).toHaveBeenNthCalledWith(
      4,
      kaos,
      worktree.repoRoot,
      ['branch', '-D', worktree.worktreeBranch],
    );
  });
});

describe('session worktree lifecycle', () => {
  it('enters and removes a hook-created session worktree', async () => {
    const agent = fakeAgent();
    Object.defineProperty(agent.hooks, 'summary', {
      value: { WorktreeCreate: 1, WorktreeRemove: 1 },
    });
    vi.mocked(agent.hooks!.trigger).mockImplementation(async (event) => {
      return event === 'WorktreeCreate'
        ? [{ action: 'allow', stdout: '/hook/session-worktree', exitCode: 0 }]
        : [];
    });
    const worktree = new SessionWorktree();

    await expect(worktree.enter(agent, 'feature')).resolves.toMatchObject({
      hookBased: true,
      worktreePath: '/hook/session-worktree',
    });
    await expect(worktree.exit(agent, { action: 'remove' })).resolves.toMatchObject({
      action: 'remove',
      originalCwd: '/repo/example',
      worktreePath: '/hook/session-worktree',
    });

    expect(agent.hooks?.trigger).toHaveBeenCalledWith('WorktreeRemove', {
      matcherValue: '/hook/session-worktree',
      inputData: {
        agentId: agent.agentId,
        worktreePath: '/hook/session-worktree',
      },
    });
    expect(runGitCommand).not.toHaveBeenCalled();
  });

  it('lists bounded working-tree changes with line counts', async () => {
    const kaos = createFakeKaos({
      getcwd: () => '/repo/example',
      pathClass: () => 'posix',
    });
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('feature')
      .mockResolvedValueOnce(' M src/main.ts\0?? notes.txt\0')
      .mockResolvedValueOnce('2\t1\tsrc/main.ts\0');

    await expect(listWorkingTreeChanges(kaos, '/repo/example')).resolves.toEqual({
      branch: 'feature',
      additions: 2,
      deletions: 1,
      truncated: false,
      files: [
        {
          path: 'notes.txt',
          status: 'untracked',
          additions: 0,
          deletions: 0,
          binary: false,
        },
        {
          path: 'src/main.ts',
          status: 'modified',
          additions: 2,
          deletions: 1,
          binary: false,
        },
      ],
    });
  });

  it('reads an untracked file diff without allowing paths outside the workspace', async () => {
    const kaos = createFakeKaos({
      getcwd: () => '/repo/example',
      pathClass: () => 'posix',
    });
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('true')
      .mockResolvedValueOnce('?? notes.txt\0')
      .mockResolvedValueOnce('abc123')
      .mockResolvedValueOnce('diff --git a/notes.txt b/notes.txt\n+new note');

    await expect(readWorkingTreeDiff(kaos, '/repo/example', 'notes.txt')).resolves.toEqual({
      path: 'notes.txt',
      diff: 'diff --git a/notes.txt b/notes.txt\n+new note',
      truncated: false,
    });
    await expect(
      readWorkingTreeDiff(kaos, '/repo/example', '../secret.txt'),
    ).rejects.toThrow('outside the working directory');
  });

  it('switches the agent into a worktree and restores cwd while keeping it', async () => {
    const agent = fakeAgent();
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('/repo/example')
      .mockResolvedValueOnce('abc123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('');
    const worktree = new SessionWorktree();

    const entered = await worktree.enter(agent, 'feature');
    expect(agent.config.cwd).toBe(entered.worktreePath);
    expect(agent.lsp?.rebindRoot).toHaveBeenLastCalledWith(entered.worktreePath);
    expect(agent.hooks?.trigger).toHaveBeenLastCalledWith('CwdChanged', {
      inputData: {
        agentId: agent.agentId,
        oldCwd: '/repo/example',
        newCwd: entered.worktreePath,
      },
    });

    const exited = await worktree.exit(agent, { action: 'keep' });
    expect(exited).toMatchObject({
      action: 'keep',
      originalCwd: '/repo/example',
      worktreePath: entered.worktreePath,
    });
    expect(agent.config.cwd).toBe('/repo/example');
    expect(agent.lsp?.rebindRoot).toHaveBeenLastCalledWith('/repo/example');
    expect(agent.hooks?.trigger).toHaveBeenLastCalledWith('CwdChanged', {
      inputData: {
        agentId: agent.agentId,
        oldCwd: entered.worktreePath,
        newCwd: '/repo/example',
      },
    });
    await expect(worktree.get()).resolves.toBeNull();
  });

  it('fails closed on dirty removal until discard is explicit', async () => {
    const agent = fakeAgent();
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('/repo/example')
      .mockResolvedValueOnce('abc123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(' M src/index.ts')
      .mockResolvedValueOnce('2');
    const worktree = new SessionWorktree();
    await worktree.enter(agent, 'feature');

    await expect(worktree.exit(agent, { action: 'remove' })).rejects.toThrow(
      '1 uncommitted file and 2 commits',
    );

    vi.mocked(runGitCommand)
      .mockResolvedValueOnce(' M src/index.ts')
      .mockResolvedValueOnce('2')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    await expect(
      worktree.exit(agent, { action: 'remove', discardChanges: true }),
    ).resolves.toMatchObject({
      action: 'remove',
      discardedFiles: 1,
      discardedCommits: 2,
    });
  });

  it('exposes enter and exit through guarded agent-callable tools', async () => {
    expect(() => EnterWorktreeInputSchema.parse({ name: '../escape' })).toThrow(
      'Invalid worktree name',
    );
    const agent = fakeAgent();
    const worktree = new SessionWorktree();
    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('/repo/example')
      .mockResolvedValueOnce('abc123')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('');

    const entered = await executeTool(new EnterWorktreeTool(worktree, agent), {
      turnId: '0',
      toolCallId: 'enter_worktree',
      args: { name: 'feature' },
      signal: new AbortController().signal,
    });
    expect(entered.output).toContain('The session is now working in the worktree');

    vi.mocked(runGitCommand)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('0')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    const exited = await executeTool(new ExitWorktreeTool(worktree, agent), {
      turnId: '0',
      toolCallId: 'exit_worktree',
      args: { action: 'remove' as const },
      signal: new AbortController().signal,
    });
    expect(exited.isError).not.toBe(true);
    expect(exited.output).toContain('Exited and removed worktree');
  });
});

function fixture(): SubagentWorktree {
  return {
    repoRoot: '/repo/example',
    originalHead: 'abc123',
    worktreePath: '/home/example/.pythinker-code/worktrees/example-test',
    worktreeBranch: 'pythinker-agent-test',
  };
}

function fakeAgent(): Agent {
  let kaos = createFakeKaos({
    getcwd: () => '/repo/example',
    gethome: () => '/home/example',
    mkdir: vi.fn().mockResolvedValue(undefined),
  });
  const config = {
    cwd: '/repo/example',
    update: vi.fn((changed: { cwd?: string }) => {
      if (changed.cwd !== undefined) config.cwd = changed.cwd;
    }),
  };
  return {
    get kaos() {
      return kaos;
    },
    setKaos: vi.fn((next) => {
      kaos = next;
    }),
    config,
    lsp: { rebindRoot: vi.fn().mockResolvedValue(undefined) },
    hooks: { setCwd: vi.fn(), trigger: vi.fn().mockResolvedValue([]) },
    context: { appendSystemReminder: vi.fn() },
  } as unknown as Agent;
}
