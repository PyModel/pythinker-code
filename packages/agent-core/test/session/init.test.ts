import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { testKaos } from '../fixtures/test-kaos';
import type { ProviderConfig, ToolCall } from '@pymodel/kosong';
import type { Kaos, StatResult } from '@pymodel/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent, AgentOptions } from '../../src/agent';
import { trimTrailingOpenToolExchange } from '../../src/agent/context/projector';
import { FlagResolver } from '../../src/flags';
import { ProviderManager } from '../../src/session/provider-manager';
import type { ResolvedAgentProfile } from '../../src/profile';
import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import { SessionAPIImpl } from '../../src/session/rpc';
import { estimateTokensForMessages } from '../../src/utils/tokens';
import { createScriptedGenerate } from '../agent/harness/scripted-generate';
import { recordingTelemetry, type TelemetryRecord } from '../fixtures/telemetry';
import { executeTool } from '../tools/fixtures/execute-tool';
import { createFakeKaos, toolContentString } from '../tools/fixtures/fake-kaos';

const MOCK_PROVIDER = {
  type: 'pythinker',
  apiKey: 'test-key',
  model: 'mock-model',
} as const satisfies ProviderConfig;


const here = import.meta.dirname;
const mcpStdioFixture = join(here, '..', 'mcp', 'fixtures', 'mock-stdio-server.mjs');

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('Session.init', () => {
  it('previews active conversation checkpoints and invalidates reads after restore', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const path = join(workDir, 'greeting.txt');
    await writeFile(path, 'before\n', 'utf8');
    const session = new Session({
      id: 'test-file-checkpoint-restore',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });
    const { agent } = await session.createAgent(
      { type: 'main' },
      { profile: testProfile() },
    );
    agent.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
    agent.tools.setActiveTools(['Read', 'Edit']);
    const store = session.fileCheckpoints;
    if (store === undefined) throw new Error('Expected checkpoint store');

    try {
      const compactedId = await store.beginUserCheckpoint('old prompt');
      agent.context.appendUserMessage(
        [{ type: 'text', text: 'old prompt' }],
        { kind: 'user', checkpointId: compactedId },
      );
      agent.context.applyCompaction({
        summary: 'old summary',
        compactedCount: 1,
        tokensBefore: 10,
        tokensAfter: 2,
      });

      const activeId = await store.beginUserCheckpoint('change greeting');
      agent.setFileCheckpointId(activeId);
      agent.context.appendUserMessage(
        [{ type: 'text', text: 'change greeting' }],
        { kind: 'user', checkpointId: activeId },
      );
      const read = agent.tools.loopTools.find((tool) => tool.name === 'Read');
      const edit = agent.tools.loopTools.find((tool) => tool.name === 'Edit');
      await executeTool(read!, {
        turnId: '0',
        toolCallId: 'call_read',
        args: { path },
        signal: new AbortController().signal,
      });
      await executeTool(edit!, {
        turnId: '0',
        toolCallId: 'call_edit',
        args: { path, old_string: 'before', new_string: 'after' },
        signal: new AbortController().signal,
      });

      const api = new SessionAPIImpl(session);
      await expect(
        api.previewFileCheckpoint({ checkpointId: compactedId }),
      ).resolves.toMatchObject({ conversationAvailable: false });
      await expect(
        api.previewFileCheckpoint({ checkpointId: activeId }),
      ).resolves.toMatchObject({
        conversationAvailable: true,
        paths: [expect.objectContaining({ path })],
      });
      await api.restoreFileCheckpoint({ checkpointId: activeId });

      expect(await testKaos.readText(path)).toBe('before\n');
      expect(agent.tools.contextFiles()).toEqual([]);
      await expect(
        executeTool(edit!, {
          turnId: '0',
          toolCallId: 'call_edit_again',
          args: { path, old_string: 'before', new_string: 'again' },
          signal: new AbortController().signal,
        }),
      ).resolves.toMatchObject({
        isError: true,
        output: expect.stringContaining('has not been read'),
      });
    } finally {
      await session.close();
    }
  });

  it('persists checkpoint IDs on main user prompts and user-slash skills', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const scripted = createScriptedGenerate();
    let releaseFirstResponse = () => {};
    const firstResponseGate = new Promise<void>((resolve) => {
      releaseFirstResponse = resolve;
    });
    let blockFirstResponse = true;
    const generate: NonNullable<AgentOptions['generate']> = async (...args) => {
      if (blockFirstResponse) {
        blockFirstResponse = false;
        await firstResponseGate;
      }
      return scripted.generate(...args);
    };
    const session = new Session({
      id: 'test-file-checkpoint-prompts',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });
    await session.listSkills();
    session.skills.register({
      name: 'checkpoint-skill',
      description: 'Exercise checkpoint boundaries.',
      path: join(workDir, 'checkpoint-skill', 'SKILL.md'),
      dir: join(workDir, 'checkpoint-skill'),
      content: 'Run the checkpoint skill.',
      metadata: { type: 'prompt' },
      source: 'project',
    });
    const { agent } = await session.createAgent(
      { type: 'main', generate },
      { profile: testProfile() },
    );
    agent.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
    const api = new SessionAPIImpl(session);

    try {
      scripted.mockNextResponse({ type: 'text', text: 'Prompt complete.' });
      await api.prompt({
        agentId: 'main',
        input: [{ type: 'text', text: 'Change the greeting' }],
      });
      await api.prompt({
        agentId: 'main',
        input: [{ type: 'text', text: 'Do not checkpoint this busy prompt' }],
      });
      await expect(session.fileCheckpoints?.list()).resolves.toHaveLength(1);
      releaseFirstResponse();
      await agent.turn.waitForCurrentTurn();

      const promptOrigin = agent.context.data().history.find(
        (message) => message.role === 'user' && message.origin?.kind === 'user',
      )?.origin;
      expect(promptOrigin).toMatchObject({
        kind: 'user',
        checkpointId: expect.any(String),
      });

      scripted.mockNextResponse({ type: 'text', text: 'Skill complete.' });
      await api.activateSkill({
        agentId: 'main',
        name: 'checkpoint-skill',
        args: 'now',
      });
      await agent.turn.waitForCurrentTurn();

      const skillOrigin = agent.context.data().history.findLast(
        (message) => message.origin?.kind === 'skill_activation',
      )?.origin;
      expect(skillOrigin).toMatchObject({
        kind: 'skill_activation',
        checkpointId: expect.any(String),
      });
      expect(skillOrigin?.kind === 'skill_activation' && skillOrigin.checkpointId)
        .not.toBe(
          promptOrigin?.kind === 'user' ? promptOrigin.checkpointId : undefined,
        );

      await expect(session.fileCheckpoints?.list()).resolves.toEqual([
        expect.objectContaining({
          id:
            promptOrigin?.kind === 'user'
              ? promptOrigin.checkpointId
              : undefined,
          prompt: 'Change the greeting',
        }),
        expect.objectContaining({
          id:
            skillOrigin?.kind === 'skill_activation'
              ? skillOrigin.checkpointId
              : undefined,
          prompt: '/checkpoint-skill now',
        }),
      ]);
    } finally {
      releaseFirstResponse();
      await session.close();
    }
  });

  it('emits transient hook status around configured hook execution', async () => {
    const events: Array<Record<string, unknown>> = [];
    const workDir = await makeTempDir();
    const session = new Session({
      id: 'test-hook-status',
      kaos: testKaos.withCwd(workDir),
      homedir: await makeTempDir(),
      rpc: createSessionRpc(events),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      hooks: [
        {
          event: 'Notification',
          command: 'node -e "setTimeout(() => {}, 10)"',
          statusMessage: 'Checking notification',
        },
      ],
    });

    try {
      await session.hookEngine.trigger('Notification');
      const statuses = events.filter((event) => event['type'] === 'hook.status');
      expect(statuses).toEqual([
        {
          type: 'hook.status',
          agentId: 'main',
          statusId: expect.any(String),
          hookEvent: 'Notification',
          content: 'Checking notification',
          active: true,
        },
        {
          type: 'hook.status',
          agentId: 'main',
          statusId: expect.any(String),
          hookEvent: 'Notification',
          content: 'Checking notification',
          active: false,
        },
      ]);
      expect(statuses[0]?.['statusId']).toBe(statuses[1]?.['statusId']);
    } finally {
      await session.close();
    }
  });

  it('steers exit-code-2 asyncRewake output back into the main agent', async () => {
    const workDir = await makeTempDir();
    const session = new Session({
      id: 'test-async-hook-rewake',
      kaos: testKaos.withCwd(workDir),
      homedir: await makeTempDir(),
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      hooks: [
        {
          event: 'Notification',
          command: `node -e "process.stderr.write('fix required'); process.exit(2)"`,
          asyncRewake: true,
        },
      ],
    });

    try {
      const agent = await session.createMain();
      const steer = vi.spyOn(agent.turn, 'steer').mockReturnValue(null);

      await expect(session.hookEngine.trigger('Notification')).resolves.toEqual([]);
      await vi.waitFor(() => {
        expect(steer).toHaveBeenCalledWith(
          [
            {
              type: 'text',
              text: '<hook_result hook_event="Notification">\nfix required\n</hook_result>',
            },
          ],
          { kind: 'hook_result', event: 'Notification' },
        );
      });
    } finally {
      await session.close();
    }
  });

  it('evaluates prompt hooks over the current conversation with structured output', async () => {
    const workDir = await makeTempDir();
    const scripted = createScriptedGenerate();
    const session = new Session({
      id: 'test-prompt-hook',
      kaos: testKaos.withCwd(workDir),
      homedir: await makeTempDir(),
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
      hooks: [
        {
          event: 'Stop',
          type: 'prompt',
          prompt: 'Check this result: $ARGUMENTS',
        },
      ],
    });

    try {
      const { agent } = await session.createAgent(
        { type: 'main', generate: scripted.generate },
        { profile: testProfile() },
      );
      agent.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
      agent.context.appendUserMessage([{ type: 'text', text: 'Main request' }]);
      const { agent: child } = await session.createAgent(
        { type: 'sub', generate: scripted.generate },
        { profile: testProfile(), parentAgentId: 'main' },
      );
      child.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
      child.context.appendUserMessage([{ type: 'text', text: 'Subagent request' }]);
      scripted.mockNextResponse({
        type: 'function',
        id: 'prompt-hook-output',
        name: 'StructuredOutput',
        arguments: '{"ok":false,"reason":"required check is missing"}',
      });

      await expect(
        session.hookEngine.triggerBlock('Stop', {
          inputData: { agentId: child.agentId, completed: false },
        }),
      ).resolves.toEqual({ block: true, reason: 'required check is missing' });
      expect(scripted.calls).toHaveLength(1);
      expect(scripted.calls[0]?.tools.map((tool) => tool.name)).toEqual(['StructuredOutput']);
      expect(JSON.stringify(scripted.calls[0]?.history)).toContain('Subagent request');
      expect(JSON.stringify(scripted.calls[0]?.history)).not.toContain('Main request');
      expect(JSON.stringify(scripted.calls[0]?.history)).toContain(
        'Check this result: {\\"hook_event_name\\":\\"Stop\\"',
      );
      expect(session.agents.size).toBe(2);
    } finally {
      await session.close();
    }
  });

  it('runs agent hooks with the verification profile and structured output', async () => {
    const workDir = await makeTempDir();
    const scripted = createScriptedGenerate();
    const session = new Session({
      id: 'test-agent-hook',
      kaos: testKaos.withCwd(workDir),
      homedir: await makeTempDir(),
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
      hooks: [
        {
          event: 'Stop',
          type: 'agent',
          prompt: 'Verify the implementation',
        },
      ],
    });

    try {
      const { agent } = await session.createAgent(
        { type: 'main', generate: scripted.generate },
        { profile: testProfile() },
      );
      agent.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
      scripted.mockNextResponse({
        type: 'function',
        id: 'agent-hook-output',
        name: 'StructuredOutput',
        arguments: '{"ok":true}',
      });

      await expect(session.hookEngine.trigger('Stop')).resolves.toEqual([
        expect.objectContaining({ action: 'allow' }),
      ]);
      expect(scripted.calls).toHaveLength(1);
      expect(scripted.calls[0]?.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['Read', 'Bash', 'StructuredOutput']),
      );
      expect(scripted.calls[0]?.tools.map((tool) => tool.name)).not.toContain('Agent');
      expect(JSON.stringify(scripted.calls[0]?.history)).toContain('Verify the implementation');
      expect(session.agents.size).toBe(1);
    } finally {
      await session.close();
    }
  });

  it('loads project memory for the main agent when agent memory is enabled', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const memoryDir = join(workDir, '.pythinker-code', 'agent-memory', 'agent');
    await mkdir(memoryDir, { recursive: true });
    await writeFile(join(memoryDir, 'MEMORY.md'), '- Use focused integration tests', 'utf-8');
    const session = new Session({
      id: 'test-main-agent-memory',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
      experimentalFlags: new FlagResolver({
        PYTHINKER_CODE_EXPERIMENTAL_AGENT_MEMORY: '1',
      }),
    });

    try {
      const agent = await session.createMain();

      expect(agent.config.systemPrompt).toContain('# Persistent Agent Memory');
      expect(agent.config.systemPrompt).toContain('- Use focused integration tests');
    } finally {
      await session.close();
    }
  });

  it('boots the main agent with the coordinator profile when coordinator mode is enabled', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const session = new Session({
      id: 'test-coordinator-mode',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
      experimentalFlags: new FlagResolver({
        PYTHINKER_CODE_EXPERIMENTAL_COORDINATOR_MODE: '1',
      }),
    });

    try {
      const agent = await session.createMain();

      expect(agent.config.profileName).toBe('coordinator');
      expect(agent.config.systemPrompt).toContain('Synthesize worker results');
    } finally {
      await session.close();
    }
  });

  it('refreshes the active main-agent instructions from AGENTS.md', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const agentsPath = join(workDir, 'AGENTS.md');
    await writeFile(agentsPath, 'Initial project instructions', 'utf-8');
    const session = new Session({
      id: 'test-refresh-instructions',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });

    try {
      const { agent } = await session.createAgent(
        { type: 'main' },
        {
          profile: {
            name: 'agent',
            systemPrompt: (context) => String(context.agentsMd),
            tools: [],
          },
        },
      );
      expect(agent.config.systemPrompt).toContain('Initial project instructions');

      await writeFile(agentsPath, 'Updated project instructions', 'utf-8');
      await new SessionAPIImpl(session).refreshInstructions({});

      expect(agent.config.systemPrompt).toContain('Updated project instructions');
      expect(agent.config.systemPrompt).not.toContain('Initial project instructions');
      expect(JSON.stringify(agent.context.history)).toContain('instructions were refreshed');
    } finally {
      await session.close();
    }
  });

  it('adds, lists, and removes extra workspace directories through the session boundary', async () => {
    const workDir = await makeTempDir();
    const configuredDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const addedDir = await makeTempDir();
    const nestedDir = join(workDir, 'nested');
    const filePath = join(workDir, 'file.txt');
    const contextFile = join(addedDir, 'note.txt');
    await mkdir(nestedDir);
    await writeFile(filePath, 'not a directory', 'utf-8');
    await writeFile(contextFile, 'workspace note', 'utf-8');

    const session = new Session({
      id: 'test-workspace-directories',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      config: { providers: {}, additionalDirs: [configuredDir] },
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });

    try {
      const { agent } = await session.createAgent(
        { type: 'main' },
        {
          profile: {
            name: 'workspace',
            systemPrompt: (context) => String(context.additionalDirsInfo),
            tools: ['Read'],
          },
        },
      );
      const api = new SessionAPIImpl(session);
      agent.config.update({ modelAlias: MOCK_PROVIDER.model, thinkingLevel: 'off' });

      expect(api.listWorkspaceDirectories({})).toEqual([
        { path: configuredDir, source: 'user' },
      ]);
      expect(agent.config.systemPrompt).toContain(configuredDir);

      await expect(api.addWorkspaceDirectory({ path: nestedDir })).rejects.toThrow(
        'already accessible',
      );
      await expect(api.addWorkspaceDirectory({ path: filePath })).rejects.toThrow(
        'is not a directory',
      );

      await expect(api.addWorkspaceDirectory({ path: addedDir })).resolves.toEqual({
        path: addedDir,
        source: 'session',
      });
      expect(api.listWorkspaceDirectories({})).toEqual([
        { path: configuredDir, source: 'user' },
        { path: addedDir, source: 'session' },
      ]);
      expect(agent.additionalDirs).toEqual([configuredDir, addedDir]);
      expect(session.metadata.custom['additionalDirectories']).toEqual([addedDir]);
      expect(JSON.stringify(agent.context.history)).toContain(addedDir);

      const readTool = agent.tools.loopTools.find((tool) => tool.name === 'Read');
      if (readTool === undefined) throw new Error('Expected Read tool');
      const readResult = await executeTool(readTool, {
        args: { path: contextFile },
        turnId: '1',
        toolCallId: 'call_read_context_file',
        signal: new AbortController().signal,
      });
      expect(readResult.isError).not.toBe(true);
      expect(await api.listContextFiles({ agentId: 'main' })).toEqual([contextFile]);

      await api.removeWorkspaceDirectory({ path: addedDir });
      expect(api.listWorkspaceDirectories({})).toEqual([
        { path: configuredDir, source: 'user' },
      ]);
      expect(agent.additionalDirs).toEqual([configuredDir]);
    } finally {
      await session.close();
    }
  });

  it('applies the selected output style only to the main agent profile', async () => {
    const workDir = await makeTempDir();
    const session = new Session({
      id: 'test-output-style',
      kaos: testKaos.withCwd(workDir),
      homedir: await makeTempDir(),
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
      outputStyle: {
        name: 'concise',
        description: 'Short answers',
        prompt: 'Answer in short paragraphs.',
        source: 'user',
      },
    });

    const { agent: main } = await session.createAgent(
      { type: 'main' },
      { profile: testProfile() },
    );
    const { agent: child } = await session.createAgent(
      { type: 'sub' },
      { profile: testProfile(), parentAgentId: 'main' },
    );

    expect(main.config.systemPrompt).toContain('# Output Style: concise');
    expect(child.config.systemPrompt).not.toContain('# Output Style: concise');
    await session.close();
  });

  it('runs an isolated system-trigger turn and records the latest AGENTS as a system reminder', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    await mkdir(join(workDir, '.git'));
    await writeFile(join(workDir, 'AGENTS.md'), 'latest project instructions', 'utf-8');

    const events: Array<Record<string, unknown>> = [];
    const scripted = createScriptedGenerate();
    const session = new Session({
      id: 'test-init',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc(events),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });
    const { agent: mainAgent } = await session.createAgent(
      { type: 'main', generate: scripted.generate },
      { profile: testProfile() },
    );
    mainAgent.config.update({
      modelAlias: 'mock-model',
      thinkingLevel: 'off',
    });
    mainAgent.tools.setActiveTools([]);
    events.length = 0;
    scripted.mockNextResponse({
      type: 'text',
      text: 'Explored the project structure, identified the build and test commands, mapped the module layout, and wrote a comprehensive summary into AGENTS.md covering architecture, conventions, and the developer workflow for future agents.',
    });
    const hookTrigger = vi.spyOn(session.hookEngine, 'trigger');

    await session.generateAgentsMd();

    expect(hookTrigger).toHaveBeenCalledWith('Setup', {
      matcherValue: 'init',
      inputData: { agentId: 'main', trigger: 'init' },
    });
    expect(session.agents.size).toBe(2);
    expect(session.agents.get('main')).toBe(mainAgent);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'subagent.spawned',
        agentId: 'main',
        subagentId: 'agent-0',
        subagentName: 'coder',
        parentToolCallId: 'generate-agents-md',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turn.started',
        agentId: 'agent-0',
        origin: { kind: 'system_trigger', name: 'subagent' },
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'subagent.completed',
        agentId: 'main',
        subagentId: 'agent-0',
        contextTokens: expect.any(Number),
      }),
    );
    expect(scripted.calls[0]?.history).toMatchObject([
      {
        role: 'user',
        content: [
          expect.objectContaining({
            text: expect.stringContaining('Task requirements:'),
          }),
        ],
      },
    ]);

    const contextText = mainAgent.context.history
      .flatMap((message) => message.content)
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('\n');
    expect(contextText).toContain('<system-reminder>');
    expect(contextText).toContain('Latest AGENTS.md file content:');
    expect(contextText).toContain('latest project instructions');
    expect(contextText).not.toContain('Task requirements:');
  });

  it('loads AGENTS.md via the persistence kaos when the tool kaos rejects readText (Zed ACP "Internal error" regression)', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    await mkdir(join(workDir, '.git'));
    await writeFile(join(workDir, 'AGENTS.md'), 'project instructions from disk', 'utf-8');

    // Simulate Zed's `fs/readTextFile` returning a generic -32603 Internal
    // error: every `readText` through the tool kaos rejects. The persistence
    // kaos is a real LocalKaos that can reach AGENTS.md on disk.
    const toolKaos = wrapReadTextWithError(
      testKaos.withCwd(workDir),
      new Error('acp: readTextFile failed: Internal error'),
    );

    const capturedContext: { agentsMd: string | undefined } = { agentsMd: undefined };
    const events: Array<Record<string, unknown>> = [];
    const session = new Session({
      id: 'test-bootstrap-acp-fallback',
      kaos: toolKaos,
      persistenceKaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc(events),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });
    try {
      const { agent } = await session.createAgent(
        { type: 'main' },
        {
          profile: {
            name: 'capture',
            systemPrompt: (ctx) => {
              capturedContext.agentsMd = ctx.agentsMd;
              return '<system-prompt>';
            },
            tools: [],
          },
        },
      );

      expect(agent.config.systemPrompt).toBe('<system-prompt>');
      expect(capturedContext.agentsMd).toContain('project instructions from disk');
    } finally {
      await session.close();
    }
  });

  it('rebuilds builtin tools when rebinding the session tool kaos', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const staleKaos = createReadToolKaos(workDir, 'stale kaos\n');
    const replacementKaos = createReadToolKaos(workDir, 'replacement kaos\n');
    const session = new Session({
      id: 'test-rebind-tool-kaos',
      kaos: staleKaos,
      persistenceKaos: testKaos.withCwd(sessionDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });

    try {
      const { agent } = await session.createAgent({ type: 'main' }, { profile: testProfile() });
      agent.config.update({
        modelAlias: 'mock-model',
        thinkingLevel: 'off',
      });
      agent.tools.initializeBuiltinTools();
      agent.tools.setActiveTools(['Read']);

      session.setToolKaos(replacementKaos);

      const readTool = agent.tools.loopTools.find((candidate) => candidate.name === 'Read');
      expect(readTool).toBeDefined();
      const result = await executeTool(readTool!, {
        args: { path: join(workDir, 'file.txt') },
        turnId: '1',
        toolCallId: 'call_read',
        signal: new AbortController().signal,
      });

      expect(result.isError).not.toBe(true);
      expect(toolContentString(result)).toContain('replacement kaos');
    } finally {
      await session.close();
    }
  });

  it('tracks connected and failed MCP server totals after initial load', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const records: TelemetryRecord[] = [];
    const session = new Session({
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      providerManager: testProviderManager(),
      mcpConfig: {
        servers: {
          connected: {
            transport: 'stdio',
            command: process.execPath,
            args: [mcpStdioFixture],
          },
          failed: {
            transport: 'stdio',
            command: '/this/path/does/not/exist/anywhere',
          },
          disabled: {
            transport: 'stdio',
            command: process.execPath,
            args: [mcpStdioFixture],
            enabled: false,
          },
        },
      },
      telemetry: recordingTelemetry(records),
    });

    try {
      await session.mcp.waitForInitialLoad();
      await expect(new SessionAPIImpl(session).getMcpStartupMetrics({})).resolves.toEqual({
        durationMs: expect.any(Number),
      });

      expect(records).toContainEqual({
        event: 'mcp_connected',
        properties: {
          server_count: 1,
          total_count: 2,
        },
      });
      expect(records).toContainEqual({
        event: 'mcp_failed',
        properties: {
          failed_count: 1,
          total_count: 2,
        },
      });
    } finally {
      await session.close();
    }
  }, 20000);
});

describe('AgentAPI.startBtw', () => {
  it('runs a side subagent from a stable parent context snapshot without writing btw history', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();

    const events: Array<Record<string, unknown>> = [];
    const scripted = createScriptedGenerate();
    const session = new Session({
      id: 'test-btw',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc(events),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });
    const { agent: mainAgent } = await session.createAgent(
      { type: 'main', generate: scripted.generate },
      { profile: testProfile() },
    );
    mainAgent.config.update({
      modelAlias: 'mock-model',
      thinkingLevel: 'off',
    });
    mainAgent.tools.setActiveTools(['Read']);
    registerLookupNoteTool(mainAgent);
    mainAgent.context.appendUserMessage([{ type: 'text', text: 'Main task: implement /btw.' }]);
    mainAgent.context.appendLoopEvent({
      type: 'step.begin',
      uuid: 'open-step',
      turnId: 'main-turn',
      step: 1,
    });
    mainAgent.context.appendLoopEvent({
      type: 'tool.call',
      uuid: 'open-call',
      turnId: 'main-turn',
      step: 1,
      stepUuid: 'open-step',
      toolCallId: 'call-open',
      name: 'Read',
      args: { path: 'src/main.ts' },
    });
    events.length = 0;
    const summary = 'Main agent is implementing /btw.';
    scripted.mockNextResponse({ type: 'text', text: summary });

    try {
      const api = new SessionAPIImpl(session);
      const agentId = await api.startBtw({ agentId: 'main' });
      expect(agentId).toBe('agent-0');
      expect(scripted.calls).toHaveLength(0);
      expect(session.metadata.agents[agentId]).toBeUndefined();
      const childAgent = session.getReadyAgent(agentId);
      if (childAgent === undefined) throw new Error('Expected /btw child agent');
      const inheritedHistory = trimTrailingOpenToolExchange(
        mainAgent.context.project(mainAgent.context.history),
      );
      expect(childAgent.context.history.slice(0, inheritedHistory.length)).toEqual(inheritedHistory);
      expect(childAgent.context.tokenCount).toBe(0);
      expect(childAgent.context.tokenCountWithPending).toBeGreaterThanOrEqual(
        estimateTokensForMessages(inheritedHistory),
      );

      await api.prompt({
        agentId,
        input: [{ type: 'text', text: 'What are you working on right now?' }],
      });

      await vi.waitFor(() => {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'turn.ended',
            agentId: 'agent-0',
            reason: 'completed',
          }),
        );
      });
      expect(events.filter((event) => String(event['type']).startsWith('subagent.'))).toEqual([]);
      expect(events).toContainEqual(
          expect.objectContaining({
            type: 'turn.started',
            agentId: 'agent-0',
            origin: { kind: 'user' },
          }),
        );
      expect(scripted.calls).toHaveLength(1);
      expect(scripted.calls[0]?.systemPrompt).toBe('<system-prompt>');
      expect(scripted.calls[0]?.tools.map((tool) => tool.name)).toEqual([
        'LookupNote',
        'Read',
      ]);
      const historyText = JSON.stringify(scripted.calls[0]?.history);
      expect(historyText).toContain('Main task: implement /btw.');
      expect(historyText).toContain('This is a side-channel conversation with the user.');
      expect(historyText).toContain('All tool calls are disabled and will be rejected.');
      expect(historyText).toContain('What are you working on right now?');
      expect(historyText).not.toContain('call-open');
      expect(JSON.stringify(mainAgent.context.history)).not.toContain(
        'What are you working on right now?',
      );
      expect(JSON.stringify(session.getReadyAgent('agent-0')?.context.history)).toContain(
        'What are you working on right now?',
      );
      scripted.mockNextResponse({ type: 'text', text: 'Follow-up answer from the same side agent.' });
      await api.prompt({
        agentId,
        input: [{ type: 'text', text: 'Can you say that another way?' }],
      });
      await vi.waitFor(() => {
        expect(scripted.calls).toHaveLength(2);
      });
      const followUpHistoryText = JSON.stringify(scripted.calls[1]?.history);
      expect(followUpHistoryText).toContain('What are you working on right now?');
      expect(followUpHistoryText).toContain('Can you say that another way?');
      await expect(access(join(sessionDir, 'agents', 'agent-0', 'wire.jsonl'))).rejects.toThrow(/ENOENT/);
    } finally {
      await session.close();
    }
  });

  it('declares parent tools but rejects side-question tool calls before a second text turn', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();

    const events: Array<Record<string, unknown>> = [];
    const scripted = createScriptedGenerate();
    const session = new Session({
      id: 'test-btw-deny-tools',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc(events),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });
    const { agent: mainAgent } = await session.createAgent(
      { type: 'main', generate: scripted.generate },
      { profile: testProfile() },
    );
    mainAgent.config.update({
      modelAlias: 'mock-model',
      thinkingLevel: 'off',
    });
    mainAgent.tools.setActiveTools(['Read']);
    registerLookupNoteTool(mainAgent);
    mainAgent.context.appendUserMessage([{ type: 'text', text: 'Main task context.' }]);
    events.length = 0;

    scripted.mockNextResponse(lookupNoteCall());
    scripted.mockNextResponse({
      type: 'text',
      text: 'Main agent is implementing /btw based on the existing context.',
    });

    try {
      const api = new SessionAPIImpl(session);
      const agentId = await api.startBtw({ agentId: 'main' });
      expect(agentId).toBe('agent-0');
      await api.prompt({
        agentId,
        input: [{ type: 'text', text: 'What are you working on right now?' }],
      });

      await vi.waitFor(() => {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'turn.ended',
            agentId: 'agent-0',
            reason: 'completed',
          }),
        );
      });
      expect(events.filter((event) => String(event['type']).startsWith('subagent.'))).toEqual([]);
      expect(scripted.calls).toHaveLength(2);
      expect(scripted.calls[0]?.systemPrompt).toBe('<system-prompt>');
      expect(scripted.calls[1]?.systemPrompt).toBe('<system-prompt>');
      expect(scripted.calls[0]?.tools.map((tool) => tool.name)).toEqual([
        'LookupNote',
        'Read',
      ]);
      expect(scripted.calls[1]?.tools.map((tool) => tool.name)).toEqual([
        'LookupNote',
        'Read',
      ]);
      expect(JSON.stringify(scripted.calls[1]?.history)).toContain(
        'Tool calls are disabled for side questions. Answer with text only.',
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'tool.result',
          agentId: 'agent-0',
          toolCallId: 'call_lookup_note',
          isError: true,
          output: 'Tool calls are disabled for side questions. Answer with text only.',
        }),
      );
      expect(JSON.stringify(mainAgent.context.history)).not.toContain(
        'What are you working on right now?',
      );
    } finally {
      await session.close();
    }
  });

  it('cancels a btw turn through the returned agent id', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();

    const events: Array<Record<string, unknown>> = [];
    const generate: NonNullable<AgentOptions['generate']> = vi.fn(
      async (_chat, _systemPrompt, _tools, _history, _callbacks, options) => {
        const signal = options?.signal;
        if (signal === undefined) {
          throw new Error('Expected generate signal');
        }
        return new Promise<never>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              reject(signal.reason);
            },
            { once: true },
          );
        });
      },
    );
    const session = new Session({
      id: 'test-btw-cancel',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc(events),
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      providerManager: testProviderManager(),
    });
    const { agent: mainAgent } = await session.createAgent(
      { type: 'main', generate },
      { profile: testProfile() },
    );
    mainAgent.config.update({
      modelAlias: 'mock-model',
      thinkingLevel: 'off',
    });
    events.length = 0;

    try {
      const api = new SessionAPIImpl(session);
      const agentId = await api.startBtw({ agentId: 'main' });
      expect(agentId).toBe('agent-0');
      await api.prompt({
        agentId,
        input: [{ type: 'text', text: 'Where are things right now?' }],
      });

      await vi.waitFor(() => {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'turn.started',
            agentId: 'agent-0',
            origin: { kind: 'user' },
          }),
        );
      });

      await api.cancel({ agentId });

      await vi.waitFor(() => {
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'turn.ended',
            agentId: 'agent-0',
            reason: 'cancelled',
          }),
        );
      });
      expect(events.filter((event) => String(event['type']).startsWith('subagent.'))).toEqual([]);
    } finally {
      await session.close();
    }
  });

  it('reloadSkills picks up a skill written after the session opened', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const skillsRoot = join(workDir, 'skills');
    await mkdir(skillsRoot, { recursive: true });

    const session = new Session({
      id: 'test-reload-skills',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [skillsRoot] },
    });

    try {
      expect((await session.listSkills()).map((skill) => skill.name)).not.toContain('audit-routes');

      // What `/workflow save` does: write a skill into a root the open session
      // already scanned. The registry is built once, so it stays invisible
      // until something re-discovers it.
      await mkdir(join(skillsRoot, 'audit-routes'), { recursive: true });
      await writeFile(
        join(skillsRoot, 'audit-routes', 'SKILL.md'),
        ['---', 'name: audit-routes', 'description: Audit routes', '---', '', 'Body.'].join('\n'),
      );
      expect((await session.listSkills()).map((skill) => skill.name)).not.toContain('audit-routes');

      await session.reloadSkills();
      expect((await session.listSkills()).map((skill) => skill.name)).toContain('audit-routes');
    } finally {
      await session.close();
    }
  });

  it('reloadSkills re-renders the skill listing the model reads', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const skillsRoot = join(workDir, 'skills');
    await mkdir(skillsRoot, { recursive: true });

    const session = new Session({
      id: 'test-reload-skills-prompt',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [skillsRoot] },
      providerManager: testProviderManager(),
    });

    try {
      const { agent: main } = await session.createAgent(
        { type: 'main' },
        { profile: skillListingProfile() },
      );
      main.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
      expect(main.config.systemPrompt).not.toContain('audit-routes');
      const toolsBefore = main.tools.loopTools.map((tool) => tool.name);
      expect(toolsBefore).toEqual(['Read', 'Write']);
      expect(main.config.maxStepsPerTurn).toBe(7);

      await mkdir(join(skillsRoot, 'audit-routes'), { recursive: true });
      await writeFile(
        join(skillsRoot, 'audit-routes', 'SKILL.md'),
        ['---', 'name: audit-routes', 'description: Audit routes', '---', '', 'Body.'].join('\n'),
      );

      const setActiveTools = vi.spyOn(main.tools, 'setActiveTools');
      await session.reloadSkills();

      // Reloading the registry is not enough on its own: the listing is
      // rendered into the prompt, so without a re-render the model never
      // learns that the skill it was just told about exists.
      expect(main.config.systemPrompt).toContain('audit-routes');
      // Only the prompt. Re-applying the whole profile would reset the tools of
      // an agent that is already running, and its turn limit with them.
      expect(setActiveTools).not.toHaveBeenCalled();
      expect(main.tools.loopTools.map((tool) => tool.name)).toEqual(toolsBefore);
      expect(main.config.maxStepsPerTurn).toBe(7);
      expect(main.config.profileName).toBe('skill-listing');
    } finally {
      await session.close();
    }
  });

  it('a skill saved into an empty root is invocable after reloadSkills', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const skillsRoot = join(workDir, 'skills');
    await mkdir(skillsRoot, { recursive: true });

    const session = new Session({
      id: 'test-reload-skills-tool',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [skillsRoot] },
      providerManager: testProviderManager(),
    });

    try {
      const { agent: main } = await session.createAgent(
        { type: 'main' },
        { profile: skillListingProfile(['Skill', 'Read']) },
      );
      main.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });

      // The builtin set is built once, and it only carries the Skill tool when
      // a skill was already invocable. The user root is empty here, so what
      // keeps the tool present is `loadSkills` registering the builtin skills
      // before any agent is built — `createAgent` awaits that load. Were the
      // tool to go missing, a saved workflow would be listed and uncallable.
      expect(main.tools.loopTools.map((tool) => tool.name)).toContain('Skill');

      await mkdir(join(skillsRoot, 'audit-routes'), { recursive: true });
      await writeFile(
        join(skillsRoot, 'audit-routes', 'SKILL.md'),
        ['---', 'name: audit-routes', 'description: Audit routes', '---', '', 'Body.'].join('\n'),
      );

      const setActiveTools = vi.spyOn(main.tools, 'setActiveTools');
      await session.reloadSkills();

      // The tool reads the registry as it runs, so the reload is all it needs
      // to reach a skill written after the session opened.
      const skill = main.tools.loopTools.find((tool) => tool.name === 'Skill');
      expect(skill).toBeDefined();
      const result = await executeTool(skill!, {
        turnId: '0',
        toolCallId: 'call_skill',
        args: { skill: 'audit-routes' },
        signal: new AbortController().signal,
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.output)).toContain('audit-routes');
      expect(setActiveTools).not.toHaveBeenCalled();
    } finally {
      await session.close();
    }
  });

  it('discovers sub-skills and builtins', async () => {
    const workDir = await makeTempDir();
    const sessionDir = await makeTempDir();
    const skillsRoot = join(workDir, 'skills');
    await mkdir(join(skillsRoot, 'outer', 'inner'), { recursive: true });
    await writeFile(
      join(skillsRoot, 'outer', 'SKILL.md'),
      [
        '---',
        'name: outer',
        'description: Parent skill',
        'has-sub-skill: true',
        '---',
        '',
        'Outer body.',
      ].join('\n'),
    );
    await writeFile(
      join(skillsRoot, 'outer', 'inner', 'SKILL.md'),
      ['---', 'name: inner', 'description: Nested skill', '---', '', 'Inner body.'].join('\n'),
    );

    const disabledSession = new Session({
      id: 'test-disabled-sub-skills',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [skillsRoot] },
    });

    try {
      const disabledSkills = await disabledSession.listSkills();
      expect(disabledSkills.map((skill) => skill.name)).toContain('outer');
      expect(disabledSkills.map((skill) => skill.name)).toContain('outer.inner');
      expect(disabledSkills.map((skill) => skill.name)).toContain('sub-skill.consolidate');
    } finally {
      await disabledSession.close();
    }

    const enabledSession = new Session({
      id: 'test-enabled-sub-skills',
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc([]),
      skills: { explicitDirs: [skillsRoot] },
    });

    try {
      const enabledSkills = await enabledSession.listSkills();
      expect(enabledSkills.map((skill) => skill.name)).toContain('outer');
      expect(enabledSkills.map((skill) => skill.name)).toContain('outer.inner');
      expect(enabledSkills.map((skill) => skill.name)).toContain('sub-skill.consolidate');
    } finally {
      await enabledSession.close();
    }
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pythinker-core-init-'));
  tempDirs.push(dir);
  return dir;
}

function testProviderManager(): ProviderManager {
  return new ProviderManager({
    config: {
      providers: {
        test: {
          type: MOCK_PROVIDER.type,
          apiKey: MOCK_PROVIDER.apiKey,
        },
      },
      models: {
        [MOCK_PROVIDER.model]: {
          provider: 'test',
          model: MOCK_PROVIDER.model,
          maxContextSize: 1_000_000,
        },
      },
    },
  });
}

function testProfile(): ResolvedAgentProfile {
  return {
    name: 'test',
    systemPrompt: () => '<system-prompt>',
    tools: [],
  };
}

/** Renders the skill listing the way the real template's `PYTHINKER_SKILLS` does. */
function skillListingProfile(tools: string[] = ['Read', 'Write']): ResolvedAgentProfile {
  return {
    name: 'skill-listing',
    systemPrompt: (context) =>
      `<skills>${
        typeof context.skills === 'string'
          ? context.skills
          : (context.skills?.getModelSkillListing() ?? '')
      }</skills>`,
    tools,
    // Non-default, so a refresh that resets the turn limit is visible.
    maxTurns: 7,
  };
}

function createReadToolKaos(cwd: string, content: string): Kaos {
  return createFakeKaos({
    getcwd: () => cwd,
    stat: async () =>
      ({
        stMode: 0o100644,
        stIno: 1,
        stDev: 1,
        stNlink: 1,
        stUid: 0,
        stGid: 0,
        stSize: content.length,
        stAtime: 0,
        stMtime: 0,
        stCtime: 0,
      }) satisfies StatResult,
    readBytes: async () => Buffer.from(content),
    readLines: async function* () {
      yield content;
    },
  });
}

function registerLookupNoteTool(agent: Agent): void {
  agent.tools.registerUserTool({
    name: 'LookupNote',
    description: 'Look up a note from the host application.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  });
}

function lookupNoteCall(): ToolCall {
  return {
    type: 'function',
    id: 'call_lookup_note',
    name: 'LookupNote',
    arguments: JSON.stringify({ query: 'status' }),
  };
}

function createSessionRpc(events: Array<Record<string, unknown>>): SDKSessionRPC {
  return {
    emitEvent: vi.fn(async (event) => {
      events.push(event);
    }),
    requestApproval: vi.fn(async () => ({ decision: 'cancelled' })),
    requestQuestion: vi.fn(async () => null),
    toolCall: vi.fn(async () => ({
      output: 'custom tools are not supported in this test',
      isError: true,
    })),
  } as SDKSessionRPC;
}

/**
 * Wrap a {@link Kaos} so every `readText` (and `readLines`, which reads via
 * `readText` in the ACP bridge) rejects with `cause`. Used to simulate the
 * Zed ACP `fs/readTextFile` "Internal error" path that broke session bootstrap
 * before AGENTS.md loading was rerouted onto the persistence kaos.
 */
function wrapReadTextWithError(inner: Kaos, cause: Error): Kaos {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'readText') {
        return async () => {
          throw cause;
        };
      }
      if (prop === 'readLines') {
        return async function* () {
          yield* [];
          throw cause;
        };
      }
      if (prop === 'withCwd') {
        return (cwd: string) => wrapReadTextWithError(target.withCwd(cwd), cause);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
