import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it } from 'vitest';

import { SessionTaskGraph } from '../../src/agent/task-graph';
import { HookEngine } from '../../src/session/hooks';
import {
  TaskCreateTool,
  TaskGetTool,
  TaskGraphListTool,
  TaskUpdateTool,
} from '../../src/tools/builtin/collaboration/task-graph';
import { createBackgroundManager } from '../agent/background/helpers';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('SessionTaskGraph', () => {
  it('maintains symmetric dependencies and rejects cycles', async () => {
    const graph = new SessionTaskGraph();
    const first = await graph.create({
      subject: 'Build core',
      description: 'Build the shared core.',
    });
    const second = await graph.create({
      subject: 'Wire UI',
      description: 'Wire the UI after core.',
    });

    await graph.update(second.id, { addBlockedBy: [first.id] });

    expect(await graph.get(first.id)).toMatchObject({ blocks: [second.id] });
    expect(await graph.get(second.id)).toMatchObject({ blockedBy: [first.id] });
    await expect(graph.update(first.id, { addBlockedBy: [second.id] })).rejects.toThrow(
      'dependency cycle',
    );
  });

  it('persists task IDs and records across graph instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pythinker-task-graph-'));
    tempDirs.push(dir);
    const path = join(dir, 'tasks.json');
    const firstGraph = new SessionTaskGraph(path);
    await firstGraph.create({ subject: 'First', description: 'First task.' });
    await firstGraph.create({ subject: 'Second', description: 'Second task.' });

    const restored = new SessionTaskGraph(path);

    expect(await restored.list()).toHaveLength(2);
    await expect(
      restored.create({ subject: 'Third', description: 'Third task.' }),
    ).resolves.toMatchObject({ id: '3' });
  });
});

describe('task graph tools', () => {
  it('creates, reads, updates, and lists project tasks', async () => {
    const graph = new SessionTaskGraph();
    const create = new TaskCreateTool(graph);
    const get = new TaskGetTool(graph);
    const update = new TaskUpdateTool(graph);
    const list = new TaskGraphListTool(graph, createBackgroundManager().manager);

    const created = await executeTool(create, {
      turnId: '0',
      toolCallId: 'call_create',
      args: {
        subject: 'Verify port',
        description: 'Run the focused verification.',
        activeForm: 'Verifying port',
        metadata: { scope: 'core' },
      },
      signal,
    });
    expect(created.output).toContain('Task #1 created successfully');

    const updated = await executeTool(update, {
      turnId: '0',
      toolCallId: 'call_update',
      args: {
        taskId: '1',
        status: 'in_progress' as const,
        owner: 'reviewer',
        metadata: { scope: null, gate: 'focused' },
      },
      signal,
    });
    expect(updated.output).toContain('status');
    expect(updated.output).toContain('owner');

    const fetched = await executeTool(get, {
      turnId: '0',
      toolCallId: 'call_get',
      args: { taskId: '1' },
      signal,
    });
    expect(fetched.output).toContain('Task #1: Verify port');
    expect(fetched.output).toContain('Owner: reviewer');
    expect(fetched.output).toContain('"gate": "focused"');
    expect(fetched.output).not.toContain('"scope"');

    const listed = await executeTool(list, {
      turnId: '0',
      toolCallId: 'call_list',
      args: {},
      signal,
    });
    expect(listed.output).toContain('#1 [in_progress] Verify port (reviewer)');
  });

  it('keeps background task listing available through an explicit mode', async () => {
    const background = createBackgroundManager().manager;
    const list = new TaskGraphListTool(new SessionTaskGraph(), background);

    const result = await executeTool(list, {
      turnId: '0',
      toolCallId: 'call_list',
      args: { background: true },
      signal,
    });

    expect(result.output).toContain('active_background_tasks: 0');
  });

  it('rolls back task creation when a TaskCreated hook blocks', async () => {
    const graph = new SessionTaskGraph();
    const hooks = new HookEngine([
      { event: 'TaskCreated', matcher: 'ignored-by-source', command: 'exit 2' },
    ]);
    const create = new TaskCreateTool(graph, hooks, 'main');

    const result = await executeTool(create, {
      turnId: '0',
      toolCallId: 'call_create_blocked',
      args: { subject: 'Blocked task', description: 'Must not persist.' },
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('TaskCreated hook feedback');
    expect(await graph.list()).toEqual([]);
  });

  it('prevents task completion when a TaskCompleted hook blocks', async () => {
    const graph = new SessionTaskGraph();
    const task = await graph.create({
      subject: 'Verify task',
      description: 'Completion requires approval.',
    });
    const hooks = new HookEngine([
      { event: 'TaskCompleted', matcher: 'ignored-by-source', command: 'exit 2' },
    ]);
    const update = new TaskUpdateTool(graph, undefined, 'main', true, hooks);

    const result = await executeTool(update, {
      turnId: '0',
      toolCallId: 'call_complete_blocked',
      args: { taskId: task.id, status: 'completed' as const },
      signal,
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain('TaskCompleted hook feedback');
    expect(await graph.get(task.id)).toMatchObject({ status: 'pending' });
  });

  it('treats a missing update as a benign result and allows clearing an owner', async () => {
    const graph = new SessionTaskGraph();
    const update = new TaskUpdateTool(graph);
    const task = await graph.create({ subject: 'Claim me', description: 'Ownership test.' });
    await graph.update(task.id, { owner: 'reviewer' });

    const cleared = await executeTool(update, {
      turnId: '0',
      toolCallId: 'call_clear',
      args: { taskId: task.id, owner: '' },
      signal,
    });
    const missing = await executeTool(update, {
      turnId: '0',
      toolCallId: 'call_missing',
      args: { taskId: '999', status: 'completed' as const },
      signal,
    });

    expect(cleared.isError).not.toBe(true);
    expect(await graph.get(task.id)).not.toHaveProperty('owner');
    expect(missing).toMatchObject({ output: 'Task #999 not found' });
    expect(missing.isError).not.toBe(true);
  });

  it('requests independent verification when the last of three unverified tasks closes', async () => {
    const graph = new SessionTaskGraph();
    const update = new TaskUpdateTool(graph);
    const first = await graph.create({ subject: 'Implement feature', description: 'Build it.' });
    const second = await graph.create({ subject: 'Wire interface', description: 'Connect it.' });
    const third = await graph.create({ subject: 'Update tests', description: 'Cover it.' });
    await graph.update(first.id, { status: 'completed' });
    await graph.update(second.id, { status: 'completed' });

    const result = await executeTool(update, {
      turnId: '0',
      toolCallId: 'call_complete',
      args: { taskId: third.id, status: 'completed' as const },
      signal,
    });

    expect(result.output).toContain('subagent_type="verification"');
    expect(result.output).toContain('VERDICT');
  });
});
