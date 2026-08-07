/**
 * Current builtin tool smoke coverage.
 *
 * This complements focused tool tests by ensuring every current builtin
 * has at least one schema assertion and one execution/error-path assertion.
 */

import { Readable, type Writable } from 'node:stream';

import type { Kaos, KaosProcess } from '@pythoughts/kaos';
import type { WorkflowWarningEvent } from '@pythoughts/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import type { DynamicWorkflowMode } from '../../src/agent/dynamic-workflow';
import {
  generateWorkflowRunId,
  isWorkflowRunId,
} from '../../src/agent/dynamic-workflow/run-id';
import { resolveWorkflowSizeGuideline } from '../../src/agent/dynamic-workflow/size-guideline';
import { FLAG_DEFINITIONS, FlagResolver } from '../../src/flags';
import type {
  QueuedSubagentRunResult,
  QueuedSubagentTask,
  SessionSubagentHost,
} from '../../src/session/subagent-host';
import { SessionSkillRegistry } from '../../src/skill';
import { TaskListInputSchema } from '../../src/tools/background/task-list';
import { TaskOutputInputSchema } from '../../src/tools/background/task-output';
import { TaskStopInputSchema } from '../../src/tools/background/task-stop';
import { AgentTool, AgentToolInputSchema } from '../../src/tools/builtin/collaboration/agent';
import {
  AskUserQuestionInputSchema,
  AskUserQuestionTool,
} from '../../src/tools/builtin/collaboration/ask-user';
import { SkillTool, SkillToolInputSchema } from '../../src/tools/builtin/collaboration/skill-tool';
import { EditInputSchema, EditTool } from '../../src/tools/builtin/file/edit';
import { GlobInputSchema, GlobTool } from '../../src/tools/builtin/file/glob';
import { GrepInputSchema, GrepTool } from '../../src/tools/builtin/file/grep';
import { ReadInputSchema, ReadTool } from '../../src/tools/builtin/file/read';
import { WriteInputSchema, WriteTool } from '../../src/tools/builtin/file/write';
import { BashInputSchema, BashTool } from '../../src/tools/builtin/shell/bash';
import type { WorkspaceConfig } from '../../src/tools/support/workspace';
import { createFakeKaos } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';
import { createBackgroundManager } from '../agent/background/helpers';
import {
  DynamicWorkflowTool,
  DynamicWorkflowToolInputSchema,
  isDynamicWorkflowDisabled,
} from '../../src/tools/builtin/collaboration/dynamic-workflow';

const signal = new AbortController().signal;
const workspace: WorkspaceConfig = { workspaceDir: '/workspace', additionalDirs: [] };
const regularFileStat = {
  stMode: 0o100_644,
  stIno: 1,
  stDev: 1,
  stNlink: 1,
  stUid: 1000,
  stGid: 1000,
  stSize: 0,
  stAtime: 0,
  stMtime: 0,
  stCtime: 0,
} satisfies Awaited<ReturnType<Kaos['stat']>>;
const directoryStat = {
  ...regularFileStat,
  stMode: 0o040_755,
} satisfies Awaited<ReturnType<Kaos['stat']>>;

function context<Input>(args: Input, toolCallId = 'call_1') {
  return { turnId: '0', toolCallId, args, signal };
}

function mockSubagentHost<T extends Partial<SessionSubagentHost>>(
  host: T,
): T & SessionSubagentHost {
  return {
    spawn: vi.fn(),
    resume: vi.fn(),
    runQueued: vi.fn(),
    getDynamicWorkflowItem: vi.fn(),
    ...host,
  } as unknown as T & SessionSubagentHost;
}

function mockDynamicWorkflowMode(): DynamicWorkflowMode {
  return { enter: vi.fn() } as unknown as DynamicWorkflowMode;
}

function processWithOutput(stdout: string, exitCode = 0): KaosProcess {
  const stdoutStream = Readable.from([stdout]);
  const stderrStream = Readable.from([]);
  return {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: stdoutStream,
    stderr: stderrStream,
    pid: 123,
    exitCode,
    wait: vi.fn().mockResolvedValue(exitCode),
    kill: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(async () => {
      stdoutStream.destroy();
      stderrStream.destroy();
    }),
  };
}

describe('current builtin file and shell tools', () => {
  it('Read exposes parameters and reads text content', async () => {
    const content = 'alpha\nbeta\n';
    const bytes = Buffer.from(content, 'utf8');
    const tool = new ReadTool(
      createFakeKaos({
        stat: vi.fn<Kaos['stat']>().mockResolvedValue(regularFileStat),
        readBytes: vi.fn<Kaos['readBytes']>().mockImplementation(async (_path, n) => {
          return n === undefined ? bytes : bytes.subarray(0, n);
        }),
        readLines: vi.fn<Kaos['readLines']>().mockImplementation(async function* readLines() {
          yield 'alpha\n';
          yield 'beta\n';
        }),
      }),
      workspace,
    );

    expect(ReadInputSchema.safeParse({ path: '/workspace/a.txt' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ path: '/workspace/a.txt' }));
    expect(result.output).toBe(
      [
        '1\talpha',
        '2\tbeta',
        '<system>2 lines read from file starting from line 1. Total lines in file: 2. End of file reached.</system>',
      ].join('\n'),
    );
  });

  it('Write exposes parameters and writes through kaos', async () => {
    const writeText = vi.fn().mockResolvedValue(5);
    const tool = new WriteTool(
      createFakeKaos({ writeText, stat: vi.fn<Kaos['stat']>().mockResolvedValue(directoryStat) }),
      workspace,
    );

    expect(WriteInputSchema.safeParse({ path: '/workspace/a.txt', content: 'hello' }).success).toBe(
      true,
    );
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { content: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ path: '/workspace/a.txt', content: 'hello' }));
    expect(writeText).toHaveBeenCalledWith('/workspace/a.txt', 'hello');
    expect(result.output).toContain('Wrote 5 bytes');
  });

  it('Edit exposes parameters and errors when old_string is missing', async () => {
    const tool = new EditTool(
      createFakeKaos({ readText: vi.fn().mockResolvedValue('alpha\nbeta\n') }),
      workspace,
    );

    expect(
      EditInputSchema.safeParse({
        path: '/workspace/a.txt',
        old_string: 'gamma',
        new_string: 'delta',
      }).success,
    ).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { old_string: { type: 'string' } },
    });

    const result = await executeTool(tool,
      context({ path: '/workspace/a.txt', old_string: 'gamma', new_string: 'delta' }),
    );
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('old_string not found');
  });

  it('Glob exposes parameters and walks pure-wildcard patterns capped at MAX_MATCHES', async () => {
    // Pure wildcards used to be rejected up-front; now they walk like
    // any other pattern and the 100-match cap is the only safety.
    const glob = vi.fn().mockReturnValue(
      (async function* () {
        yield '/workspace/a.ts';
      })(),
    );
    const tool = new GlobTool(
      createFakeKaos({
        glob,
        stat: vi.fn().mockResolvedValue({ stMtime: 1, stMode: 0o100000 }),
      }),
      workspace,
    );

    expect(GlobInputSchema.safeParse({ pattern: '*.ts' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { pattern: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ pattern: '**' }));
    expect(result.isError).toBeFalsy();
    expect(glob).toHaveBeenCalledWith('/workspace', '**');
    expect(result.output).toContain('a.ts');
  });

  it('Grep exposes parameters and rejects relative workspace escapes before spawning rg', async () => {
    const kaos = createFakeKaos({ exec: vi.fn() });
    const tool = new GrepTool(kaos, workspace);

    expect(GrepInputSchema.safeParse({ pattern: 'needle' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { pattern: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ pattern: 'needle', path: '../outside' }));
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('outside the working directory');
    expect(kaos.exec).not.toHaveBeenCalled();
  });

  it('Bash exposes parameters and returns foreground stdout', async () => {
    const tool = new BashTool(
      createFakeKaos({
        execWithEnv: vi.fn().mockResolvedValue(processWithOutput('ok\n')),
        osEnv: {
          osKind: 'Linux',
          osArch: 'arm64',
          osVersion: 'test',
          shellPath: '/bin/bash',
          shellName: 'bash',
        },
      }),
      '/workspace',
    );

    expect(BashInputSchema.safeParse({ command: 'printf ok' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { command: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ command: 'printf ok', timeout: 1000 }));
    expect(result).toMatchObject({ output: 'ok\n' });
  });
});

describe('current builtin collaboration tools', () => {
  it('AskUserQuestion exposes parameters and asks through rpc in yolo mode', async () => {
    const tool = new AskUserQuestionTool({
      experimentalFlags: new FlagResolver({}, FLAG_DEFINITIONS),
      permission: { mode: 'yolo' },
      rpc: {
        requestQuestion: vi.fn(async () => ({ 'Which path?': 'A' })),
      },
      telemetry: { track: vi.fn() },
    } as unknown as Agent);

    const input = {
      questions: [
        {
          question: 'Which path?',
          header: 'Path',
          options: [
            { label: 'A', description: 'Use A' },
            { label: 'B', description: 'Use B' },
          ],
          multi_select: false,
        },
      ],
    };
    expect(AskUserQuestionInputSchema.safeParse(input).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { questions: { type: 'array' } },
    });

    const result = await executeTool(tool, context(input));
    expect(result.output).toBe(JSON.stringify({ answers: { 'Which path?': 'A' } }));
  });

  it('Agent exposes parameters and returns a foreground subagent summary', async () => {
    const host = mockSubagentHost({
      spawn: vi.fn().mockResolvedValue({
        agentId: 'agent-child',
        profileName: 'coder',
        resumed: false,
        completion: Promise.resolve({ result: 'child result' }),
      }),
    });
    const tool = new AgentTool(host);

    const input = { prompt: 'Investigate', description: 'Find cause' };
    expect(AgentToolInputSchema.safeParse(input).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { prompt: { type: 'string' } },
    });

    const result = await executeTool(tool, context(input, 'call_agent'));
    expect(host.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        profileName: 'coder',
        parentToolCallId: 'call_agent',
        prompt: 'Investigate',
        description: 'Find cause',
        runInBackground: false,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result.output).toContain('child result');
  });

  it('DynamicWorkflow ignores empty items instead of rejecting the whole call', async () => {
    // A model that emits a trailing empty string used to fail argument
    // validation, which rejects the entire call before the tool ever runs and
    // costs a full re-send of every prompt.
    const input = {
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts', ''],
      subagent_type: 'explore',
    };
    expect(DynamicWorkflowToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      DynamicWorkflowToolInputSchema.safeParse({ ...input, items: ['src/a.ts', '   '] }).success,
    ).toBe(true);

    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'explore',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (explore)',
            runInBackground: false,
          },
          agentId: 'agent-explore-1',
          status: 'completed',
          result: 'explore result a',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'explore',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (explore)',
            runInBackground: false,
          },
          agentId: 'agent-explore-2',
          status: 'completed',
          result: 'explore result b',
        },
      ]),
    });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode());

    // The panel must advertise the two subagents that will actually launch,
    // not the three entries that were sent.
    const execution = tool.resolveExecution(input as never);
    if (execution.isError === true) throw new Error('expected runnable execution');
    expect(execution.display).toMatchObject({
      agent_name: 'Dynamic Workflow (2 subagents)',
    });

    const result = await executeTool(tool, context(input, 'call_dynamic_workflow'));

    expect(result.isError).not.toBe(true);
    const queued = host.runQueued.mock.calls[0]?.[0] as Array<{ prompt: string }>;
    expect(queued.map((task) => task.prompt)).toEqual(['Review src/a.ts', 'Review src/b.ts']);
    // A quietly shorter workflow must not read as one the model sized right.
    expect(result.output).toContain('1 empty item was ignored');
    // The note must not precede the envelope: consumers match the result
    // document anchored at the start, so a prefix renders a successful run as
    // an unsupported result.
    const outputText = typeof result.output === 'string' ? result.output : '';
    expect(outputText.trimStart().startsWith('<dynamic_workflow_result')).toBe(true);
  });

  it('DynamicWorkflow says items were dropped when too few survive', async () => {
    const host = mockSubagentHost({ runQueued: vi.fn() });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode());
    const input = {
      description: 'Review files',
      items: ['src/a.ts', '', ''],
      subagent_type: 'explore',
    };

    const result = await executeTool(tool, context(input, 'call_dynamic_workflow'));

    expect(result.isError).toBe(true);
    // Without the second half the caller reads "requires at least 2 items"
    // while looking at a list that had three.
    expect(result.output).toContain('requires at least 2 items');
    expect(result.output).toContain('2 empty items were ignored');
    expect(host.runQueued).not.toHaveBeenCalled();
  });

  it('DynamicWorkflow applies one subagent_type without automatic timeouts', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'explore',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (explore)',
            runInBackground: false,
          },
          agentId: 'agent-explore-1',
          status: 'completed',
          result: 'explore result a',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'explore',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (explore)',
            runInBackground: false,
          },
          agentId: 'agent-explore-2',
          status: 'completed',
          result: 'explore result b',
        },
      ]),
    });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new DynamicWorkflowTool(host, dynamicWorkflowMode);
    const input = {
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts'],
      subagent_type: 'explore',
    };

    expect(DynamicWorkflowToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      DynamicWorkflowToolInputSchema.safeParse({
        ...input,
        items: Array.from({ length: 128 }, (_, index) => `src/${String(index + 1)}.ts`),
      }).success,
    ).toBe(true);
    // Over the cap now passes argument validation and fails inside the tool
    // with a readable message. Rejecting at the schema would discard the whole
    // call -- including the 128 valid prompts -- over one surplus entry.
    expect(
      DynamicWorkflowToolInputSchema.safeParse({
        ...input,
        items: Array.from({ length: 129 }, (_, index) => `src/${String(index + 1)}.ts`),
      }).success,
    ).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        subagent_type: { type: 'string' },
      },
    });
    expect(Object.keys(tool.parameters['properties'] as Record<string, unknown>)).toEqual([
      'description',
      'subagent_type',
      'prompt_template',
      'items',
      'resume_agent_ids',
      'model',
      'effort',
      'output_schema',
    ]);

    const result = await executeTool(tool, context(input, 'call_dynamic_workflow'));

    expect(dynamicWorkflowMode.enter).toHaveBeenCalledWith('tool');
    expect(host.runQueued).toHaveBeenCalledTimes(1);
    const queuedTasks = vi.mocked(host.runQueued).mock.calls[0]![0];
    const runId = queuedTasks[0]!.workflowRunId!;
    expect(isWorkflowRunId(runId)).toBe(true);
    expect(queuedTasks[1]!.workflowRunId).toBe(runId);
    expect(queuedTasks.every((task: QueuedSubagentTask) => task.workflowName === 'Review files')).toBe(true);
    expect(host.runQueued).toHaveBeenCalledWith(
      [
        {
          kind: 'spawn',
          data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
          profileName: 'explore',
          parentToolCallId: 'call_dynamic_workflow',
          prompt: 'Review src/a.ts',
          description: 'Review files #1 (explore)',
          dynamicWorkflowIndex: 1,
          dynamicWorkflowItem: 'src/a.ts',
          runInBackground: false,
          workflowRunId: runId,
          workflowName: 'Review files',
          signal,
        },
        {
          kind: 'spawn',
          data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
          profileName: 'explore',
          parentToolCallId: 'call_dynamic_workflow',
          prompt: 'Review src/b.ts',
          description: 'Review files #2 (explore)',
          dynamicWorkflowIndex: 2,
          dynamicWorkflowItem: 'src/b.ts',
          runInBackground: false,
          workflowRunId: runId,
          workflowName: 'Review files',
          signal,
        },
      ],
    );
    expect(result.output).toBe([
      `<dynamic_workflow_result run_id="${runId}">`,
      '<summary>completed: 2</summary>',
      '<subagent agent_id="agent-explore-1" item="src/a.ts" outcome="completed">explore result a</subagent>',
      '<subagent agent_id="agent-explore-2" item="src/b.ts" outcome="completed">explore result b</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow accepts output_schema and passes it to every queued task', async () => {
    const outputSchema = {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    };
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task) => ({
          task,
          agentId: 'agent-1',
          status: 'completed' as const,
          result: 'done',
        }));
      },
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode());
    const input = {
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts'],
      output_schema: outputSchema,
    };

    expect(DynamicWorkflowToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      DynamicWorkflowToolInputSchema.safeParse({ ...input, output_schema: { type: 'string' } })
        .success,
    ).toBe(true);

    const result = await executeTool(tool, context(input, 'call_dynamic_workflow'));

    expect(result.isError).toBeUndefined();
    expect(runQueued).toHaveBeenCalledTimes(1);
    const queuedTasks = vi.mocked(runQueued).mock.calls[0]![0];
    expect(queuedTasks).toHaveLength(2);
    expect(queuedTasks.every((task) => task.outputSchema === outputSchema)).toBe(true);
  });

  it('DynamicWorkflow renders a schema_error child alongside the other outcomes', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        // One outcome per item, positionally: a schema miss, a clean run, and
        // an ordinary failure — so the render covers all three side by side.
        const outcomes = [
          {
            agentId: 'agent-schema-error',
            status: 'schema_error' as const,
            error:
              '[structured_output.max_retries] Failed to provide valid structured output after the maximum number of retries.',
          },
          {
            agentId: 'agent-clean',
            status: 'completed' as const,
            result: 'clean result',
          },
          {
            agentId: 'agent-timed-out',
            status: 'failed' as const,
            error: 'Agent timed out after 30s.',
          },
        ];
        return tasks.map((task, index) => ({ task, ...outcomes[index]! }));
      },
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode());

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        items: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      }),
    );

    expect(result.output).toContain(
      '<subagent agent_id="agent-schema-error" item="src/a.ts" outcome="schema_error">[structured_output.max_retries] Failed to provide valid structured output after the maximum number of retries.</subagent>',
    );
    expect(result.output).toContain(
      '<subagent agent_id="agent-clean" item="src/b.ts" outcome="completed">clean result</subagent>',
    );
    expect(result.output).toContain(
      '<subagent agent_id="agent-timed-out" item="src/c.ts" outcome="failed">Agent timed out after 30s.</subagent>',
    );
    expect(result.output).toContain('<summary>completed: 1, failed: 1, schema_error: 1</summary>');
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow emits exactly one workflow.warning above the size guideline and still runs', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task) => ({
          task,
          agentId: 'agent-1',
          status: 'completed' as const,
          result: 'done',
        }));
      },
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const emitEvent = vi.fn<(event: WorkflowWarningEvent) => void>();
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode(), 'small', emitEvent);

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        items: Array.from({ length: 6 }, (_, index) => `src/${String(index + 1)}.ts`),
      }),
    );

    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(host.runQueued).toHaveBeenCalledTimes(1);
    const warning = emitEvent.mock.calls[0]![0];
    expect(isWorkflowRunId(warning.workflowRunId)).toBe(true);
    expect(warning).toMatchObject({
      type: 'workflow.warning',
      parentToolCallId: 'call_1',
      agentCount: 6,
      threshold: 5,
    });
    expect(warning.message).toContain('6');
    expect(warning.message).toContain('5');
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow emits exactly one workflow.warning above the unrestricted fallback threshold', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task) => ({
          task,
          agentId: 'agent-1',
          status: 'completed' as const,
          result: 'done',
        }));
      },
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const emitEvent = vi.fn<(event: WorkflowWarningEvent) => void>();
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode(), 'unrestricted', emitEvent);

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        items: Array.from({ length: 26 }, (_, index) => `src/${String(index + 1)}.ts`),
      }),
    );

    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(host.runQueued).toHaveBeenCalledTimes(1);
    const warning = emitEvent.mock.calls[0]![0];
    expect(isWorkflowRunId(warning.workflowRunId)).toBe(true);
    expect(warning).toMatchObject({
      type: 'workflow.warning',
      parentToolCallId: 'call_1',
      agentCount: 26,
      threshold: 25,
    });
    expect(warning.message).toContain('26');
    expect(warning.message).toContain('25');
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow emits no warning at or below the size guideline', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task) => ({
          task,
          agentId: 'agent-1',
          status: 'completed' as const,
          result: 'done',
        }));
      },
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const emitEvent = vi.fn<(event: WorkflowWarningEvent) => void>();
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode(), 'small', emitEvent);

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        items: Array.from({ length: 5 }, (_, index) => `src/${String(index + 1)}.ts`),
      }),
    );

    expect(emitEvent).not.toHaveBeenCalled();
    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow above the size guideline without an emitter does not throw', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task) => ({
          task,
          agentId: 'agent-1',
          status: 'completed' as const,
          result: 'done',
        }));
      },
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode(), 'small');

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        items: Array.from({ length: 6 }, (_, index) => `src/${String(index + 1)}.ts`),
      }),
    );

    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow escapes XML-sensitive agent, item, and result text', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task, index) => ({
          task,
          agentId: index === 0 ? 'agent-&"<1>' : `agent-${String(index + 1)}`,
          status: 'completed' as const,
          result: index === 0
            ? 'before </subagent> & after'
            : 'quoted "result" <done>',
        }));
      },
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode());

    const result = await executeTool(
      tool,
      context({
        description: 'Review XML-sensitive values',
        items: ['src/a&b.ts', 'src/c<d.ts'],
      }),
    );

    expect(result.output).toContain(
      'agent_id="agent-&amp;&quot;&lt;1&gt;" item="src/a&amp;b.ts" outcome="completed">before &lt;/subagent&gt; &amp; after</subagent>',
    );
    expect(result.output).toContain(
      'item="src/c&lt;d.ts" outcome="completed">quoted &quot;result&quot; &lt;done&gt;</subagent>',
    );
  });

  it('DynamicWorkflow treats items as complete prompts when prompt_template is omitted', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task, index) => ({
          task,
          agentId: `agent-${String(index + 1)}`,
          status: 'completed' as const,
          result: `result ${String(index + 1)}`,
        }));
      },
    );
    const host = mockSubagentHost({
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode());

    const result = await executeTool(
      tool,
      context({
        description: 'Review areas',
        items: ['Review core credentials', 'Review TUI credentials'],
      }),
    );

    expect(runQueued).toHaveBeenCalledWith([
      expect.objectContaining({ prompt: 'Review core credentials' }),
      expect.objectContaining({ prompt: 'Review TUI credentials' }),
    ]);
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow does not expose permission rule argument matching', () => {
    const tool = new DynamicWorkflowTool(mockSubagentHost({}), mockDynamicWorkflowMode());
    const execution = tool.resolveExecution({
      description: 'Review files',
      prompt_template: 'Review {{item}}',
      items: ['src/a.ts', 'src/b.ts'],
    });
    if (execution.isError === true) throw new Error('DynamicWorkflow resolveExecution returned an error');

    expect(execution.approvalRule).toBe('DynamicWorkflow');
    expect(execution.matchesRule).toBeUndefined();
  });

  it('DynamicWorkflow accepts a full item list carrying a blank entry', async () => {
    // 128 real prompts plus one blank used to trip the schema's raw-length cap,
    // which rejected the entire call -- the very hole the blank-item handling
    // exists to close, reopened at the boundary.
    const items = [...Array.from({ length: 128 }, (_, index) => `src/${String(index + 1)}.ts`), ''];
    const input = { description: 'Review files', prompt_template: 'Review {{item}}', items };

    expect(DynamicWorkflowToolInputSchema.safeParse(input).success).toBe(true);

    const host = mockSubagentHost({ runQueued: vi.fn().mockResolvedValue([]) });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode());
    const result = await executeTool(tool, context(input, 'call_dynamic_workflow'));

    expect(result.isError).not.toBe(true);
    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect((host.runQueued.mock.calls[0]?.[0] as unknown[]).length).toBe(128);
  });

  it('DynamicWorkflow rejects more than 128 subagents at execution time', async () => {
    const host = mockSubagentHost({ runQueued: vi.fn() });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new DynamicWorkflowTool(host, dynamicWorkflowMode);

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: Array.from({ length: 129 }, (_, index) => `src/${String(index + 1)}.ts`),
      }),
    );

    expect(result.output).toBe('DynamicWorkflow supports at most 128 subagents.');
    expect(result.isError).toBe(true);
    expect(host.runQueued).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'a single item without resumed agents',
      input: {
        description: 'Review one file',
        prompt_template: 'Review {{item}}',
        items: ['src/only.ts'],
      },
      output: 'DynamicWorkflow requires at least 2 items unless resume_agent_ids is provided.',
    },
    {
      name: 'a prompt template without the item placeholder',
      input: {
        description: 'Review files',
        prompt_template: 'Review files',
        items: ['src/a.ts', 'src/b.ts'],
      },
      output: 'prompt_template must include the {{item}} placeholder.',
    },
  ])('DynamicWorkflow rejects $name at execution time', async ({ input, output }) => {
    const host = mockSubagentHost({ runQueued: vi.fn() });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new DynamicWorkflowTool(host, dynamicWorkflowMode);

    const result = await executeTool(tool, context(input));

    expect(result.output).toBe(output);
    expect(result.isError).toBe(true);
    expect(host.runQueued).not.toHaveBeenCalled();
  });

  it('DynamicWorkflow resumes mapped agents before spawning item subagents', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task, index) => ({
          task,
          agentId: task.kind === 'resume' ? task.resumeAgentId : `agent-new-${String(index + 1)}`,
          status: 'completed' as const,
          result: `result ${String(index + 1)}`,
        }));
      },
    );
    const persistedItems: Record<string, string> = {
      'agent-old-1': 'src/old-a.ts',
      'agent-old-2': 'src/old-b.ts',
    };
    const host = mockSubagentHost({
      getDynamicWorkflowItem: vi.fn((agentId: string) => persistedItems[agentId]),
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new DynamicWorkflowTool(host, dynamicWorkflowMode);
    const input = {
      description: 'Finish review',
      subagent_type: 'explore',
      prompt_template: 'Review {{item}}',
      items: ['src/new.ts'],
      resume_agent_ids: {
        'agent-old-1': 'Continue previous review A',
        'agent-old-2': 'Continue previous review B',
      },
    };

    expect(DynamicWorkflowToolInputSchema.safeParse(input).success).toBe(true);
    expect(
      DynamicWorkflowToolInputSchema.safeParse({
        description: 'Resume two agents',
        resume_agent_ids: {
          'agent-old-1': 'Continue previous review A',
          'agent-old-2': 'Continue previous review B',
        },
      }).success,
    ).toBe(true);
    expect(
      DynamicWorkflowToolInputSchema.safeParse({
        description: 'Resume one agent',
        resume_agent_ids: {
          'agent-old-1': 'Continue previous review A',
        },
      }).success,
    ).toBe(true);

    const result = await executeTool(tool, context(input, 'call_dynamic_workflow'));
    const runId = vi.mocked(host.runQueued).mock.calls[0]![0]![0]!.workflowRunId!;
    expect(isWorkflowRunId(runId)).toBe(true);

    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect(host.runQueued).toHaveBeenCalledWith(
      [
        {
          kind: 'resume',
          data: {
            kind: 'resume',
            index: 1,
            agentId: 'agent-old-1',
            item: 'src/old-a.ts',
            prompt: 'Continue previous review A',
          },
          profileName: 'subagent',
          parentToolCallId: 'call_dynamic_workflow',
          prompt: 'Continue previous review A',
          description: 'Finish review #1 (resume)',
          dynamicWorkflowIndex: 1,
          dynamicWorkflowItem: 'src/old-a.ts',
          runInBackground: false,
          workflowRunId: runId,
          workflowName: 'Finish review',
          resumeAgentId: 'agent-old-1',
          signal,
        },
        {
          kind: 'resume',
          data: {
            kind: 'resume',
            index: 2,
            agentId: 'agent-old-2',
            item: 'src/old-b.ts',
            prompt: 'Continue previous review B',
          },
          profileName: 'subagent',
          parentToolCallId: 'call_dynamic_workflow',
          prompt: 'Continue previous review B',
          description: 'Finish review #2 (resume)',
          dynamicWorkflowIndex: 2,
          dynamicWorkflowItem: 'src/old-b.ts',
          runInBackground: false,
          workflowRunId: runId,
          workflowName: 'Finish review',
          resumeAgentId: 'agent-old-2',
          signal,
        },
        {
          kind: 'spawn',
          data: {
            kind: 'spawn',
            index: 3,
            item: 'src/new.ts',
            prompt: 'Review src/new.ts',
          },
          profileName: 'explore',
          parentToolCallId: 'call_dynamic_workflow',
          prompt: 'Review src/new.ts',
          description: 'Finish review #3 (explore)',
          dynamicWorkflowIndex: 3,
          dynamicWorkflowItem: 'src/new.ts',
          runInBackground: false,
          workflowRunId: runId,
          workflowName: 'Finish review',
          signal,
        },
      ],
    );
    expect(result.output).toBe([
      `<dynamic_workflow_result run_id="${runId}">`,
      '<summary>completed: 3</summary>',
      '<subagent mode="resume" agent_id="agent-old-1" item="src/old-a.ts" outcome="completed">result 1</subagent>',
      '<subagent mode="resume" agent_id="agent-old-2" item="src/old-b.ts" outcome="completed">result 2</subagent>',
      '<subagent agent_id="agent-new-3" item="src/new.ts" outcome="completed">result 3</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow allows a single resumed subagent without item subagents', async () => {
    const runQueued = vi.fn(
      async <T>(
        tasks: readonly QueuedSubagentTask<T>[],
      ): Promise<Array<QueuedSubagentRunResult<T>>> => {
        return tasks.map((task) => ({
          task,
          agentId: task.kind === 'resume' ? task.resumeAgentId : 'agent-new',
          status: 'completed' as const,
          result: 'resumed result',
        }));
      },
    );
    const host = mockSubagentHost({
      getDynamicWorkflowItem: vi.fn((agentId: string) =>
        agentId === 'agent-old-1' ? 'src/old-a.ts' : undefined,
      ),
      runQueued: runQueued as unknown as SessionSubagentHost['runQueued'],
    });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new DynamicWorkflowTool(host, dynamicWorkflowMode);
    const input = {
      description: 'Resume review',
      resume_agent_ids: {
        'agent-old-1': 'Continue previous review A',
      },
    };

    expect(DynamicWorkflowToolInputSchema.safeParse(input).success).toBe(true);

    const result = await executeTool(tool, context(input, 'call_dynamic_workflow'));
    const runId = vi.mocked(host.runQueued).mock.calls[0]![0]![0]!.workflowRunId!;
    expect(isWorkflowRunId(runId)).toBe(true);

    expect(host.runQueued).toHaveBeenCalledTimes(1);
    expect(host.runQueued).toHaveBeenCalledWith([
      {
        kind: 'resume',
        data: {
          kind: 'resume',
          index: 1,
          agentId: 'agent-old-1',
          item: 'src/old-a.ts',
          prompt: 'Continue previous review A',
        },
        profileName: 'subagent',
        parentToolCallId: 'call_dynamic_workflow',
        prompt: 'Continue previous review A',
        description: 'Resume review #1 (resume)',
        dynamicWorkflowIndex: 1,
        dynamicWorkflowItem: 'src/old-a.ts',
        runInBackground: false,
        workflowRunId: runId,
        workflowName: 'Resume review',
        resumeAgentId: 'agent-old-1',
        signal,
      },
    ]);
    expect(result.output).toBe([
      `<dynamic_workflow_result run_id="${runId}">`,
      '<summary>completed: 1</summary>',
      '<subagent mode="resume" agent_id="agent-old-1" item="src/old-a.ts" outcome="completed">resumed result</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow reports failed subagents inside the XML result without failing the tool', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-1',
          status: 'completed',
          result: 'imports are stable',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-2',
          status: 'failed',
          error: 'Agent timed out after 30s.',
        },
      ]),
    });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new DynamicWorkflowTool(host, dynamicWorkflowMode);

    const result = await executeTool(
      tool,
      context(
        {
          description: 'Review files',
          prompt_template: 'Review {{item}}',
          items: ['src/a.ts', 'src/b.ts'],
        },
        'call_dynamic_workflow',
      ),
    );

    const runId = vi.mocked(host.runQueued).mock.calls[0]![0]![0]!.workflowRunId!;
    expect(isWorkflowRunId(runId)).toBe(true);
    expect(result.output).toBe([
      `<dynamic_workflow_result run_id="${runId}">`,
      '<summary>completed: 1, failed: 1</summary>',
      '<resume_hint>Call DynamicWorkflow with resume_agent_ids using the agent_id values in this result to continue unfinished work.</resume_hint>',
      '<subagent agent_id="agent-coder-1" item="src/a.ts" outcome="completed">imports are stable</subagent>',
      '<subagent agent_id="agent-coder-2" item="src/b.ts" outcome="failed">Agent timed out after 30s.</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));
    expect(dynamicWorkflowMode.enter).toHaveBeenCalledWith('tool');
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow omits resume hint when incomplete subagents have no agent ids', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (coder)',
            runInBackground: false,
          },
          status: 'failed',
          error: 'Agent did not start.',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (coder)',
            runInBackground: false,
          },
          status: 'failed',
          error: 'Agent also did not start.',
        },
      ]),
    });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new DynamicWorkflowTool(host, dynamicWorkflowMode);

    const result = await executeTool(
      tool,
      context(
        {
          description: 'Review files',
          prompt_template: 'Review {{item}}',
          items: ['src/a.ts', 'src/b.ts'],
        },
        'call_dynamic_workflow',
      ),
    );

    const runId = vi.mocked(host.runQueued).mock.calls[0]![0]![0]!.workflowRunId!;
    expect(isWorkflowRunId(runId)).toBe(true);
    expect(result.output).toBe([
      `<dynamic_workflow_result run_id="${runId}">`,
      '<summary>failed: 2</summary>',
      '<subagent item="src/a.ts" outcome="failed">Agent did not start.</subagent>',
      '<subagent item="src/b.ts" outcome="failed">Agent also did not start.</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));
    expect(result.isError).toBeUndefined();
  });

  it('DynamicWorkflow does not combine completed and unfinished agents for resume hint', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-1',
          status: 'completed',
          result: 'imports are stable',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (coder)',
            runInBackground: false,
          },
          status: 'failed',
          error: 'Agent did not start.',
        },
      ]),
    });
    const tool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode());

    const result = await executeTool(
      tool,
      context({
        description: 'Review files',
        prompt_template: 'Review {{item}}',
        items: ['src/a.ts', 'src/b.ts'],
      }),
    );

    const runId = vi.mocked(host.runQueued).mock.calls[0]![0]![0]!.workflowRunId!;
    expect(isWorkflowRunId(runId)).toBe(true);
    expect(result.output).toBe([
      `<dynamic_workflow_result run_id="${runId}">`,
      '<summary>completed: 1, failed: 1</summary>',
      '<subagent agent_id="agent-coder-1" item="src/a.ts" outcome="completed">imports are stable</subagent>',
      '<subagent item="src/b.ts" outcome="failed">Agent did not start.</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));
  });

  it('DynamicWorkflow reports partial aborted subagents inside the XML result', async () => {
    const host = mockSubagentHost({
      runQueued: vi.fn().mockResolvedValue([
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 1, item: 'src/a.ts', prompt: 'Review src/a.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/a.ts',
            description: 'Review files #1 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-1',
          status: 'completed',
          result: 'imports are stable',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 2, item: 'src/b.ts', prompt: 'Review src/b.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/b.ts',
            description: 'Review files #2 (coder)',
            runInBackground: false,
          },
          agentId: 'agent-coder-2',
          status: 'aborted',
          state: 'started',
          error: 'The user manually interrupted this subagent batch before this subagent finished.',
        },
        {
          task: {
            kind: 'spawn',
            data: { kind: 'spawn', index: 3, item: 'src/c.ts', prompt: 'Review src/c.ts' },
            profileName: 'coder',
            parentToolCallId: 'call_dynamic_workflow',
            prompt: 'Review src/c.ts',
            description: 'Review files #3 (coder)',
            runInBackground: false,
          },
          status: 'aborted',
          state: 'not_started',
          error: 'The user manually interrupted this subagent batch before this subagent was started.',
        },
      ]),
    });
    const dynamicWorkflowMode = mockDynamicWorkflowMode();
    const tool = new DynamicWorkflowTool(host, dynamicWorkflowMode);

    const result = await executeTool(
      tool,
      context(
        {
          description: 'Review files',
          prompt_template: 'Review {{item}}',
          items: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        },
        'call_dynamic_workflow',
      ),
    );

    const runId = vi.mocked(host.runQueued).mock.calls[0]![0]![0]!.workflowRunId!;
    expect(isWorkflowRunId(runId)).toBe(true);
    expect(result.output).toBe([
      `<dynamic_workflow_result run_id="${runId}">`,
      '<summary>completed: 1, aborted: 2</summary>',
      '<resume_hint>Call DynamicWorkflow with resume_agent_ids using the agent_id values in this result to continue unfinished work.</resume_hint>',
      '<subagent agent_id="agent-coder-1" item="src/a.ts" outcome="completed">imports are stable</subagent>',
      '<subagent agent_id="agent-coder-2" item="src/b.ts" state="started" outcome="aborted">The user manually interrupted this subagent batch before this subagent finished.</subagent>',
      '<subagent item="src/c.ts" state="not_started" outcome="aborted">The user manually interrupted this subagent batch before this subagent was started.</subagent>',
      '</dynamic_workflow_result>',
    ].join('\n'));
    expect(result.isError).toBeUndefined();
  });

  it('Skill exposes parameters and reports unknown skills as tool errors', async () => {
    const tool = new SkillTool({
      skills: {
        registry: new SessionSkillRegistry(),
        recordActivation: vi.fn(),
      },
      context: {
        appendSystemReminder: vi.fn(),
      },
    } as unknown as Agent);

    expect(SkillToolInputSchema.safeParse({ skill: 'missing' }).success).toBe(true);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { skill: { type: 'string' } },
    });

    const result = await executeTool(tool, context({ skill: 'missing' }));
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('not found');
  });
});

describe('isDynamicWorkflowDisabled', () => {
  it('resolves the switch from config and env with env winning', () => {
    expect(isDynamicWorkflowDisabled(undefined, {})).toBe(false);
    expect(isDynamicWorkflowDisabled({ disableWorkflows: true }, {})).toBe(true);
    expect(isDynamicWorkflowDisabled(undefined, { PYTHINKER_CODE_DISABLE_WORKFLOWS: '1' })).toBe(true);
    expect(
      isDynamicWorkflowDisabled({ disableWorkflows: true }, { PYTHINKER_CODE_DISABLE_WORKFLOWS: 'false' }),
    ).toBe(false);
    expect(
      isDynamicWorkflowDisabled({ disableWorkflows: true }, { PYTHINKER_CODE_DISABLE_WORKFLOWS: 'maybe' }),
    ).toBe(true);
  });
});

describe('workflowSizeGuideline', () => {
  it('resolves the guideline from config and env with env winning', () => {
    expect(resolveWorkflowSizeGuideline(undefined, {})).toBe('medium');
    expect(resolveWorkflowSizeGuideline({ workflowSizeGuideline: 'small' }, {})).toBe('small');
    expect(
      resolveWorkflowSizeGuideline(undefined, { PYTHINKER_CODE_WORKFLOW_SIZE_GUIDELINE: 'large' }),
    ).toBe('large');
    expect(
      resolveWorkflowSizeGuideline(
        { workflowSizeGuideline: 'small' },
        { PYTHINKER_CODE_WORKFLOW_SIZE_GUIDELINE: 'LARGE' },
      ),
    ).toBe('large');
    expect(
      resolveWorkflowSizeGuideline(
        { workflowSizeGuideline: 'small' },
        { PYTHINKER_CODE_WORKFLOW_SIZE_GUIDELINE: 'huge' },
      ),
    ).toBe('small');
  });

  it('appends the advisory note to DynamicWorkflowTool descriptions unless unrestricted', () => {
    const host = mockSubagentHost({});

    const smallTool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode(), 'small');
    expect(smallTool.description).toContain('about 5 subagents');

    const unrestrictedTool = new DynamicWorkflowTool(host, mockDynamicWorkflowMode(), 'unrestricted');
    expect(unrestrictedTool.description).toContain('DynamicWorkflow supports up to 128 subagents');
    expect(unrestrictedTool.description).not.toContain('Workflow size guideline:');
  });
});

describe('workflow run ids', () => {
  it('generates ids that satisfy the validator', () => {
    expect(isWorkflowRunId(generateWorkflowRunId())).toBe(true);
  });

  it('generates distinct ids on consecutive calls', () => {
    expect(generateWorkflowRunId()).not.toBe(generateWorkflowRunId());
  });

  it.each([
    { name: 'an empty string', value: '' },
    { name: 'a path traversal', value: 'wfr-../etc/passwd' },
    { name: 'a value containing a slash', value: 'wfr-a/b-c' },
    { name: 'uppercase letters', value: 'WFR-ABC-DEF' },
    { name: 'a trailing space', value: 'wfr-abc-def ' },
    { name: 'a plain string without the wfr- prefix', value: 'plain-string' },
    { name: 'an overlong string', value: 'x'.repeat(500) },
    // Structurally valid, so this reaches the component-length cap instead of
    // failing earlier on a missing prefix.
    { name: 'an overlong first component', value: `wfr-${'a'.repeat(33)}-def` },
    { name: 'an overlong second component', value: `wfr-abc-${'a'.repeat(17)}` },
    // A run id becomes a filename segment, so anything that could terminate or
    // split a path has to be rejected outright rather than merely unexpected.
    { name: 'a trailing newline', value: `wfr-abc-def${String.fromCodePoint(10)}` },
    { name: 'an embedded NUL', value: `wfr-abc-def${String.fromCodePoint(0)}` },
    { name: 'a NUL followed by traversal', value: `wfr-abc-def${String.fromCodePoint(0)}/../x` },
  ])('rejects $name', ({ value }) => {
    expect(isWorkflowRunId(value)).toBe(false);
  });
});

describe('current builtin background tool schemas', () => {
  it('background task schemas and manager-backed tools are covered', () => {
    const manager = createBackgroundManager().manager;

    expect(TaskListInputSchema.safeParse({ active_only: true }).success).toBe(true);
    expect(TaskOutputInputSchema.safeParse({ task_id: 'bash-1' }).success).toBe(true);
    expect(TaskStopInputSchema.safeParse({ task_id: 'bash-1' }).success).toBe(true);
    expect(TaskStopInputSchema.safeParse({ shell_id: 'bash-1' }).success).toBe(true);
    expect(TaskStopInputSchema.safeParse({}).success).toBe(false);
    expect(manager.list()).toEqual([]);
  });
});
