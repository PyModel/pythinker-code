import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_PROFILES, loadAgentProfilesFromSources } from '../../src/profile';

const promptContext = {
  osEnv: {
    osKind: 'macOS',
    osArch: 'arm64',
    osVersion: '0',
    shellName: 'bash',
    shellPath: '/bin/bash',
  },
  cwd: '/workspace',
  now: '2026-05-09T00:00:00.000Z',
  cwdListing: 'LISTING_SNAPSHOT',
  agentsMd: 'AGENTS_MD_BODY',
  gitContext: '<git-context>\nBranch: feature/test\nDirty files (1):\n  M src/a.ts\n</git-context>',
  skills: '- test-skill: does things\n  Path: /skills/test/SKILL.md',
} as const;

describe('default agent profiles', () => {
  it('loads the bundled default system prompt from embedded sources', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext);

    expect(prompt).toContain('You are Pythinker Code CLI');
    expect(prompt).toContain('Available skills');
    expect(prompt).toContain('/workspace');
  });

  it('keeps static instructions before dynamic prompt context', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext) ?? '';

    expect(prompt.indexOf('Use this as your basic understanding of the project structure.')).toBeLessThan(
      prompt.indexOf('LISTING_SNAPSHOT'),
    );
    expect(prompt.indexOf('User instructions given directly in the conversation')).toBeLessThan(
      prompt.indexOf('AGENTS_MD_BODY'),
    );
    expect(prompt.indexOf('Only read skill details when needed')).toBeLessThan(
      prompt.indexOf('- test-skill: does things'),
    );
  });

  it('includes the startup Git snapshot in the main system prompt', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']!.systemPrompt(promptContext);

    expect(prompt).toContain('Git Repository Snapshot');
    expect(prompt).toContain('<git-context>\nBranch: feature/test');
    expect(prompt.indexOf('Git Repository Snapshot')).toBeLessThan(
      prompt.indexOf('<git-context>'),
    );
  });

  it('defaults reasoning and replies to English', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext) ?? '';

    expect(prompt).toContain('Use English for reasoning');
    expect(prompt).toContain('Only use another language when the user explicitly asks');
    expect(prompt).not.toMatch(/same language as the user/iu);
  });

  it('allows authorized security work while rejecting destructive abuse', () => {
    const prompt = DEFAULT_AGENT_PROFILES['agent']?.systemPrompt(promptContext) ?? '';

    expect(prompt).toContain('authorized security testing');
    expect(prompt).toContain('Refuse requests for destructive techniques');
  });

  it('lists the goal tools on the agent profile but not on subagent profiles', () => {
    const agentTools = DEFAULT_AGENT_PROFILES['agent']?.tools ?? [];
    expect(agentTools).toEqual(expect.arrayContaining(['CreateGoal', 'GetGoal']));
    for (const name of ['coder', 'explore', 'plan']) {
      const tools = DEFAULT_AGENT_PROFILES[name]?.tools ?? [];
      expect(tools).not.toContain('CreateGoal');
      expect(tools).not.toContain('GetGoal');
    }
  });

  it('provides a read-only verification subagent with an evidence verdict contract', () => {
    const verification = DEFAULT_AGENT_PROFILES['agent']?.subagents?.['verification'];

    expect(verification).toBe(DEFAULT_AGENT_PROFILES['verification']);
    expect(verification).toMatchObject({
      background: true,
      tools: expect.arrayContaining(['Bash', 'Read', 'Grep', 'Skill']),
    });
    expect(verification?.tools).not.toEqual(
      expect.arrayContaining(['Write', 'Edit', 'NotebookEdit', 'Agent']),
    );
    const prompt = verification?.systemPrompt(promptContext) ?? '';
    expect(prompt).toContain('verification specialist');
    expect(prompt).toContain('Do not modify the project');
    expect(prompt).toContain('project verifier skills');
    expect(prompt).toContain('VERDICT: PASS');
    expect(prompt).toContain('VERDICT: FAIL');
    expect(prompt).toContain('VERDICT: PARTIAL');
  });

  it('provides a coordinator main profile with the default worker catalog', () => {
    const coordinator = DEFAULT_AGENT_PROFILES['coordinator'];
    const prompt = coordinator?.systemPrompt(promptContext) ?? '';

    expect(coordinator?.tools).toEqual(DEFAULT_AGENT_PROFILES['agent']?.tools);
    expect(coordinator?.subagents).toEqual(DEFAULT_AGENT_PROFILES['agent']?.subagents);
    expect(prompt).toContain('coordinator');
    expect(prompt).toContain('Delegate independent, non-trivial work');
    expect(prompt).toContain('Synthesize worker results');
  });

  it('exposes MCP resource tools wherever dynamic MCP tools are enabled', () => {
    const expected = expect.arrayContaining([
      'ListMcpResourcesTool',
      'ReadMcpResourceTool',
      'mcp__*',
    ]);
    expect(DEFAULT_AGENT_PROFILES['agent']?.tools).toEqual(expected);
    expect(DEFAULT_AGENT_PROFILES['coder']?.tools).toEqual(expected);
  });

  it('fails loudly when an embedded system prompt source is missing', () => {
    expect(() =>
      loadAgentProfilesFromSources(['profile/default/agent.yaml'], {
        'profile/default/agent.yaml': 'name: agent\nsystemPromptPath: ./missing.md\n',
      }),
    ).toThrow(/Embedded agent profile source missing: profile\/default\/missing\.md/);
  });
});
