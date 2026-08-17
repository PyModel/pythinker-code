import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_AGENT_PROFILES, type SystemPromptContext } from '../../src/profile';
import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import type { ToolServices } from '../../src/tools/support/services';
import { testAgent } from '../agent/harness/agent';
import { testKaos } from '../fixtures/test-kaos';

const GENERAL_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'WebSearch',
  'FetchURL',
  'TodoList',
  'Skill',
  'Agent',
  'AskUserQuestion',
  'Config',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
  'mcp__*',
];

const GENERAL_ACTIVE_TOOLS = [
  'AskUserQuestion',
  'FetchURL',
  'Glob',
  'Grep',
  'Read',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TodoList',
  'WebSearch',
];

const GENERAL_TOOL_SERVICES: ToolServices = {
  webSearcher: { search: async () => [] },
  urlFetcher: { fetch: async () => ({ content: '', kind: 'passthrough' }) },
};

const PROMPT_CONTEXT: SystemPromptContext = {
  osEnv: {
    osKind: 'Linux',
    osArch: 'x86_64',
    osVersion: 'test',
    shellName: 'bash',
    shellPath: '/bin/bash',
  },
  cwd: '/workspace',
  skills: '- test-skill',
  roleAdditional: 'Additional general role instruction.',
};

describe('general mode', () => {
  it('registers the general profile with its research and MCP tools', () => {
    const profile = DEFAULT_AGENT_PROFILES['general'];

    expect(profile).toBeDefined();
    expect(profile!.tools).toEqual(expect.arrayContaining(['Read', 'WebSearch', 'FetchURL', 'mcp__*']));
    // A memory-enabled general profile would regain Write and Edit through Agent.useProfile().
    expect(profile!.memory).toBeUndefined();
  });

  it('has exactly the non-coding tool list', () => {
    const profile = DEFAULT_AGENT_PROFILES['general'];

    expect(profile!.tools).toEqual(GENERAL_TOOLS);
    expect(profile!.tools).not.toEqual(
      expect.arrayContaining(['Bash', 'PowerShell', 'Write', 'Edit', 'NotebookEdit']),
    );
  });

  it('uses a general prompt instead of bundled coding instructions', () => {
    const general = DEFAULT_AGENT_PROFILES['general'];
    const agent = DEFAULT_AGENT_PROFILES['agent'];
    const codingMarker = '# General Guidelines for Coding';

    expect(agent!.systemPrompt(PROMPT_CONTEXT)).toContain(codingMarker);
    expect(general!.systemPrompt(PROMPT_CONTEXT)).not.toContain(codingMarker);
    expect(general!.systemPrompt(PROMPT_CONTEXT)).toContain('Additional general role instruction.');
    expect(general!.systemPrompt(PROMPT_CONTEXT)).toContain('- test-skill');
  });

  it('activates only the general profile tools without agent memory', () => {
    const ctx = testAgent({ runtime: GENERAL_TOOL_SERVICES });
    ctx.configure();

    ctx.agent.useProfile(DEFAULT_AGENT_PROFILES['general']!, { cwdListing: '', agentsMd: '' });
    expect(
      ctx.agent.tools
        .data()
        .filter((tool) => tool.active)
        .map((tool) => tool.name)
        .toSorted(),
    ).toEqual(GENERAL_ACTIVE_TOOLS);
  });

  it('selects general mode from session metadata and defaults to the agent profile', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'pythinker-general-mode-'));
    const workDir = join(tmp, 'work');
    const sessions: Session[] = [];

    try {
      await mkdir(workDir, { recursive: true });
      const rpc: SDKSessionRPC = {
        emitEvent: vi.fn(),
        requestApproval: vi.fn(async () => ({ decision: 'rejected' as const })),
        requestQuestion: vi.fn(async () => null),
        toolCall: vi.fn(async () => ({ output: '' })),
      } as SDKSessionRPC;
      const general = new Session({
        id: 'ses_general_mode',
        kaos: testKaos.withCwd(workDir),
        homedir: join(tmp, 'general'),
        mode: 'general',
        rpc,
        skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      });
      sessions.push(general);
      const code = new Session({
        id: 'ses_code_mode',
        kaos: testKaos.withCwd(workDir),
        homedir: join(tmp, 'code'),
        rpc,
        skills: { explicitDirs: [join(workDir, 'missing-skills')] },
      });
      sessions.push(code);

      expect((await general.createMain()).config.profileName).toBe('general');
      await general.flushMetadata();
      expect(
        JSON.parse(await readFile(join(tmp, 'general', 'state.json'), 'utf8'))['custom']['mode'],
      ).toBe('general');
      expect((await code.createMain()).config.profileName).toBe('agent');

    } finally {
      await Promise.all(sessions.map((session) => session.close().catch(() => {})));
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
