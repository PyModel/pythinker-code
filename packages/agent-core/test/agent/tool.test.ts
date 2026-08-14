import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Tool, ToolCall } from '@pymodel/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { AgentOptions } from '../../src/agent';
import type { McpConnectionManager } from '../../src/mcp';
import type { MCPClient } from '../../src/mcp/types';
import { HookEngine } from '../../src/session/hooks';
import { ErrorCodes } from '../../src/errors';
import type { SessionSubagentHost } from '../../src/session/subagent-host';
import { FLAG_DEFINITIONS, FlagResolver } from '../../src/flags';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';
import { createCommandKaos, testAgent } from './harness/agent';
import { executeTool } from '../tools/fixtures/execute-tool';
import { SessionSkillRegistry } from '../../src/skill';

const signal = new AbortController().signal;

describe('Agent tools', () => {
  it('keeps structured writes available without a checkpoint store', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.standalone-write-'));
    try {
      const path = join(dir, 'created.txt');
      const ctx = testAgent();
      ctx.configure({ tools: ['Write'] });
      const write = ctx.agent.tools.loopTools.find((tool) => tool.name === 'Write');

      await expect(
        executeTool(write!, {
          turnId: '0',
          toolCallId: 'call_write',
          args: { path, content: 'created' },
          signal,
        }),
      ).resolves.toMatchObject({
        output: expect.stringContaining('Wrote 7 bytes'),
      });
      expect(await readFile(path, 'utf8')).toBe('created');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not block writes when an old checkpoint can no longer capture', async () => {
    const capture = vi.fn().mockRejectedValue(new Error('Checkpoint was evicted'));
    const ctx = testAgent({
      fileCheckpoints: { capture } as unknown as NonNullable<AgentOptions['fileCheckpoints']>,
    });
    ctx.agent.setFileCheckpointId('checkpoint-old');

    await expect(ctx.agent.captureFileBeforeWrite('/workspace/file.ts')).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledWith('checkpoint-old', '/workspace/file.ts');
  });

  it('discovers nested project skills after a matching Read', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.nested-skill-'));
    try {
      const filePath = join(dir, 'package', 'src', 'main.ts');
      const skillDir = join(dir, 'package', '.pythinker-code', 'skills', 'nested');
      await mkdir(join(dir, 'package', 'src'), { recursive: true });
      await mkdir(skillDir, { recursive: true });
      await writeFile(filePath, 'export const ready = true;\n', 'utf8');
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: nested\ndescription: Nested guidance\n---\nUse nested guidance.\n',
        'utf8',
      );
      const registry = new SessionSkillRegistry();
      registry.register({
        name: 'always-on',
        description: 'Always available',
        path: join(dir, 'always-on', 'SKILL.md'),
        dir: join(dir, 'always-on'),
        content: 'Always available.',
        metadata: { type: 'prompt' },
        source: 'project',
      });
      const ctx = testAgent({ skills: registry });
      ctx.configure({ tools: ['Read', 'Skill'] });
      await ctx.rpc.setPermission({ mode: 'yolo' });

      ctx.mockNextResponse(
        { type: 'text', text: 'I will inspect the nested file.' },
        {
          type: 'function',
          id: 'call_read_nested',
          name: 'Read',
          arguments: JSON.stringify({ path: filePath }),
        },
      );
      ctx.mockNextResponse({ type: 'text', text: 'The nested skill is now available.' });
      await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Inspect it' }] });
      await ctx.untilTurnEnd();

      expect(registry.getSkill('nested')?.description).toBe('Nested guidance');
      expect(JSON.stringify(ctx.llmCalls[1]?.history)).toContain('nested');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('activates path-conditional skills after a matching Read', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.conditional-skill-'));
    try {
      const filePath = join(dir, 'main.ts');
      await writeFile(filePath, 'export const ready = true;\n', 'utf8');
      const registry = new SessionSkillRegistry();
      registry.register({
        name: 'always-on',
        description: 'Always available',
        path: join(dir, 'always-on', 'SKILL.md'),
        dir: join(dir, 'always-on'),
        content: 'Always available.',
        metadata: { type: 'prompt' },
        source: 'project',
      });
      registry.register({
        name: 'typescript-only',
        description: 'TypeScript guidance',
        path: join(dir, 'skill', 'SKILL.md'),
        dir: join(dir, 'skill'),
        content: 'Use TypeScript guidance.',
        metadata: { type: 'prompt', paths: `${dir.slice(process.cwd().length + 1)}/**` },
        source: 'project',
      });
      const ctx = testAgent({ skills: registry });
      ctx.configure({ tools: ['Read', 'Skill'] });
      await ctx.rpc.setPermission({ mode: 'yolo' });

      ctx.mockNextResponse(
        { type: 'text', text: 'I will inspect the file.' },
        {
          type: 'function',
          id: 'call_read',
          name: 'Read',
          arguments: JSON.stringify({ path: filePath }),
        },
      );
      ctx.mockNextResponse({ type: 'text', text: 'The conditional skill is now available.' });
      await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Inspect it' }] });
      await ctx.untilTurnEnd();

      expect(registry.getSkill('typescript-only')?.name).toBe('typescript-only');
      expect(ctx.llmCalls[1]?.tools.map((tool) => tool.name)).toContain('Skill');
      expect(JSON.stringify(ctx.llmCalls[1]?.history)).toContain('typescript-only');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('blocks tools through PreToolUse before permission and emits PostToolUseFailure', async () => {
    const execWithEnv = vi.fn().mockRejectedValue(new Error('Bash should not execute'));
    const triggered: Array<[string, string, number]> = [];
    const hookEngine = new HookEngine(
      [
        {
          event: 'PreToolUse',
          matcher: 'Bash',
          command: "echo 'blocked by PreToolUse' >&2; exit 2",
        },
        {
          event: 'PostToolUseFailure',
          matcher: 'Bash',
          command: 'exit 0',
        },
      ],
      {
        onTriggered: (event, target, count) => {
          triggered.push([event, target, count]);
        },
      },
    );
    const ctx = testAgent({
      kaos: createFakeKaos({ execWithEnv }),
      hookEngine,
    });
    ctx.configure({ tools: ['Bash'] });

    ctx.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    ctx.mockNextResponse({ type: 'text', text: 'The hook blocked Bash.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Try Bash' }] });

    await ctx.untilTurnEnd();

    expect(execWithEnv).not.toHaveBeenCalled();
    expect(triggered).toEqual([
      ['PreToolUse', 'Bash', 1],
      ['PostToolUseFailure', 'Bash', 1],
    ]);
    expect(JSON.stringify(ctx.agent.context.data().history)).toContain('blocked by PreToolUse');
  });

  it('emits PostToolUse after successful tools', async () => {
    const triggered: Array<[string, string, number]> = [];
    const hookEngine = new HookEngine(
      [
        {
          event: 'PostToolUse',
          matcher: 'Bash',
          command: 'exit 0',
        },
      ],
      {
        onTriggered: (event, target, count) => {
          triggered.push([event, target, count]);
        },
      },
    );
    const ctx = testAgent({
      kaos: createCommandKaos('ok'),
      hookEngine,
    });
    ctx.configure({ tools: ['Bash'] });
    await ctx.rpc.setPermission({ mode: 'auto' });

    ctx.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    ctx.mockNextResponse({ type: 'text', text: 'Bash returned ok.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Run Bash' }] });

    await ctx.untilTurnEnd();

    expect(triggered).toEqual([['PostToolUse', 'Bash', 1]]);
  });

  it('uses builtin descriptions on tool call start events', async () => {
    const ctx = testAgent({
      kaos: createCommandKaos('ok'),
    });
    ctx.configure({ tools: ['Bash'] });
    await ctx.rpc.setPermission({ mode: 'yolo' });

    ctx.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    ctx.mockNextResponse({ type: 'text', text: 'Bash returned ok.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Run Bash' }] });
    await ctx.untilTurnEnd();

    const started = ctx.allEvents.find(
      (event) => event.type === '[rpc]' && event.event === 'tool.call.started',
    );
    expect(started?.args).toMatchObject({
      description: 'Running: printf hook-output',
    });
  });

  it('continues after a foreground Agent tool returns a max_tokens failure', async () => {
    const completion = Promise.reject(
      new Error('Subagent turn failed before completing its final summary: reason=max_tokens.'),
    );
    void completion.catch(() => undefined);
    const subagentHost = {
      getProfiles: () => ({}),
      spawn: vi.fn().mockResolvedValue({
        agentId: 'agent-child',
        profileName: 'coder',
        resumed: false,
        completion,
      }),
      resume: vi.fn(),
    } as unknown as SessionSubagentHost;
    const ctx = testAgent({ subagentHost });
    ctx.configure({ tools: ['Agent'] });

    ctx.mockNextResponse({ type: 'text', text: 'I will ask a subagent.' }, agentCall());
    ctx.mockNextResponse({
      type: 'text',
      text: 'The subagent failed with reason=max_tokens, so I will continue in the parent turn.',
    });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Delegate and recover' }] });
    await ctx.untilTurnEnd();

    expect(subagentHost.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        profileName: 'coder',
        parentToolCallId: 'call_agent',
        prompt: 'Investigate deeply',
        description: 'Investigate deeply',
        runInBackground: false,
      }),
    );
    expect(ctx.llmCalls).toHaveLength(2);
    expect(ctx.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'tool.result',
        args: expect.objectContaining({
          toolCallId: 'call_agent',
          isError: true,
          output: expect.stringContaining('reason=max_tokens'),
        }),
      }),
    );
    expect(JSON.stringify(ctx.llmCalls[1]?.history)).toContain('reason=max_tokens');
  });

  it('passes text from content-part error outputs to PostToolUseFailure hooks', async () => {
    const lookupCall: ToolCall = {
      type: 'function',
      id: 'call_lookup',
      name: 'Lookup',
      arguments: '{"query":"moon"}',
    };
    const resolved: Array<[string, string, string]> = [];
    const hookEngine = new HookEngine(
      [
        {
          event: 'PostToolUseFailure',
          matcher: 'Lookup',
          command: hookErrorMessageAssertCommand('rich failure text'),
        },
      ],
      {
        onResolved: (event, target, action) => {
          resolved.push([event, target, action]);
        },
      },
    );
    const ctx = testAgent({ hookEngine });
    ctx.configure();
    await ctx.rpc.setPermission({ mode: 'auto' });
    await ctx.rpc.registerTool({
      name: 'Lookup',
      description: 'Look up a short test value.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    });

    ctx.mockNextResponse({ type: 'text', text: 'I will look it up.' }, lookupCall);
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Look up moon' }] });
    await ctx.untilToolCall({
      isError: true,
      output: [{ type: 'text', text: 'rich failure text' }],
    });

    ctx.mockNextResponse({ type: 'text', text: 'The lookup failed.' });
    await ctx.untilTurnEnd();

    await vi.waitFor(() => {
      expect(resolved).toEqual([['PostToolUseFailure', 'Lookup', 'allow']]);
    });
  });

  it('uses the active builtin tool set as the LLM visible tools', async () => {
    const ctx = testAgent();
    ctx.configure({ tools: ['Write', 'Bash'] });

    ctx.mockNextResponse({ type: 'text', text: 'ready' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Which tools are active?' }] });

    await ctx.untilTurnEnd();
    expect(ctx.lastLlmInput()).toMatchInlineSnapshot(`
      system: <system-prompt>
      tools: Bash, Write
      messages:
        user: text "Which tools are active?"
    `);
    await ctx.expectResumeMatches();
  });

  it('disables Bash background mode unless task management tools are active', async () => {
    const ctx = testAgent();
    ctx.configure({ tools: ['Bash'] });

    const bashOnly = ctx.agent.tools.loopTools.find((tool) => tool.name === 'Bash');
    expect(bashOnly).toBeDefined();
    expect(bashOnly!.description).toContain('Background execution is disabled for this agent.');
    expect(bashOnly!.description).not.toContain('the command will be started as a background task');
    await expect(
      executeTool(bashOnly!, {
        turnId: '0',
        toolCallId: 'call_bash',
        args: { command: 'sleep 10', run_in_background: true, description: 'watch' },
        signal,
      }),
    ).resolves.toMatchObject({
      isError: true,
      output:
        'Background execution is not available for this agent because TaskOutput and TaskStop are not enabled.',
    });

    ctx.agent.tools.setActiveTools(['Bash', 'TaskList', 'TaskOutput', 'TaskStop']);

    const managedBash = ctx.agent.tools.loopTools.find((tool) => tool.name === 'Bash');
    expect(managedBash).toBeDefined();
    expect(managedBash!.description).toContain('run_in_background=true');
  });

  it('exposes DynamicWorkflow when a subagent host is available', () => {
    const subagentHost = { getProfiles: () => ({}) } as unknown as SessionSubagentHost;

    const ctx = testAgent({
      subagentHost,
      experimentalFlags: new FlagResolver({}, FLAG_DEFINITIONS),
    });
    ctx.configure({ tools: ['DynamicWorkflow'] });

    expect(ctx.agent.tools.loopTools.some((tool) => tool.name === 'DynamicWorkflow')).toBe(true);
    expect(ctx.agent.tools.loopTools.some((tool) => tool.name === 'AgentSwarm')).toBe(false);
  });

  it('skips DynamicWorkflow registration when disableWorkflows is set', () => {
    const subagentHost = { getProfiles: () => ({}) } as unknown as SessionSubagentHost;

    const ctx = testAgent({
      subagentHost,
      experimentalFlags: new FlagResolver({}, FLAG_DEFINITIONS),
      initialConfig: { providers: {}, disableWorkflows: true },
    });
    ctx.configure({ tools: ['DynamicWorkflow'] });

    expect(ctx.agent.tools.loopTools.some((tool) => tool.name === 'DynamicWorkflow')).toBe(false);
  });

  it('registers DynamicWorkflow with the configured size guideline in its description', () => {
    const subagentHost = { getProfiles: () => ({}) } as unknown as SessionSubagentHost;

    const ctx = testAgent({
      subagentHost,
      experimentalFlags: new FlagResolver({}, FLAG_DEFINITIONS),
      initialConfig: { providers: {}, workflowSizeGuideline: 'small' },
    });
    ctx.configure({ tools: ['DynamicWorkflow'] });

    const tool = ctx.agent.tools.loopTools.find((tool) => tool.name === 'DynamicWorkflow');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('about 5 subagents');
  });

  it('rejects a user tool whose name collides with a builtin before recording it', () => {
    const ctx = testAgent();
    ctx.configure();
    const logRecord = vi.spyOn(ctx.agent.records, 'logRecord');

    expect(() => ctx.agent.tools.registerUserTool(userTool('Read'))).toThrow(
      /builtin tool/u,
    );
    expect(logRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tools.register_user_tool', name: 'Read' }),
    );
  });

  it('rejects a duplicate user tool before recording it twice', () => {
    const ctx = testAgent();
    const logRecord = vi.spyOn(ctx.agent.records, 'logRecord');

    ctx.agent.tools.registerUserTool(userTool('Lookup'));
    expect(() => ctx.agent.tools.registerUserTool(userTool('Lookup'))).toThrow(
      /already-registered user tool/u,
    );
    expect(
      logRecord.mock.calls.filter(
        ([record]) => record.type === 'tools.register_user_tool' && record.name === 'Lookup',
      ),
    ).toHaveLength(1);
  });

  it('emits an MCP collision and skips a tool that conflicts with a user tool', () => {
    const ctx = testAgent();
    const name = 'mcp__server__lookup';
    ctx.agent.tools.registerUserTool(userTool(name));
    const client = fakeMcpClient();
    attachMcpManager(
      ctx,
      {
        list: () => [
          { name: 'server', transport: 'stdio', status: 'connected', toolCount: 1 },
        ],
        resolved: () => ({
          client,
          tools: [mcpTool('lookup')],
          enabledNames: new Set(['lookup']),
        }),
        onStatusChange: () => () => undefined,
      } as unknown as McpConnectionManager,
    );

    expect(ctx.agent.tools.data().filter((info) => info.name === name).map((info) => info.source))
      .toEqual(['user']);
    expect(ctx.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'error',
        args: expect.objectContaining({ code: ErrorCodes.MCP_TOOL_NAME_COLLISION }),
      }),
    );
  });

  it('rejects the second writer for both user and MCP insertion orders', () => {
    const client = fakeMcpClient();
    const userFirst = testAgent();
    userFirst.agent.tools.registerUserTool(userTool('mcp__server__lookup'));
    const mcpResult = userFirst.agent.tools.registerMcpServer(
      'server',
      client,
      [mcpTool('lookup')],
    );
    expect(mcpResult.registered).toEqual([]);
    expect(mcpResult.collisions).toHaveLength(1);

    const mcpFirst = testAgent();
    mcpFirst.agent.tools.registerMcpServer('server', client, [mcpTool('lookup')]);
    expect(() =>
      mcpFirst.agent.tools.registerUserTool(userTool('mcp__server__lookup')),
    ).toThrow(/registered MCP tool/u);
  });

  it('emits an MCP collision and skips a needs-auth tool that conflicts with a user tool', () => {
    const ctx = testAgent();
    const name = 'mcp__secure__authenticate';
    ctx.agent.tools.registerUserTool(userTool(name));
    attachMcpManager(
      ctx,
      {
        oauthService: {},
        getRemoteServerUrl: () => 'https://example.test/mcp',
        reconnect: async () => undefined,
        list: () => [
          { name: 'secure', transport: 'http', status: 'needs-auth', toolCount: 0 },
        ],
        onStatusChange: () => () => undefined,
      } as unknown as McpConnectionManager,
    );

    expect(ctx.agent.tools.data().filter((info) => info.name === name).map((info) => info.source))
      .toEqual(['user']);
    expect(ctx.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'error',
        args: expect.objectContaining({ code: ErrorCodes.MCP_TOOL_NAME_COLLISION }),
      }),
    );
  });

  it('logs a delayed builtin collision when builtin tools are initialized', () => {
    const ctx = testAgent();
    const logError = vi.spyOn(ctx.agent.log, 'error');
    ctx.agent.tools.registerUserTool(userTool('Read'));

    ctx.configure();

    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('collision'),
      expect.objectContaining({ name: 'Read', existing: 'user', incoming: 'builtin' }),
    );
  });

  it('includes MCP server identity and input schema in getTools output', async () => {
    const ctx = testAgent();
    const inputSchema = { type: 'object', properties: { query: { type: 'string' } } };
    ctx.agent.tools.registerMcpServer('myserver', fakeMcpClient(), [
      { name: 'mytool', description: 'Searches', parameters: inputSchema },
    ]);

    const tools = await ctx.rpc.getTools({});

    expect(tools.find((tool) => tool.name === 'mcp__myserver__mytool')).toMatchObject({
      mcpServerId: 'myserver',
      inputSchema,
    });
  });

  it('routes registered user tools through tool.call request/response', async () => {
    const lookupCall: ToolCall = {
      type: 'function',
      id: 'call_lookup',
      name: 'Lookup',
      arguments: '{"query":"moon"}',
    };
    const ctx = testAgent();
    ctx.configure();
    await ctx.rpc.setPermission({ mode: 'auto' });
    await ctx.rpc.registerTool({
      name: 'Lookup',
      description: 'Look up a short test value.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    });

    ctx.mockNextResponse({ type: 'text', text: 'I will look it up.' }, lookupCall);
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Look up moon' }] });
    expect(
      await ctx.untilToolCall({
        content: 'moon-result',
        output: 'moon-result',
      }),
    ).toMatchInlineSnapshot(`
      [wire] permission.set_mode         { "mode": "auto", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 0, "maxContextTokens": 1000000, "contextUsage": 0, "planMode": false, "dynamicWorkflowMode": false, "permission": "auto" }
      [wire] tools.register_user_tool    { "name": "Lookup", "description": "Look up a short test value.", "parameters": { "type": "object", "properties": { "query": { "type": "string" } }, "required": [ "query" ], "additionalProperties": false }, "time": "<time>" }
      [wire] turn.prompt                 { "input": [ { "type": "text", "text": "Look up moon" } ], "origin": { "kind": "user" }, "time": "<time>" }
      [emit] turn.started                { "turnId": 0, "origin": { "kind": "user" } }
      [wire] context.append_message      { "message": { "role": "user", "content": [ { "type": "text", "text": "Look up moon" } ], "toolCalls": [], "origin": { "kind": "user" } }, "time": "<time>" }
      [wire] context.append_message      { "message": { "role": "user", "content": [ { "type": "text", "text": "<auto-mode-enter-reminder>" } ], "toolCalls": [], "origin": { "kind": "injection", "variant": "permission_mode" } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "step.begin", "uuid": "<uuid-1>", "turnId": "0", "step": 1 }, "time": "<time>" }
      [emit] turn.step.started           { "turnId": 0, "step": 1, "stepId": "<uuid-1>" }
      [emit] assistant.delta             { "turnId": 0, "delta": "I will look it up." }
      [emit] tool.call.delta             { "turnId": 0, "toolCallId": "call_lookup", "name": "Lookup", "argumentsPart": "{\\"query\\":\\"moon\\"}" }
      [wire] context.append_loop_event   { "event": { "type": "content.part", "uuid": "<uuid-2>", "turnId": "0", "step": 1, "stepUuid": "<uuid-1>", "part": { "type": "text", "text": "I will look it up." } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "tool.call", "uuid": "call_lookup", "turnId": "0", "step": 1, "stepUuid": "<uuid-1>", "toolCallId": "call_lookup", "name": "Lookup", "args": { "query": "moon" } }, "time": "<time>" }
      [emit] tool.call.started           { "turnId": 0, "toolCallId": "call_lookup", "name": "Lookup", "args": { "query": "moon" } }
      [emit] toolCall                    { "turnId": 0, "toolCallId": "call_lookup", "args": { "query": "moon" } }
    `);
    expect(ctx.lastLlmInput()).toMatchInlineSnapshot(`
      system: <system-prompt>
      tools: Lookup
      messages:
        user: text "Look up moon"
        user: text <auto-mode-enter-reminder>
    `);

    ctx.mockNextResponse({ type: 'text', text: 'The lookup result is moon-result.' });
    expect(await ctx.untilTurnEnd()).toMatchInlineSnapshot(`
      [wire] context.append_loop_event   { "event": { "type": "tool.result", "parentUuid": "call_lookup", "toolCallId": "call_lookup", "result": { "output": "moon-result" } }, "time": "<time>" }
      [emit] tool.result                 { "turnId": 0, "toolCallId": "call_lookup", "output": "moon-result" }
      [wire] context.append_loop_event   { "event": { "type": "step.end", "uuid": "<uuid-1>", "turnId": "0", "step": 1, "usage": { "inputOther": 88, "output": 16, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "tool_use" }, "time": "<time>" }
      [emit] turn.step.completed         { "turnId": 0, "step": 1, "stepId": "<uuid-1>", "usage": { "inputOther": 88, "output": 16, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "tool_use" }
      [wire] usage.record                { "model": "mock-model", "usage": { "inputOther": 88, "output": 16, "inputCacheRead": 0, "inputCacheCreation": 0 }, "usageScope": "turn", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 104, "maxContextTokens": 1000000, "contextUsage": 0.000104, "planMode": false, "dynamicWorkflowMode": false, "permission": "auto", "usage": { "byModel": { "mock-model": { "inputOther": 88, "output": 16, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "total": { "inputOther": 88, "output": 16, "inputCacheRead": 0, "inputCacheCreation": 0 }, "currentTurn": { "inputOther": 88, "output": 16, "inputCacheRead": 0, "inputCacheCreation": 0 } } }
      [wire] context.append_loop_event   { "event": { "type": "step.begin", "uuid": "<uuid-3>", "turnId": "0", "step": 2 }, "time": "<time>" }
      [emit] turn.step.started           { "turnId": 0, "step": 2, "stepId": "<uuid-3>" }
      [emit] assistant.delta             { "turnId": 0, "delta": "The lookup result is moon-result." }
      [wire] context.append_loop_event   { "event": { "type": "content.part", "uuid": "<uuid-4>", "turnId": "0", "step": 2, "stepUuid": "<uuid-3>", "part": { "type": "text", "text": "The lookup result is moon-result." } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "step.end", "uuid": "<uuid-3>", "turnId": "0", "step": 2, "usage": { "inputOther": 108, "output": 12, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "end_turn" }, "time": "<time>" }
      [emit] turn.step.completed         { "turnId": 0, "step": 2, "stepId": "<uuid-3>", "usage": { "inputOther": 108, "output": 12, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "end_turn" }
      [wire] usage.record                { "model": "mock-model", "usage": { "inputOther": 108, "output": 12, "inputCacheRead": 0, "inputCacheCreation": 0 }, "usageScope": "turn", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 120, "maxContextTokens": 1000000, "contextUsage": 0.00012, "planMode": false, "dynamicWorkflowMode": false, "permission": "auto", "usage": { "byModel": { "mock-model": { "inputOther": 196, "output": 28, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "total": { "inputOther": 196, "output": 28, "inputCacheRead": 0, "inputCacheCreation": 0 }, "currentTurn": { "inputOther": 196, "output": 28, "inputCacheRead": 0, "inputCacheCreation": 0 } } }
      [emit] turn.ended                  { "turnId": 0, "reason": "completed" }
    `);
    expect(ctx.lastLlmInput()).toMatchInlineSnapshot(`
      messages:
        <last>
        assistant: text "I will look it up."  calls call_lookup:Lookup { "query": "moon" }
        tool[call_lookup]: text "moon-result"
    `);

    await ctx.rpc.unregisterTool({ name: 'Lookup' });
    ctx.mockNextResponse({ type: 'text', text: 'No lookup tool is available.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Can you still use Lookup?' }] });

    expect(await ctx.untilTurnEnd()).toMatchInlineSnapshot(`
      [wire] tools.unregister_user_tool   { "name": "Lookup", "time": "<time>" }
      [wire] turn.prompt                  { "input": [ { "type": "text", "text": "Can you still use Lookup?" } ], "origin": { "kind": "user" }, "time": "<time>" }
      [emit] turn.started                 { "turnId": 1, "origin": { "kind": "user" } }
      [wire] context.append_message       { "message": { "role": "user", "content": [ { "type": "text", "text": "Can you still use Lookup?" } ], "toolCalls": [], "origin": { "kind": "user" } }, "time": "<time>" }
      [wire] context.append_loop_event    { "event": { "type": "step.begin", "uuid": "<uuid-5>", "turnId": "1", "step": 1 }, "time": "<time>" }
      [emit] turn.step.started            { "turnId": 1, "step": 1, "stepId": "<uuid-5>" }
      [emit] assistant.delta              { "turnId": 1, "delta": "No lookup tool is available." }
      [wire] context.append_loop_event    { "event": { "type": "content.part", "uuid": "<uuid-6>", "turnId": "1", "step": 1, "stepUuid": "<uuid-5>", "part": { "type": "text", "text": "No lookup tool is available." } }, "time": "<time>" }
      [wire] context.append_loop_event    { "event": { "type": "step.end", "uuid": "<uuid-5>", "turnId": "1", "step": 1, "usage": { "inputOther": 128, "output": 10, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "end_turn" }, "time": "<time>" }
      [emit] turn.step.completed          { "turnId": 1, "step": 1, "stepId": "<uuid-5>", "usage": { "inputOther": 128, "output": 10, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "end_turn" }
      [wire] usage.record                 { "model": "mock-model", "usage": { "inputOther": 128, "output": 10, "inputCacheRead": 0, "inputCacheCreation": 0 }, "usageScope": "turn", "time": "<time>" }
      [emit] agent.status.updated         { "model": "mock-model", "contextTokens": 138, "maxContextTokens": 1000000, "contextUsage": 0.000138, "planMode": false, "dynamicWorkflowMode": false, "permission": "auto", "usage": { "byModel": { "mock-model": { "inputOther": 324, "output": 38, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "total": { "inputOther": 324, "output": 38, "inputCacheRead": 0, "inputCacheCreation": 0 }, "currentTurn": { "inputOther": 128, "output": 10, "inputCacheRead": 0, "inputCacheCreation": 0 } } }
      [emit] turn.ended                   { "turnId": 1, "reason": "completed" }
    `);
    expect(ctx.lastLlmInput()).toMatchInlineSnapshot(`
      tools: []
      messages:
        <last>
        assistant: text "The lookup result is moon-result."
        user: text "Can you still use Lookup?"
    `);
    await ctx.expectResumeMatches();
  });

  it('validates and returns turn-local structured output', async () => {
    const ctx = testAgent();
    ctx.configure();
    ctx.mockNextResponse({
      type: 'function',
      id: 'call_structured_output',
      name: 'StructuredOutput',
      arguments: '{"summary":"done","count":2}',
    });

    await ctx.rpc.prompt({
      input: [{ type: 'text', text: 'Return a structured summary' }],
      outputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          count: { type: 'integer' },
        },
        required: ['summary', 'count'],
        additionalProperties: false,
      },
    });
    await ctx.untilTurnEnd();

    expect(ctx.llmCalls[0]?.tools).toContainEqual(
      expect.objectContaining({
        name: 'StructuredOutput',
        parameters: expect.objectContaining({
          required: ['summary', 'count'],
        }),
      }),
    );
    expect(ctx.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'turn.ended',
        args: expect.objectContaining({
          reason: 'completed',
          structuredOutput: { summary: 'done', count: 2 },
        }),
      }),
    );
  });

  it('continues a structured-output turn until the tool is called', async () => {
    const ctx = testAgent();
    ctx.configure();
    ctx.mockNextResponse({ type: 'text', text: 'I forgot the requested format.' });
    ctx.mockNextResponse({
      type: 'function',
      id: 'call_structured_output',
      name: 'StructuredOutput',
      arguments: '{"ok":true}',
    });

    await ctx.rpc.prompt({
      input: [{ type: 'text', text: 'Return a structured result' }],
      outputSchema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
    });
    await ctx.untilTurnEnd();

    expect(ctx.llmCalls).toHaveLength(2);
    expect(JSON.stringify(ctx.llmCalls[1]?.history)).toContain(
      'You MUST call the StructuredOutput tool',
    );
    expect(ctx.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'turn.ended',
        args: expect.objectContaining({
          structuredOutput: { ok: true },
        }),
      }),
    );
  });

  it('rejects an invalid structured output schema before starting a turn', async () => {
    const ctx = testAgent();
    ctx.configure();

    await expect(
      ctx.rpc.prompt({
        input: [{ type: 'text', text: 'Return structured output' }],
        outputSchema: { type: 'not-a-json-schema-type' },
      }),
    ).rejects.toMatchObject({
      code: ErrorCodes.REQUEST_INVALID,
      message: expect.stringContaining('Invalid structured output JSON Schema'),
    });
    expect(ctx.llmCalls).toHaveLength(0);
  });

  it('fails after five structured output completion reminders', async () => {
    const ctx = testAgent();
    ctx.configure();
    for (let index = 0; index < 6; index += 1) {
      ctx.mockNextResponse({ type: 'text', text: `unstructured ${String(index)}` });
    }

    await ctx.rpc.prompt({
      input: [{ type: 'text', text: 'Return structured output' }],
      outputSchema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
    });
    await ctx.untilTurnEnd();

    expect(ctx.llmCalls).toHaveLength(6);
    expect(ctx.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'turn.ended',
        args: expect.objectContaining({
          reason: 'failed',
          error: expect.objectContaining({
            code: ErrorCodes.STRUCTURED_OUTPUT_MAX_RETRIES,
          }),
        }),
      }),
    );
  });
});

function bashCall(): ToolCall {
  return {
    type: 'function',
    id: 'call_bash',
    name: 'Bash',
    arguments: '{"command":"printf hook-output","timeout":60}',
  };
}

function agentCall(): ToolCall {
  return {
    type: 'function',
    id: 'call_agent',
    name: 'Agent',
    arguments: JSON.stringify({
        prompt: 'Investigate deeply',
        description: 'Investigate deeply',
        subagent_type: 'coder',
      }),
  };
}

function hookErrorMessageAssertCommand(expected: string): string {
  const script = [
    "let input = '';",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => {",
    '  const payload = JSON.parse(input);',
    `  if (payload.error?.message === ${JSON.stringify(expected)}) process.exit(0);`,
    "  console.error(payload.error?.message ?? '<missing>');",
    '  process.exit(2);',
    '});',
  ].join('');
  return `node -e ${JSON.stringify(script)}`;
}

function userTool(name: string) {
  return {
    name,
    description: `${name} test tool`,
    parameters: { type: 'object', properties: {} },
  };
}

function mcpTool(name: string): Tool {
  return {
    name,
    description: `${name} MCP test tool`,
    parameters: { type: 'object', properties: {} },
  };
}

function fakeMcpClient(): MCPClient {
  return {
    async listTools() {
      return [];
    },
    async callTool() {
      return { content: [], isError: false };
    },
  };
}

function attachMcpManager(
  ctx: ReturnType<typeof testAgent>,
  manager: McpConnectionManager,
): void {
  Object.defineProperty(ctx.agent, 'mcp', { value: manager });
  ctx.agent.tools.attachMcpTools();
}
