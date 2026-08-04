import { randomUUID } from 'node:crypto';

import type { ActivateSkillPayload, SkillActivationResult } from '#/rpc';
import { parseFrontmatterHooks } from '#/config/schema';
import type { ContentPart } from '@pythoughts/kosong';

import type { Agent } from '..';
import { ErrorCodes, PythinkerError } from '#/errors';
import type { ExecutableToolResult } from '#/loop';
import { isUserActivatableSkillType, type SkillDefinition } from '../../skill';
import type { SkillActivationOrigin } from '../context';
import { renderUserSlashSkillPrompt } from './prompt';
import type { SkillRegistry } from './types';

export type { SkillRegistry } from './types';

export interface ForkedSkillExecutionOptions {
  readonly parentToolCallId: string;
  readonly signal: AbortSignal;
  readonly trigger: SkillActivationOrigin['trigger'];
}

interface InlineSkillOverride {
  readonly turnId: number;
  readonly modelAlias: string | undefined;
  readonly thinkingLevel: string;
  readonly removeRules: Array<() => void>;
  watching: boolean;
  appliedModelAlias?: string;
  appliedThinkingLevel?: string;
}

export class SkillManager {
  private inlineOverride: InlineSkillOverride | undefined;

  constructor(
    protected readonly agent: Agent,
    public readonly registry: SkillRegistry,
  ) {}

  async activate(input: ActivateSkillPayload): Promise<SkillActivationResult> {
    const skill = this.registry.getSkill(input.name);
    if (skill === undefined) {
      throw new PythinkerError(ErrorCodes.SKILL_NOT_FOUND, `Skill "${input.name}" was not found`);
    }
    if (!isUserActivatableSkillType(skill.metadata.type)) {
      throw new PythinkerError(ErrorCodes.SKILL_TYPE_UNSUPPORTED, `Skill "${skill.name}" cannot be activated by the user`);
    }

    const skillArgs = input.args ?? '';
    if (skill.metadata.context === 'fork') {
      return {
        execution: 'fork',
        result: await this.executeForked(skill, skillArgs, {
          parentToolCallId: `skill-${randomUUID()}`,
          signal: new AbortController().signal,
          trigger: 'user-slash',
        }),
      };
    }
    const turnId = this.agent.turn.currentId + 1;
    this.applyInlineOverridesForTurn(skill, turnId);
    this.registerHooks(skill);
    const skillContent = await this.renderPrompt(
      skill,
      skillArgs,
      new AbortController().signal,
    );
    const wrapped = [
      {
        type: 'text' as const,
        text: renderUserSlashSkillPrompt({
          skillName: skill.name,
          skillArgs,
          skillContent,
          skillSource: skill.source,
          skillDir: skill.dir,
        }),
      },
    ];

    this.recordActivation(
      {
        kind: 'skill_activation',
        activationId: randomUUID(),
        skillName: skill.name,
        trigger: 'user-slash',
        skillType: skill.metadata.type,
        skillPath: skill.path,
        skillSource: skill.source,
        skillArgs: input.args,
      },
      wrapped,
    );
    this.watchInlineOverrides(turnId);
    return { execution: 'inline' };
  }

  activateMcpPrompt(
    input: ActivateSkillPayload,
    content: readonly ContentPart[],
    path: string,
  ): SkillActivationResult {
    this.recordActivation(
      {
        kind: 'skill_activation',
        activationId: randomUUID(),
        skillName: input.name,
        trigger: 'user-slash',
        skillType: 'prompt',
        skillPath: path,
        skillSource: 'extra',
        skillArgs: input.args,
      },
      content,
    );
    return { execution: 'inline' };
  }

  async executeForked(
    skill: SkillDefinition,
    skillArgs: string,
    options: ForkedSkillExecutionOptions,
  ): Promise<string> {
    if (this.agent.subagentHost === undefined) {
      throw new PythinkerError(
        ErrorCodes.SKILL_TYPE_UNSUPPORTED,
        `Skill "${skill.name}" requires subagent execution, which is not available.`,
      );
    }

    this.recordActivation({
      kind: 'skill_activation',
      activationId: randomUUID(),
      skillName: skill.name,
      skillArgs: skillArgs.length > 0 ? skillArgs : undefined,
      trigger: options.trigger,
      skillType: skill.metadata.type,
      skillPath: skill.path,
      skillSource: skill.source,
    });
    const agentName = metadataString(skill.metadata.agent);
    const prompt = await this.renderPrompt(skill, skillArgs, options.signal);
    const handle = await this.agent.subagentHost.spawn({
      profileName:
        agentName === undefined || agentName === 'general-purpose' ? 'coder' : agentName,
      parentToolCallId: options.parentToolCallId,
      prompt,
      description: `Execute skill ${skill.name}`,
      runInBackground: false,
      signal: options.signal,
      modelAlias: inheritedMetadataString(skill.metadata.model),
      thinkingLevel: metadataString(skill.metadata.effort),
      allowedTools: skillAllowedTools(skill.metadata),
    });
    return (await handle.completion).result;
  }

  async renderPrompt(
    skill: SkillDefinition,
    skillArgs: string,
    signal: AbortSignal,
  ): Promise<string> {
    const content = this.registry.renderSkillPrompt(skill, skillArgs);
    if (!content.includes('!`') && !content.includes('```!')) return content;
    return expandShellCommands(content, (command) =>
      this.executeShellCommand(skill, command, signal),
    );
  }

  registerHooks(skill: SkillDefinition): void {
    const hooks = parseFrontmatterHooks(skill.metadata.hooks) ?? [];
    if (hooks.length > 0) this.agent.hooks?.register(hooks);
  }

  applyInlineOverrides(skill: SkillDefinition): void {
    if (!this.agent.turn.hasActiveTurn) return;
    const turnId = this.agent.turn.currentId;
    this.applyInlineOverridesForTurn(skill, turnId);
    this.watchInlineOverrides(turnId);
  }

  recordActivation(
    origin: SkillActivationOrigin,
    input?: readonly ContentPart[] | undefined,
  ): void {
    const recordedOrigin = {
      ...origin,
      checkpointId: this.agent.fileCheckpointId,
    };
    this.agent.emitEvent({
      type: 'skill.activated',
      activationId: origin.activationId,
      skillName: origin.skillName,
      trigger: origin.trigger,
      checkpointId: recordedOrigin.checkpointId,
      skillArgs: origin.skillArgs,
      skillPath: origin.skillPath,
      skillSource: origin.skillSource,
    });
    this.agent.telemetry.track('skill_invoked', {
      skill_name: origin.skillName,
      trigger: origin.trigger,
    });
    if (origin.skillType === 'flow') {
      this.agent.telemetry.track('flow_invoked', {
        flow_name: origin.skillName,
      });
    }
    if (input !== undefined) {
      this.agent.turn.prompt(input, recordedOrigin);
    }
  }

  private applyInlineOverridesForTurn(skill: SkillDefinition, turnId: number): void {
    const requestedModel = inheritedMetadataString(skill.metadata.model);
    const requestedThinking = metadataString(skill.metadata.effort);
    const allowedTools = skillAllowedTools(skill.metadata);
    if (
      requestedModel === undefined &&
      requestedThinking === undefined &&
      allowedTools === undefined
    ) {
      return;
    }

    if (this.inlineOverride?.turnId !== turnId) {
      this.restoreInlineOverrides();
      this.inlineOverride = {
        turnId,
        modelAlias: this.agent.config.modelAlias,
        thinkingLevel: this.agent.config.thinkingLevel,
        removeRules: [],
        watching: false,
      };
    }
    const scoped = this.inlineOverride;
    if (allowedTools !== undefined) {
      scoped.removeRules.push(this.agent.permission.addTurnOverrideRules(allowedTools));
    }

    const modelAlias =
      requestedModel !== undefined && scoped.modelAlias !== undefined
        ? requestedModel
        : undefined;
    this.agent.config.update({
      modelAlias,
      thinkingLevel: requestedThinking,
    });
    if (modelAlias !== undefined) scoped.appliedModelAlias = modelAlias;
    if (requestedThinking !== undefined) scoped.appliedThinkingLevel = requestedThinking;
  }

  private watchInlineOverrides(turnId: number): void {
    const scoped = this.inlineOverride;
    if (scoped?.turnId !== turnId || scoped.watching) return;
    scoped.watching = true;
    void this.agent.turn.waitForCurrentTurn().finally(() => {
      if (this.inlineOverride?.turnId === turnId) this.restoreInlineOverrides();
    });
  }

  private restoreInlineOverrides(): void {
    const scoped = this.inlineOverride;
    if (scoped === undefined) return;
    this.inlineOverride = undefined;
    for (const removeRules of scoped.removeRules) removeRules();
    this.agent.config.update({
      modelAlias:
        scoped.appliedModelAlias !== undefined &&
        this.agent.config.modelAlias === scoped.appliedModelAlias
          ? scoped.modelAlias
          : undefined,
      thinkingLevel:
        scoped.appliedThinkingLevel !== undefined &&
        this.agent.config.thinkingLevel === scoped.appliedThinkingLevel
          ? scoped.thinkingLevel
          : undefined,
    });
  }

  private async executeShellCommand(
    skill: SkillDefinition,
    command: string,
    signal: AbortSignal,
  ): Promise<string> {
    const tool = this.agent.tools.getSkillShellTool(skill.metadata.shell);
    const args = { command };
    const execution = await tool.resolveExecution(args);
    if (execution.isError === true) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        `Shell context in skill "${skill.name}" failed: ${shellOutputText(execution)}`,
      );
    }

    const toolCallId = `skill-shell-${randomUUID()}`;
    const toolCall = {
      type: 'function' as const,
      id: toolCallId,
      name: tool.name,
      arguments: JSON.stringify(args),
    };
    const allowedTools = skillAllowedTools(skill.metadata);
    const removeRules =
      allowedTools === undefined
        ? undefined
        : this.agent.permission.addTurnOverrideRules(allowedTools);
    let result: ExecutableToolResult;
    try {
      const decision = await this.agent.permission.beforeToolCall({
        toolCall,
        toolCalls: [toolCall],
        tool,
        args,
        turnId: String(this.agent.turn.currentId + (this.agent.turn.hasActiveTurn ? 0 : 1)),
        stepNumber: 0,
        signal,
        execution,
      });
      if (decision?.block === true) {
        throw new PythinkerError(
          ErrorCodes.REQUEST_INVALID,
          `Shell context in skill "${skill.name}" was blocked: ${decision.reason ?? 'Permission denied'}`,
        );
      }
      result =
        decision?.syntheticResult ??
        (await execution.execute({
          turnId: String(this.agent.turn.currentId),
          toolCallId,
          metadata: decision?.executionMetadata,
          signal,
        }));
    } finally {
      removeRules?.();
    }
    if (result.isError === true) {
      throw new PythinkerError(
        ErrorCodes.REQUEST_INVALID,
        `Shell context in skill "${skill.name}" failed: ${shellOutputText(result)}`,
      );
    }
    return shellOutputText(result);
  }
}

function metadataString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function inheritedMetadataString(value: unknown): string | undefined {
  const normalized = metadataString(value);
  return normalized === 'inherit' ? undefined : normalized;
}

function skillAllowedTools(metadata: SkillDefinition['metadata']): readonly string[] | undefined {
  const value = metadata.allowedTools ?? metadata['allowed-tools'];
  const entries =
    typeof value === 'string'
      ? [value]
      : Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
  const tools = entries.flatMap(splitToolList);
  return tools.length > 0 ? tools : undefined;
}

function splitToolList(value: string): string[] {
  const tools: string[] = [];
  let current = '';
  let depth = 0;
  for (const character of value) {
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if ((character === ',' || /\s/u.test(character)) && depth === 0) {
      if (current.trim().length > 0) tools.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim().length > 0) tools.push(current.trim());
  return tools;
}

interface PromptShellMatch {
  readonly start: number;
  readonly end: number;
  readonly command: string;
}

const BLOCK_SHELL_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/gu;
const INLINE_SHELL_PATTERN = /(^|\s)!`([^`]+)`/gmu;

async function expandShellCommands(
  content: string,
  execute: (command: string) => Promise<string>,
): Promise<string> {
  const matches: PromptShellMatch[] = [];
  for (const match of content.matchAll(BLOCK_SHELL_PATTERN)) {
    const command = match[1]?.trim();
    if (command !== undefined && command.length > 0) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        command,
      });
    }
  }
  for (const match of content.matchAll(INLINE_SHELL_PATTERN)) {
    const command = match[2]?.trim();
    if (command === undefined || command.length === 0) continue;
    const prefixLength = match[1]?.length ?? 0;
    matches.push({
      start: match.index + prefixLength,
      end: match.index + match[0].length,
      command,
    });
  }
  matches.sort((left, right) => left.start - right.start);

  let cursor = 0;
  let result = '';
  for (const match of matches) {
    if (match.start < cursor) continue;
    result += content.slice(cursor, match.start);
    result += await execute(match.command);
    cursor = match.end;
  }
  return result + content.slice(cursor);
}

function shellOutputText(result: ExecutableToolResult): string {
  if (typeof result.output === 'string') return result.output.trim();
  return result.output
    .filter((part): part is Extract<ContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}
