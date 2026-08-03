import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import { SessionTaskGraph } from '../../src/agent/task-graph';
import { SessionTeam } from '../../src/session/team';
import { TaskUpdateTool } from '../../src/tools/builtin/collaboration/task-graph';
import {
  SendMessageInputSchema,
  SendMessageTool,
  TeamCreateTool,
  TeamDeleteTool,
} from '../../src/tools/builtin/collaboration/team';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;
const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function fakeAgent(active = true): Agent {
  return {
    turn: {
      hasActiveTurn: active,
      steer: vi.fn(() => null),
      waitForCurrentTurn: vi.fn(),
      cancel: vi.fn(),
    },
  } as unknown as Agent;
}

function fakeSession(agents: Record<string, Agent>) {
  return {
    ensureAgentResumed: vi.fn(async (id: string) => {
      const agent = agents[id];
      if (agent === undefined) throw new Error(`Agent ${id} not found`);
      return agent;
    }),
  };
}

describe('SessionTeam', () => {
  it('persists one named roster and only deletes it after teammates become idle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pythinker-team-'));
    tempDirs.push(dir);
    const path = join(dir, 'team.json');
    const session = fakeSession({ main: fakeAgent(), 'agent-1': fakeAgent() });
    const team = new SessionTeam(session, path);

    await team.create({
      name: 'porters',
      description: 'Port the remaining runtime',
      agentType: 'lead',
      leadModel: 'default-mock',
    });
    await team.join({
      teamName: 'porters',
      agentId: 'agent-1',
      name: 'runtime',
      agentType: 'coder',
      model: 'default-mock',
    });

    await expect(team.delete()).resolves.toMatchObject({ success: false });
    await team.markIdle('agent-1');

    const restored = new SessionTeam(session, path);
    await expect(restored.get()).resolves.toMatchObject({
      name: 'porters',
      members: [
        { agentId: 'main', name: 'team-lead' },
        { agentId: 'agent-1', name: 'runtime', status: 'idle' },
      ],
    });
    await expect(restored.delete()).resolves.toMatchObject({
      success: true,
      teamName: 'porters',
    });
    await expect(restored.get()).resolves.toBeNull();
  });

  it('lets a TeammateIdle hook keep a teammate active for another turn', async () => {
    let finishTurn!: () => void;
    const turnFinished = new Promise<void>((resolve) => {
      finishTurn = resolve;
    });
    const teammate = fakeAgent();
    const triggerBlock = vi
      .fn()
      .mockResolvedValueOnce({ block: true, reason: 'Run the focused tests first.' })
      .mockResolvedValueOnce(undefined);
    Object.assign(teammate, {
      hooks: { triggerBlock },
      turn: {
        hasActiveTurn: false,
        steer: vi.fn(() => 2),
        waitForCurrentTurn: vi.fn(() => turnFinished),
        cancel: vi.fn(),
      },
    });
    const team = new SessionTeam(fakeSession({ main: fakeAgent(), 'agent-1': teammate }));
    await team.create({ name: 'porters', leadModel: 'default-mock' });
    await team.join({
      teamName: 'porters',
      agentId: 'agent-1',
      name: 'runtime',
      agentType: 'coder',
      model: 'default-mock',
    });

    await team.markIdle('agent-1');

    expect(await team.get()).toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ agentId: 'agent-1', status: 'active' }),
      ]),
    });
    expect(triggerBlock).toHaveBeenCalledWith('TeammateIdle', {
      matcherValue: 'runtime',
      inputData: {
        agentId: 'agent-1',
        teammateName: 'runtime',
        teamName: 'porters',
      },
    });
    expect(teammate.turn.steer).toHaveBeenCalledWith(
      [{ type: 'text', text: 'Run the focused tests first.' }],
      { kind: 'hook_result', event: 'TeammateIdle' },
    );

    finishTurn();
    await vi.waitFor(async () => {
      expect(await team.get()).toMatchObject({
        members: expect.arrayContaining([
          expect.objectContaining({ agentId: 'agent-1', status: 'idle' }),
        ]),
      });
    });
  });

  it('switches the shared task graph to a team scope and restores session tasks on delete', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pythinker-team-'));
    tempDirs.push(dir);
    const graph = new SessionTaskGraph(join(dir, 'tasks.json'));
    await graph.create({ subject: 'Session task', description: 'Keep this task.' });
    const team = new SessionTeam(
      fakeSession({ main: fakeAgent() }),
      join(dir, 'team.json'),
      graph,
    );

    await team.create({ name: 'porters', leadModel: 'default-mock' });
    expect(await graph.list()).toEqual([]);
    await graph.create({ subject: 'Team task', description: 'Team-only task.' });
    expect(await graph.list()).toMatchObject([{ id: '1', subject: 'Team task' }]);

    await team.delete();
    expect(await graph.list()).toMatchObject([{ id: '1', subject: 'Session task' }]);
  });

  it('delivers direct, broadcast, and shutdown protocol messages by member name', async () => {
    const main = fakeAgent();
    const runtime = fakeAgent();
    const tests = fakeAgent();
    const team = new SessionTeam(
      fakeSession({ main, 'agent-1': runtime, 'agent-2': tests }),
    );
    await team.create({ name: 'porters', leadModel: 'default-mock' });
    await team.join({
      teamName: 'porters',
      agentId: 'agent-1',
      name: 'runtime',
      agentType: 'coder',
      model: 'default-mock',
    });
    await team.join({
      teamName: 'porters',
      agentId: 'agent-2',
      name: 'tests',
      agentType: 'coder',
      model: 'default-mock',
    });

    await team.send('main', {
      to: 'runtime',
      summary: 'Start task one',
      message: 'Please claim task #1.',
    });
    await team.send('agent-1', {
      to: '*',
      summary: 'Runtime status',
      message: 'The runtime slice is ready.',
    });
    const request = await team.send('main', {
      to: 'runtime',
      message: { type: 'shutdown_request', reason: 'Work is complete' },
    });
    await team.send('agent-1', {
      to: 'team-lead',
      message: {
        type: 'shutdown_response',
        request_id: request.requestId!,
        approve: true,
      },
    });

    expect(runtime.turn.steer).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('Please claim task #1.') }),
      ]),
      expect.anything(),
    );
    expect(main.turn.steer).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining('The runtime slice is ready.') }),
      ]),
      expect.anything(),
    );
    expect(tests.turn.steer).toHaveBeenCalled();
    await expect(team.get()).resolves.toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ name: 'runtime', status: 'shutdown' }),
      ]),
    });
  });
});

describe('team tools', () => {
  it('validates message summaries and structured routing', () => {
    expect(() =>
      SendMessageInputSchema.parse({ to: 'runtime', message: 'Start task #1.' }),
    ).toThrow('summary is required');
    expect(() =>
      SendMessageInputSchema.parse({
        to: '*',
        message: { type: 'shutdown_request' },
      }),
    ).toThrow('structured messages cannot be broadcast');
    expect(() =>
      SendMessageInputSchema.parse({
        to: 'runtime',
        message: {
          type: 'shutdown_response',
          request_id: 'request-1',
          approve: true,
        },
      }),
    ).toThrow('team-lead');
  });

  it('creates, messages, and deletes a team through agent-callable tools', async () => {
    const main = fakeAgent();
    const teammate = fakeAgent();
    const team = new SessionTeam(fakeSession({ main, 'agent-1': teammate }));
    const create = new TeamCreateTool(team, 'default-mock');
    const send = new SendMessageTool(team, 'main');
    const remove = new TeamDeleteTool(team);

    const created = await executeTool(create, {
      turnId: '0',
      toolCallId: 'create_team',
      args: { team_name: 'porters', description: 'Port runtime features' },
      signal,
    });
    expect(created.output).toContain('"team_name": "porters"');

    await team.join({
      teamName: 'porters',
      agentId: 'agent-1',
      name: 'runtime',
      agentType: 'coder',
      model: 'default-mock',
    });
    const sent = await executeTool(send, {
      turnId: '0',
      toolCallId: 'send_message',
      args: {
        to: 'runtime',
        summary: 'Start task one',
        message: 'Claim task #1.',
      },
      signal,
    });
    expect(sent.output).toContain('"success": true');

    const activeDelete = await executeTool(remove, {
      turnId: '0',
      toolCallId: 'delete_team',
      args: {},
      signal,
    });
    expect(activeDelete.output).toContain('"success": false');
  });

  it('auto-claims in-progress tasks and notifies a newly assigned teammate', async () => {
    const main = fakeAgent();
    const runtime = fakeAgent();
    const team = new SessionTeam(fakeSession({ main, 'agent-1': runtime }));
    await team.create({ name: 'porters', leadModel: 'default-mock' });
    await team.join({
      teamName: 'porters',
      agentId: 'agent-1',
      name: 'runtime',
      agentType: 'coder',
      model: 'default-mock',
    });
    const graph = new SessionTaskGraph();
    const task = await graph.create({ subject: 'Port runtime', description: 'Complete the port.' });
    const assigned = await graph.create({
      subject: 'Verify runtime',
      description: 'Verify the port.',
    });

    await executeTool(new TaskUpdateTool(graph, team, 'agent-1'), {
      turnId: '0',
      toolCallId: 'claim_task',
      args: { taskId: task.id, status: 'in_progress' as const },
      signal,
    });
    expect(await graph.get(task.id)).toMatchObject({ owner: 'runtime' });

    await executeTool(new TaskUpdateTool(graph, team, 'main'), {
      turnId: '0',
      toolCallId: 'assign_task',
      args: { taskId: assigned.id, owner: 'runtime' },
      signal,
    });
    expect(runtime.turn.steer).toHaveBeenCalled();
  });
});
