import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
  agentStatusUpdatedEventSchema,
  agentEventSchema,
  assistantDeltaEventSchema,
  eventSchema,
  hookStatusEventSchema,
  subagentCompletedEventSchema,
  subagentFailedEventSchema,
  subagentSpawnedEventSchema,
  subagentStartedEventSchema,
  subagentSuspendedEventSchema,
  toolCallStartedEventSchema,
  workflowWarningEventSchema,
} from '../events';
import type { Event } from '../events';
import type { ToolInputDisplay } from '../display';

type _AssertEventNonNever = Event extends never ? never : true;
const _assertEvent: _AssertEventNonNever = true;

type _AssertToolInputDisplayNonNever = ToolInputDisplay extends never ? never : true;
const _assertDisplay: _AssertToolInputDisplayNonNever = true;

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const sdkPackageName = ['@pythoughts', 'pythinker-code-sdk'].join('/');

function readPackageFiles(): string {
  const files = ['package.json', ...sourceFiles(join(packageRoot, 'src'))];
  return files
    .map((file) => readFileSync(join(packageRoot, file), 'utf8'))
    .join('\n');
}

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts')) {
      files.push(relative(packageRoot, full));
    }
  }
  return files;
}

describe('events / display re-exports', () => {
  it('does not depend on the node SDK package', () => {
    expect(readPackageFiles()).not.toContain(sdkPackageName);
  });

  it('Event re-export is non-never (compile-time check passed)', () => {
    expect(_assertEvent).toBe(true);
  });

  it('ToolInputDisplay re-export is non-never (12-arm union preserved)', () => {
    expect(_assertDisplay).toBe(true);
  });

  it('validates concrete agent event payloads with Zod schemas', () => {
    expect(
      assistantDeltaEventSchema.parse({
        type: 'assistant.delta',
        turnId: 1,
        delta: 'hello',
      }),
    ).toEqual({
      type: 'assistant.delta',
      turnId: 1,
      delta: 'hello',
    });

    expect(
      toolCallStartedEventSchema.safeParse({
        type: 'tool.call.started',
        turnId: 1,
        toolCallId: 'call_1',
        name: 'bash',
        args: { command: 'pwd' },
        display: { kind: 'command', command: 'pwd', language: 'bash' },
      }).success,
    ).toBe(true);
    expect(
      toolCallStartedEventSchema.safeParse({
        type: 'tool.call.started',
        turnId: 1,
        toolCallId: 'call_2',
        name: 'PowerShell',
        args: { command: 'Get-Location' },
        display: { kind: 'command', command: 'Get-Location', language: 'powershell' },
      }).success,
    ).toBe(true);
  });

  it('uses dynamic workflow fields and rejects the removed swarm fields', () => {
    expect(
      agentStatusUpdatedEventSchema.parse({
        type: 'agent.status.updated',
        dynamicWorkflowMode: true,
        fastMode: true,
        fastModeSupported: true,
      }),
    ).toMatchObject({
      dynamicWorkflowMode: true,
      fastMode: true,
      fastModeSupported: true,
    });
    expect(
      subagentSpawnedEventSchema.safeParse({
        type: 'subagent.spawned',
        subagentId: 'agent-1',
        subagentName: 'reviewer',
        parentToolCallId: 'call-1',
        swarmIndex: 1,
        runInBackground: false,
      }).success,
    ).toBe(false);
    expect(
      agentStatusUpdatedEventSchema.safeParse({
        type: 'agent.status.updated',
        swarmMode: true,
      }).success,
    ).toBe(false);
  });

  it('preserves optional parent tool call identity on subagent lifecycle events', () => {
    // parentToolCallId is optional: subagents can be spawned outside a tool
    // call (e.g. fire-and-forget), but when present it must survive a round-trip.
    const lifecycleEvents = [
      {
        schema: subagentStartedEventSchema,
        event: { type: 'subagent.started', subagentId: 'agent-1' },
      },
      {
        schema: subagentSuspendedEventSchema,
        event: { type: 'subagent.suspended', subagentId: 'agent-1', reason: 'queued' },
      },
      {
        schema: subagentCompletedEventSchema,
        event: { type: 'subagent.completed', subagentId: 'agent-1', resultSummary: 'done' },
      },
      {
        schema: subagentFailedEventSchema,
        event: { type: 'subagent.failed', subagentId: 'agent-1', error: 'failed' },
      },
    ] as const;

    for (const { schema, event } of lifecycleEvents) {
      const withParent = { ...event, parentToolCallId: 'call-1' };
      expect(schema.parse(withParent)).toEqual(withParent);
      expect(schema.safeParse(event).success).toBe(true);
    }
  });

  it('validates workflow.warning events and requires a run id', () => {
    const warning = {
      type: 'workflow.warning' as const,
      workflowRunId: 'wfr-test-001',
      parentToolCallId: 'call_1',
      agentCount: 26,
      threshold: 25,
      message: 'This Dynamic Workflow will launch 26 subagents, above the advisory ceiling of 25; the run is proceeding anyway.',
    };

    expect(workflowWarningEventSchema.parse(warning)).toEqual(warning);
    // Also through the union: registering the schema but forgetting the
    // discriminatedUnion member would leave the event unserializable.
    expect(agentEventSchema.parse(warning)).toEqual(warning);
    expect(
      workflowWarningEventSchema.safeParse({
        type: 'workflow.warning',
        agentCount: 26,
        threshold: 25,
        message: 'missing run id',
      }).success,
    ).toBe(false);
    expect(
      workflowWarningEventSchema.safeParse({
        type: 'workflow.warning',
        workflowRunId: 'wfr-test-001',
        agentCount: 26,
        threshold: 25,
        message: 'missing parent tool call id',
      }).success,
    ).toBe(false);
  });

  it('validates model rates and accumulated spend while rejecting unknown status keys', () => {
    const status = {
      type: 'agent.status.updated' as const,
      modelCostRates: {
        input: 1,
        output: 2,
        cacheRead: 0.25,
        cacheWrite: 1.5,
      },
      usage: {
        totalCostUsd: 3.75,
      },
    };

    expect(agentStatusUpdatedEventSchema.parse(status)).toEqual(status);
    expect(
      agentStatusUpdatedEventSchema.safeParse({
        ...status,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      agentStatusUpdatedEventSchema.safeParse({
        ...status,
        modelCostRates: { input: -1 },
      }).success,
    ).toBe(false);
  });

  it('rejects removed workflow fields through the event envelope', () => {
    expect(
      eventSchema.safeParse({
        type: 'agent.status.updated',
        agentId: 'agent-1',
        sessionId: 'session-1',
        swarmMode: true,
      }).success,
    ).toBe(false);
    expect(
      eventSchema.safeParse({
        type: 'subagent.spawned',
        agentId: 'agent-1',
        sessionId: 'session-1',
        subagentId: 'agent-2',
        subagentName: 'reviewer',
        parentToolCallId: 'call-1',
        swarmIndex: 1,
        runInBackground: false,
      }).success,
    ).toBe(false);
  });

  it('validates volatile hook status events', () => {
    expect(
      hookStatusEventSchema.parse({
        type: 'hook.status',
        statusId: 'hook-1',
        hookEvent: 'Stop',
        content: 'Checking the result',
        active: true,
      }),
    ).toEqual({
      type: 'hook.status',
      statusId: 'hook-1',
      hookEvent: 'Stop',
      content: 'Checking the result',
      active: true,
    });
  });

  it('preserves structured output on turn completion events', () => {
    expect(
      eventSchema.parse({
        type: 'turn.ended',
        agentId: 'main',
        sessionId: 'sess_1',
        turnId: 1,
        reason: 'completed',
        structuredOutput: { answer: 'done' },
      }),
    ).toMatchObject({
      type: 'turn.ended',
      structuredOutput: { answer: 'done' },
    });
  });

  it('rejects unknown event types through the full agent event union', () => {
    expect(
      agentEventSchema.safeParse({
        type: 'unknown.event',
        turnId: 1,
      }).success,
    ).toBe(false);
  });

  it('validates session-scoped daemon events with agentId and sessionId', () => {
    const parsed = eventSchema.parse({
      type: 'turn.started',
      agentId: 'agent_1',
      sessionId: 'sess_1',
      turnId: 1,
      origin: { kind: 'user', checkpointId: 'checkpoint-1' },
    });

    expect(parsed.agentId).toBe('agent_1');
    expect(parsed.sessionId).toBe('sess_1');
    expect(parsed).toMatchObject({
      origin: { kind: 'user', checkpointId: 'checkpoint-1' },
    });
  });

  it('preserves file checkpoint IDs on skill activation events', () => {
    expect(
      eventSchema.parse({
        type: 'skill.activated',
        agentId: 'main',
        sessionId: 'sess_1',
        activationId: 'activation-1',
        skillName: 'review',
        trigger: 'user-slash',
        checkpointId: 'checkpoint-1',
      }),
    ).toMatchObject({
      type: 'skill.activated',
      checkpointId: 'checkpoint-1',
    });
  });

  it('validates prompt.submitted events', () => {
    const parsed = eventSchema.parse({
      type: 'prompt.submitted',
      agentId: 'main',
      sessionId: 'sess_1',
      promptId: 'prompt_1',
      userMessageId: 'msg_1',
      status: 'running',
      content: [{ type: 'text', text: 'hello' }],
      createdAt: '2026-06-11T00:00:00.000Z',
    });

    expect(parsed.type).toBe('prompt.submitted');
    expect((parsed as { promptId: string }).promptId).toBe('prompt_1');
  });

  it('validates event.session.created events', () => {
    const parsed = eventSchema.parse({
      type: 'event.session.created',
      agentId: 'main',
      sessionId: 'sess_1',
      session: {
        id: 'sess_1',
        workspace_id: 'wd_project_123456abcdef',
        title: 'Created session',
        created_at: '2026-06-11T00:00:00.000Z',
        updated_at: '2026-06-11T00:00:00.000Z',
        status: 'idle',
        metadata: { cwd: '/tmp/project' },
        agent_config: { model: 'pythinker-k2' },
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          total_cost_usd: 0,
          context_tokens: 0,
          context_limit: 0,
          turn_count: 0,
        },
        permission_rules: [],
        message_count: 0,
        last_seq: 0,
      },
    });

    expect(parsed.type).toBe('event.session.created');
    expect((parsed as { session: { id: string } }).session.id).toBe('sess_1');
  });

  it('validates workspace lifecycle events', () => {
    const workspace = {
      id: 'wd_project_123456abcdef',
      root: '/tmp/project',
      name: 'project',
      is_git_repo: true,
      branch: 'main',
      created_at: '2026-06-11T00:00:00.000Z',
      last_opened_at: '2026-06-11T00:00:00.000Z',
      session_count: 1,
    };

    const created = eventSchema.parse({
      type: 'event.workspace.created',
      agentId: 'main',
      sessionId: '__global__',
      workspace,
    });
    expect(created.type).toBe('event.workspace.created');

    const updated = eventSchema.parse({
      type: 'event.workspace.updated',
      agentId: 'main',
      sessionId: '__global__',
      workspace: { ...workspace, name: 'renamed' },
    });
    expect(updated.type).toBe('event.workspace.updated');

    const deleted = eventSchema.parse({
      type: 'event.workspace.deleted',
      agentId: 'main',
      sessionId: '__global__',
      workspace_id: workspace.id,
      root: workspace.root,
    });
    expect(deleted.type).toBe('event.workspace.deleted');
    expect((deleted as { root: string }).root).toBe('/tmp/project');
  });

  it('validates event.session.status_changed events', () => {
    const parsed = eventSchema.parse({
      type: 'event.session.status_changed',
      agentId: 'main',
      sessionId: 'sess_1',
      status: 'running',
      previous_status: 'idle',
      current_prompt_id: 'prompt_1',
    });

    expect(parsed.type).toBe('event.session.status_changed');
    expect((parsed as { status: string }).status).toBe('running');
    expect((parsed as { previous_status: string }).previous_status).toBe('idle');
    expect((parsed as { current_prompt_id: string }).current_prompt_id).toBe('prompt_1');
  });

  it('rejects event.session.status_changed with invalid status', () => {
    expect(
      eventSchema.safeParse({
        type: 'event.session.status_changed',
        agentId: 'main',
        sessionId: 'sess_1',
        status: 'unknown',
        previous_status: 'idle',
      }).success,
    ).toBe(false);
  });
});
