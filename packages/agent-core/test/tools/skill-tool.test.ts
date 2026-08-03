import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import type { SkillActivationOrigin } from '../../src/agent/context';
import { SkillManager } from '../../src/agent/skill';
import type { SkillRegistry as AgentSkillRegistry } from '../../src/agent/skill';
import { HookEngine } from '../../src/session/hooks';
import { SessionSkillRegistry, type SkillDefinition } from '../../src/skill';
import {
  MAX_SKILL_QUERY_DEPTH,
  NestedSkillTooDeepError,
  SkillTool,
  SkillToolInputSchema,
} from '../../src/tools/builtin/collaboration/skill-tool';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function skill(
  name: string,
  metadata: SkillDefinition['metadata'] = {},
  content = `body of ${name}`,
): SkillDefinition {
  return {
    name,
    description: `desc for ${name}`,
    path: `/skills/${name}/SKILL.md`,
    dir: `/skills/${name}`,
    content,
    metadata,
    source: 'user',
  };
}

function registry(
  skills: readonly SkillDefinition[] = [],
  options: { readonly sessionId?: string } = {},
): AgentSkillRegistry {
  const registry = new SessionSkillRegistry(options);
  for (const item of skills) {
    registry.register(item);
  }
  return registry;
}

interface SkillToolMethods {
  readonly applySkillOverrides: (skill: SkillDefinition) => void;
  readonly recordSkillActivation: (origin: SkillActivationOrigin) => void;
  readonly registerSkillHooks: (skill: SkillDefinition) => void;
  readonly recordSystemReminder: (content: string, origin: SkillActivationOrigin) => void;
  readonly recordUserMessage: (
    content: readonly [{ readonly type: 'text'; readonly text: string }],
    origin: SkillActivationOrigin,
  ) => void;
}

function skillToolMethods() {
  return {
    applySkillOverrides: vi.fn<SkillToolMethods['applySkillOverrides']>(),
    recordSkillActivation: vi.fn<SkillToolMethods['recordSkillActivation']>(),
    registerSkillHooks: vi.fn<SkillToolMethods['registerSkillHooks']>(),
    recordSystemReminder: vi.fn<SkillToolMethods['recordSystemReminder']>(),
    recordUserMessage: vi.fn<SkillToolMethods['recordUserMessage']>(),
  } satisfies SkillToolMethods;
}

function skillToolAgent(skills: AgentSkillRegistry, methods: SkillToolMethods): Agent {
  return {
    skills: {
      registry: skills,
      applyInlineOverrides: methods.applySkillOverrides,
      recordActivation: methods.recordSkillActivation,
      registerHooks: methods.registerSkillHooks,
      renderPrompt: (
        skill: SkillDefinition,
        args: string,
      ) => Promise.resolve(skills.renderSkillPrompt(skill, args)),
    },
    context: {
      appendSystemReminder: methods.recordSystemReminder,
      appendUserMessage: methods.recordUserMessage,
    },
  } as unknown as Agent;
}

function skillTool(
  skills: AgentSkillRegistry,
  methods = skillToolMethods(),
  options?: ConstructorParameters<typeof SkillTool>[1],
): SkillTool {
  return new SkillTool(skillToolAgent(skills, methods), options);
}

function execute(tool: SkillTool, args: { skill: string; args?: string }) {
  return executeTool(tool, {
    turnId: '0',
    toolCallId: 'call_skill',
    args,
    signal,
  });
}

describe('SkillTool metadata and schema', () => {
  it('exposes the current tool contract', () => {
    const tool = skillTool(registry());

    expect(tool.name).toBe('Skill');
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { skill: { type: 'string' } },
    });
    expect(SkillToolInputSchema.safeParse({ skill: 'commit' }).success).toBe(true);
    expect(SkillToolInputSchema.safeParse({ skill: 'commit', args: '-m fix' }).success).toBe(true);
    expect(SkillToolInputSchema.safeParse({}).success).toBe(false);
    expect(MAX_SKILL_QUERY_DEPTH).toBe(3);
  });
});

describe('SkillTool execution', () => {
  it('returns a tool error when the skill is unknown', async () => {
    const tool = skillTool(registry());

    const result = await execute(tool, { skill: 'missing' });

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('not found');
  });

  it('rejects skills that disable model invocation', async () => {
    const tool = skillTool(registry([skill('secret', { disableModelInvocation: true })]));

    const result = await execute(tool, { skill: 'secret' });

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('can only be triggered by the user');
  });

  it('rejects non-inline skill types in the current v1 runtime', async () => {
    const methods = skillToolMethods();
    const tool = skillTool(registry([skill('review', { type: 'fork' })]), methods);

    const result = await execute(tool, { skill: 'review' });

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('not an inline skill');
    expect(methods.recordSkillActivation).not.toHaveBeenCalled();
  });

  it('runs context-fork skills through a foreground subagent for model and user activation', async () => {
    const spawn = vi.fn(async () => ({
      agentId: 'agent-1',
      profileName: 'explore',
      resumed: false,
      completion: Promise.resolve({ result: 'Forked review complete.' }),
    }));
    const skillRegistry = registry([
      skill('review', {
        context: 'fork',
        agent: 'explore',
        model: 'review-model',
        effort: 'medium',
        'allowed-tools': ['Read', 'Bash(git:*)'],
      }),
    ]);
    const emitEvent = vi.fn();
    const agent = {
      context: {},
      subagentHost: { spawn },
      emitEvent,
      telemetry: { track: vi.fn() },
    } as unknown as Agent;
    Object.assign(agent, { skills: new SkillManager(agent, skillRegistry) });
    const tool = new SkillTool(agent);

    const result = await execute(tool, { skill: 'review', args: 'current branch' });

    expect(result).toEqual({
      output:
        'Skill "review" completed (forked execution).\n\nResult:\nForked review complete.',
    });
    expect(spawn).toHaveBeenCalledWith({
      profileName: 'explore',
      parentToolCallId: 'call_skill',
      prompt: 'body of review\n\nARGUMENTS: current branch',
      description: 'Execute skill review',
      runInBackground: false,
      signal,
      modelAlias: 'review-model',
      thinkingLevel: 'medium',
      allowedTools: ['Read', 'Bash(git:*)'],
    });
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'skill.activated',
        skillName: 'review',
        trigger: 'model-tool',
      }),
    );

    const userResult = await agent.skills!.activate({
      name: 'review',
      args: 'user request',
    });

    expect(userResult).toEqual({
      execution: 'fork',
      result: 'Forked review complete.',
    });
    expect(spawn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parentToolCallId: expect.stringMatching(/^skill-/),
        prompt: 'body of review\n\nARGUMENTS: user request',
        runInBackground: false,
      }),
    );
    expect(emitEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'skill.activated',
        skillName: 'review',
        trigger: 'user-slash',
      }),
    );
  });

  it('reports context-fork skills as unavailable without a subagent host', async () => {
    const tool = skillTool(registry([skill('review', { context: 'fork' })]));

    const result = await execute(tool, { skill: 'review' });

    expect(result).toEqual({
      isError: true,
      output: 'Skill "review" requires subagent execution, which is not available.',
    });
  });

  it('records inline skill content as a loaded skill message', async () => {
    const methods = skillToolMethods();
    const tool = skillTool(registry([skill('commit')]), methods);

    const result = await execute(tool, { skill: 'commit', args: 'message text' });

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('loaded inline');
    expect(result.output).not.toContain('body of commit');
    expect(methods.applySkillOverrides).toHaveBeenCalledTimes(1);
    expect(methods.recordSkillActivation).toHaveBeenCalledTimes(1);
    expect(methods.registerSkillHooks).toHaveBeenCalledTimes(1);
    expect(methods.recordUserMessage).toHaveBeenCalledTimes(1);
    expect(methods.recordUserMessage.mock.calls[0]?.[0][0]?.text).toBe(
      'Skill tool loaded instructions for this request. Follow them.\n\n' +
        '<pythinker-skill-loaded name="commit" trigger="model-tool" source="user" dir="/skills/commit" args="message text">\nbody of commit\n\nARGUMENTS: message text\n</pythinker-skill-loaded>',
    );
    expect(methods.recordUserMessage.mock.calls[0]?.[0][0]?.text).not.toContain(
      '<system-reminder>',
    );
  });

  it('registers valid skill frontmatter hooks with the session hook engine', () => {
    const engine = new HookEngine();
    const item = skill('hooked', {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Write',
            hooks: [
              {
                type: 'command',
                command: 'echo checked',
                once: true,
              },
            ],
          },
        ],
      },
    });
    const agent = { hooks: engine } as unknown as Agent;
    const manager = new SkillManager(agent, registry([item]));

    manager.registerHooks(item);

    expect(engine.summary).toEqual({ PostToolUse: 1 });
  });

  it('scopes inline model, effort, and allowed-tool overrides to the active turn', async () => {
    let finishTurn!: () => void;
    const turnFinished = new Promise<void>((resolve) => {
      finishTurn = resolve;
    });
    const config = {
      modelAlias: 'base-model',
      thinkingLevel: 'low',
      update: vi.fn((changed: { modelAlias?: string; thinkingLevel?: string }) => {
        if (changed.modelAlias !== undefined) config.modelAlias = changed.modelAlias;
        if (changed.thinkingLevel !== undefined) config.thinkingLevel = changed.thinkingLevel;
      }),
    };
    const removeRules = vi.fn();
    const addTurnOverrideRules = vi.fn(() => removeRules);
    const agent = {
      config,
      permission: { addTurnOverrideRules },
      turn: {
        currentId: 4,
        hasActiveTurn: true,
        waitForCurrentTurn: () => turnFinished,
      },
    } as unknown as Agent;
    const item = skill('scoped', {
      model: 'review-model',
      effort: 'medium',
      'allowed-tools': 'Read, Bash(git:*)',
    });
    const manager = new SkillManager(agent, registry([item]));

    manager.applyInlineOverrides(item);

    expect(config.modelAlias).toBe('review-model');
    expect(config.thinkingLevel).toBe('medium');
    expect(addTurnOverrideRules).toHaveBeenCalledWith(['Read', 'Bash(git:*)']);

    finishTurn();
    await vi.waitFor(() => {
      expect(removeRules).toHaveBeenCalledTimes(1);
    });
    expect(config.modelAlias).toBe('base-model');
    expect(config.thinkingLevel).toBe('low');
  });

  it('keeps plugin instructions adjacent to model-invoked skill content', async () => {
    const methods = skillToolMethods();
    const tool = skillTool(
      registry([
        {
          ...skill('brainstorming', {}, 'brainstorm body'),
          source: 'extra',
          plugin: {
            id: 'superpowers',
            instructions: 'Use AskUserQuestion for clarifying questions.',
          },
        },
      ]),
      methods,
    );

    await execute(tool, { skill: 'brainstorming' });

    expect(methods.recordUserMessage.mock.calls[0]?.[0][0]?.text).toBe(
      'Skill tool loaded instructions for this request. Follow them.\n\n' +
        '<pythinker-skill-loaded name="brainstorming" trigger="model-tool" source="extra" dir="/skills/brainstorming" args="">\n' +
        '<pythinker-plugin-instructions plugin="superpowers">\n' +
        'Use AskUserQuestion for clarifying questions.\n' +
        '</pythinker-plugin-instructions>\n\nbrainstorm body\n' +
        '</pythinker-skill-loaded>',
    );
  });

  it('expands skill body placeholders for model-invoked inline skills', async () => {
    const methods = skillToolMethods();
    const tool = skillTool(
      registry([
        skill(
          'commit',
          { arguments: ['flag', 'message'] },
          'Flag: $flag\nCommit message: $message\nRaw: $ARGUMENTS',
        ),
      ]),
      methods,
    );

    await execute(tool, { skill: 'commit', args: '-m "fix login"' });

    expect(methods.recordUserMessage.mock.calls[0]?.[0][0]?.text).toBe(
      'Skill tool loaded instructions for this request. Follow them.\n\n' +
        '<pythinker-skill-loaded name="commit" trigger="model-tool" source="user" dir="/skills/commit" args="-m &quot;fix login&quot;">\nFlag: -m\nCommit message: fix login\nRaw: -m "fix login"\n</pythinker-skill-loaded>',
    );
    expect(methods.recordUserMessage.mock.calls[0]?.[0][0]?.text).not.toContain('ARGUMENTS:');
  });

  it('expands session id from the skill registry for model-invoked skills', async () => {
    const methods = skillToolMethods();
    const tool = skillTool(
      registry([skill('session-aware', {}, 'Session: ${PYTHINKER_SESSION_ID}')], {
        sessionId: 'ses_model_skill',
      }),
      methods,
    );

    await execute(tool, { skill: 'session-aware' });

    expect(methods.recordUserMessage.mock.calls[0]?.[0][0]?.text).toBe(
      'Skill tool loaded instructions for this request. Follow them.\n\n' +
        '<pythinker-skill-loaded name="session-aware" trigger="model-tool" source="user" dir="/skills/session-aware" args="">\nSession: ses_model_skill\n</pythinker-skill-loaded>',
    );
  });

  it('notifies inline skill activation without exposing the skill body', async () => {
    const methods = skillToolMethods();
    const tool = skillTool(registry([skill('commit')]), methods);

    await execute(tool, { skill: 'commit', args: 'message text' });

    expect(methods.recordSkillActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'skill_activation',
        activationId: expect.any(String),
        skillName: 'commit',
        skillArgs: 'message text',
        trigger: 'model-tool',
        skillPath: '/skills/commit/SKILL.md',
        skillSource: 'user',
      }),
    );
    expect(JSON.stringify(methods.recordSkillActivation.mock.calls[0]?.[0])).not.toContain(
      'body of commit',
    );
  });

  it('escapes skill name and args in the wrapper boundaries', async () => {
    const methods = skillToolMethods();
    const tool = skillTool(registry([skill('a&b')]), methods);

    await execute(tool, { skill: 'a&b', args: '<raw "value">' });

    expect(methods.recordUserMessage.mock.calls[0]?.[0][0]?.text).toBe(
      'Skill tool loaded instructions for this request. Follow them.\n\n' +
        '<pythinker-skill-loaded name="a&amp;b" trigger="model-tool" source="user" dir="/skills/a&amp;b" args="&lt;raw &quot;value&quot;&gt;">\nbody of a&b\n\nARGUMENTS: &lt;raw "value"&gt;\n</pythinker-skill-loaded>',
    );
    expect(methods.recordSkillActivation).toHaveBeenCalledTimes(1);
  });

  it('marks nested skill activations when invoked from inside another skill', async () => {
    const methods = skillToolMethods();
    const tool = skillTool(registry([skill('nested')]), methods, { queryDepth: 1 });

    await execute(tool, { skill: 'nested' });

    expect(methods.recordSkillActivation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'skill_activation',
        skillName: 'nested',
        trigger: 'nested-skill',
      }),
    );
    expect(methods.recordUserMessage.mock.calls[0]?.[0][0]?.text).toContain(
      'trigger="nested-skill"',
    );
  });
});

describe('SkillTool recursion guard', () => {
  it('throws NestedSkillTooDeepError when the depth cap has already been reached', async () => {
    const tool = skillTool(registry([skill('loop')]), skillToolMethods(), {
      queryDepth: MAX_SKILL_QUERY_DEPTH,
    });

    await expect(execute(tool, { skill: 'loop' })).rejects.toBeInstanceOf(NestedSkillTooDeepError);
  });

  it('withInitialQueryDepth returns a tool seeded with that depth', async () => {
    const tool = skillTool(registry([skill('loop')])).withInitialQueryDepth(MAX_SKILL_QUERY_DEPTH);

    await expect(execute(tool, { skill: 'loop' })).rejects.toBeInstanceOf(NestedSkillTooDeepError);
  });
});
