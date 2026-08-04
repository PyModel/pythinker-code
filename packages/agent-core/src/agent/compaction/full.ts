import {
  ErrorCodes,
  PythinkerError,
  isPythinkerError,
  toPythinkerErrorPayload,
} from '#/errors';
import {
  APIEmptyResponseError,
  isRetryableGenerateError,
  type GenerateResult,
  type TokenUsage,
  APIContextOverflowError,
  createUserMessage,
} from '@pythoughts/kosong';

import type { Agent } from '..';
import type { ContextMessage } from '../context';
import { isAbortError } from '../../loop/errors';
import {
  retryBackoffDelays,
  sleepForRetry,
} from '../../loop/retry';
import { renderPrompt } from '../../utils/render-prompt';
import {
  estimateTokens,
  estimateTokensForMessages,
} from '../../utils/tokens';
import {
  applyCompletionBudget,
  resolveCompletionBudget,
} from '../../utils/completion-budget';
import compactionInstructionTemplate from './compaction-instruction.md?raw';
import { renderTodoList, type TodoItem } from '../../tools/builtin/state/todo-list';
import type {
  CompactionBeginData,
  CompactionResult,
  PartialCompactionSelection,
} from './types';
import {
  DEFAULT_COMPACTION_CONFIG,
  DefaultCompactionStrategy,
  type CompactionStrategy,
} from './strategy';

export const MAX_COMPACTION_RETRY_ATTEMPTS = 5;

/**
 * Default hard cap on compaction output tokens when `maxOutputSize` is not
 * configured on the model alias. Without this, compaction falls back to the
 * full context window size, which exceeds the `max_tokens` ceiling enforced
 * by many OpenAI-compatible providers. 128k matches the chat-completions
 * ceiling applied by the OpenAI Legacy provider.
 */
const DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS = 128 * 1024;

class CompactionTruncatedError extends Error {
  constructor() {
    super('Compaction response was truncated before producing a complete summary.');
    this.name = 'CompactionTruncatedError';
  }
}

export class FullCompaction {
  protected compactionCountInTurn = 0;
  protected compacting: {
    abortController: AbortController;
    promise: Promise<void>;
    blockedByTurn: boolean;
  } | null = null;
  protected readonly strategy: CompactionStrategy;

  constructor(
    protected readonly agent: Agent,
    strategy?: CompactionStrategy,
    private readonly onAfterCompaction?: () => Promise<void>,
  ) {
    this.strategy =
      strategy ??
      new DefaultCompactionStrategy(
        () => agent.config.modelCapabilities.max_context_tokens,
        {
          ...DEFAULT_COMPACTION_CONFIG,
          reservedContextSize:
            agent.pythinkerConfig?.loopControl?.reservedContextSize ??
            DEFAULT_COMPACTION_CONFIG.reservedContextSize,
        }
      );
  }

  get isCompacting(): boolean {
    return this.compacting !== null;
  }

  begin(data: Readonly<CompactionBeginData>): void {
    if (this.compacting) return;
    if (data.source === 'manual') {
      this.compactionCountInTurn = 0;
    } else {
      this.compactionCountInTurn += 1;
    }
    if (this.compactionCountInTurn > this.strategy.maxCompactionPerTurn) return;
    if (this.agent.records.restoring) {
      this.agent.replayBuilder.push({
        type: 'compaction',
        instruction: data.instruction,
      });
      return;
    }
    const range = resolveCompactionRange(
      this.agent.context.history,
      data.selection,
      () => this.strategy.computeCompactCount(this.agent.context.history, data.source),
    );
    if (range.compactedCount === 0) {
      throw new PythinkerError(
        ErrorCodes.COMPACTION_UNABLE,
        data.selection === undefined
          ? 'No prefix that can be compacted in current history.'
          : 'The selected prompt has no messages to compact in that direction.',
      );
    }
    this.agent.records.logRecord({
      type: 'full_compaction.begin',
      ...data,
    });
    this.agent.emitEvent({
      type: 'compaction.started',
      trigger: data.source,
      instruction: data.instruction,
    });
    const abortController = new AbortController();
    this.compacting = {
      abortController,
      promise: this.compactionWorker(
        abortController.signal,
        data,
        range.startIndex,
        range.compactedCount,
      ),
      blockedByTurn: false,
    };
  }

  cancel(): void {
    this.agent.replayBuilder.patchLast('compaction', {
      result: 'cancelled',
    });
    if (!this.compacting) return;
    this.agent.records.logRecord({
      type: 'full_compaction.cancel',
    });
    this.compacting.abortController.abort();
    this.compacting = null;
    this.agent.emitEvent({ type: 'compaction.cancelled' });
  }

  markCompleted() {
    this.agent.records.logRecord({
      type: 'full_compaction.complete',
    });
    this.compacting = null;
  }

  private get tokenCountWithPending(): number {
    return this.agent.context.tokenCountWithPending;
  }

  resetForTurn(): void {
    this.compactionCountInTurn = 0;
  }

  async handleOverflowError(signal: AbortSignal, error: unknown) {
    const didStartCompaction = this.beginAutoCompaction();
    if (!didStartCompaction && !this.compacting) throw error;
    // Always block on overflow errors
    await this.block(signal);
  }

  async beforeStep(signal: AbortSignal): Promise<void> {
    this.checkAutoCompaction();
    if (this.strategy.shouldBlock(this.tokenCountWithPending)) {
      await this.block(signal);
    }
  }

  async afterStep(): Promise<void> {
    if (this.strategy.checkAfterStep) {
      this.checkAutoCompaction(false);
    }
    // Do not block after the step
  }

  private checkAutoCompaction(throwOnLimit: boolean = true): boolean {
    if (this.compacting) return true;
    if (!this.strategy.shouldCompact(this.tokenCountWithPending)) return false;
    return this.beginAutoCompaction(throwOnLimit);
  }

  private beginAutoCompaction(throwOnLimit: boolean = true): boolean {
    if (this.compacting) return true;
    const maxCompactions = this.strategy.maxCompactionPerTurn;
    if (this.compactionCountInTurn >= maxCompactions) {
      if (throwOnLimit) {
        throw new PythinkerError(ErrorCodes.CONTEXT_OVERFLOW, `Compaction limit exceeded (${String(maxCompactions)})`, {
          details: { maxCompactions },
        });
      }
      return false;
    }
    this.begin({ source: 'auto', instruction: undefined });
    return this.compacting !== null;
  }

  private async block(signal: AbortSignal): Promise<void> {
    const active = this.compacting;
    if (active) {
      active.blockedByTurn = true;
      signal.addEventListener('abort', () => {
        if (this.compacting === active) {
          this.cancel();
        }
      });
      this.agent.emitEvent({
        type: 'compaction.blocked',
        turnId: this.agent.turn.currentId,
      });
      await active.promise;
    }
  }

  private async compactionWorker(
    signal: AbortSignal,
    data: Readonly<CompactionBeginData>,
    startIndex: number,
    compactedCount: number,
  ): Promise<void> {
    try {
      const finalResult: CompactionResult = {
        summary: '',
        startIndex: startIndex === 0 ? undefined : startIndex,
        compactedCount: 1,
        tokensBefore: 0,
        tokensAfter: 0,
      };

      for (let round = 1; ; round++) {
        const result = await this.compactionRound(
          round,
          signal,
          data,
          startIndex,
          compactedCount,
        );
        if (!result) return;

        finalResult.summary = result.summary;
        finalResult.startIndex = result.startIndex;
        finalResult.compactedCount += result.compactedCount - 1;
        finalResult.tokensBefore += result.tokensBefore - finalResult.tokensAfter;
        finalResult.tokensAfter = result.tokensAfter;

        if (data.selection !== undefined) break;
        if (result.tokensBefore - result.tokensAfter < 1024) break;
        if (!this.strategy.shouldBlock(result.tokensAfter)) break;
        startIndex = 0;
        compactedCount = this.strategy.computeCompactCount(this.agent.context.history, data.source);
        if (compactedCount === 0) break;
      }
      this.agent.turn.resetLoadedNestedInstructions();
      try {
        await this.onAfterCompaction?.();
      } catch (error) {
        this.agent.log.warn('post-compaction refresh failed', { error });
      }
      this.markCompleted();
      this.agent.emitEvent({ type: 'compaction.completed', result: finalResult });
      await this.agent.injection.injectGoal();
      await this.triggerPostCompactHooks(data, finalResult);
    } catch (error) {
      if (isAbortError(error)) return;
      const blockedByTurn = this.compacting?.blockedByTurn === true;
      this.cancel();
      this.agent.log.error('compaction failed', { error });
      if (blockedByTurn) {
        throw error;
      }
      this.agent.emitEvent({
        type: 'error',
        ...toPythinkerErrorPayload(error),
      });
    }
  }

  private async compactionRound(
    round: number,
    signal: AbortSignal,
    data: Readonly<CompactionBeginData>,
    startIndex: number,
    initialCompactedCount: number,
  ) {
    const startedAt = Date.now();
    const originalHistory = [...this.agent.context.history];
    const tokensBefore = estimateTokensForMessages(originalHistory);
    let retryCount = 0;
    try {
      let compactedCount = initialCompactedCount;

      await this.triggerPreCompactHook(data, tokensBefore, signal);

      const model = this.agent.config.model;
      const capability = this.agent.config.modelCapabilities;
      const maxContextTokens = capability.max_context_tokens;
      // When the model's context window is known and the user has not set
      // `maxOutputSize`, cap compaction output to a safe default so a large
      // context window does not push `max_tokens` past the provider's ceiling.
      // When the window is unknown (maxContextTokens === 0), leave
      // `maxOutputSize` unset so `resolveCompletionBudget` falls back to the
      // conservative unknown-context fallback.
      const defaultCompactionCap =
        maxContextTokens > 0
          ? Math.min(maxContextTokens, DEFAULT_COMPACTION_MAX_COMPLETION_TOKENS)
          : undefined;
      const provider = applyCompletionBudget({
        provider: this.agent.config.provider,
        budget: resolveCompletionBudget({
          maxOutputSize: this.agent.config.maxOutputSize ?? defaultCompactionCap,
          reservedContextSize: this.agent.pythinkerConfig?.loopControl?.reservedContextSize,
        }),
        capability,
        // The compaction request replays (a projection of) the existing
        // history, so it is by definition near the top of the window —
        // size max_tokens to what actually remains.
        usedContextTokens: tokensBefore,
      });

      const delays = retryBackoffDelays(MAX_COMPACTION_RETRY_ATTEMPTS);
      let usage: TokenUsage | null;
      let summary: string;
      while (true) {
        const messagesToCompact = originalHistory.slice(
          startIndex,
          startIndex + compactedCount,
        );
        const messages = [
          ...this.agent.context.project(messagesToCompact),
          createUserMessage(renderPrompt(compactionInstructionTemplate, { customInstruction: data.instruction ?? '' })),
        ];
        try {
          const response = await this.agent.generate(
            provider,
            this.agent.config.systemPrompt,
            [...this.agent.tools.loopTools],
            messages,
            undefined,
            { signal },
          );
          if (response.finishReason === 'truncated') {
            throw new CompactionTruncatedError();
          }
          usage = response.usage;
          summary = extractCompactionSummary(response);
          break;
        } catch (error) {
          if (
            error instanceof APIContextOverflowError ||
            error instanceof CompactionTruncatedError ||
            error instanceof APIEmptyResponseError // e.g. think-only
          ) {
            compactedCount = this.strategy.reduceCompactOnOverflow(messagesToCompact);
          }
          else if (!isRetryableGenerateError(error)) {
            throw error;
          }
          if (retryCount + 1 >= MAX_COMPACTION_RETRY_ATTEMPTS) {
            throw error;
          }
          await sleepForRetry(delays[retryCount]!, signal);
          retryCount += 1;
        }
      }

      if (usage !== null) {
        this.agent.usage.record(model, usage);
      }

      const newHistory = this.agent.context.history;
      for (let i = 0; i < originalHistory.length; i++) {
        if (newHistory[i] !== originalHistory[i]) {
          // History changed during compaction, likely due to undo
          this.cancel();
          return undefined;
        }
      }

      summary = this.postProcessSummary(summary);

      const kept = [
        ...originalHistory.slice(0, startIndex),
        ...originalHistory.slice(startIndex + compactedCount),
      ];
      const tokensAfter = estimateTokens(summary) + estimateTokensForMessages(kept);

      const result: CompactionResult = {
        summary,
        startIndex: startIndex === 0 ? undefined : startIndex,
        compactedCount,
        tokensBefore,
        tokensAfter,
      };

      this.agent.telemetry.track('compaction_finished', {
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        duration: Date.now() - startedAt,
        compactedCount: result.compactedCount,
        retryCount,
        round,
        ...usage,
        source: data.source,
        instruction: data.instruction,
        partialDirection: data.selection?.direction,
        partialPromptFromEnd: data.selection?.promptFromEnd,
      });
      this.agent.context.applyCompaction(result);
      return result;
    } catch (error) {
      if (isAbortError(error)) return;
      this.agent.telemetry.track('compaction_failed', {
        source: data.source,
        instruction: data.instruction,
        partialDirection: data.selection?.direction,
        partialPromptFromEnd: data.selection?.promptFromEnd,
        tokensBefore,
        duration: Date.now() - startedAt,
        round,
        retryCount,
        errorType: error instanceof Error ? error.name : 'Unknown',
      });
      if (isPythinkerError(error) && error.code === ErrorCodes.AUTH_LOGIN_REQUIRED) throw error;
      throw new PythinkerError(ErrorCodes.COMPACTION_FAILED, String(error), { cause: error });
    }
  }

  private async triggerPreCompactHook(
    data: Readonly<CompactionBeginData>,
    tokenCount: number,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await this.agent.hooks?.trigger('PreCompact', {
      matcherValue: data.source,
      signal,
      inputData: {
        agentId: this.agent.agentId,
        trigger: data.source,
        tokenCount,
      },
    });
    signal.throwIfAborted();
  }

  private async triggerPostCompactHooks(
    data: Readonly<CompactionBeginData>,
    result: CompactionResult,
  ): Promise<void> {
    await this.agent.hooks?.trigger('SessionStart', {
      matcherValue: 'compact',
      inputData: {
        agentId: this.agent.agentId,
        source: 'compact',
        model: this.agent.config.modelAlias,
      },
    });
    void this.agent.hooks?.fireAndForgetTrigger('PostCompact', {
      matcherValue: data.source,
      inputData: {
        agentId: this.agent.agentId,
        trigger: data.source,
        estimatedTokenCount: result.tokensAfter,
      },
    });
  }

  private postProcessSummary(summary: string): string {
    const storeData = this.agent.tools.storeData();
    const todos = (storeData['todo'] as readonly TodoItem[] | undefined) ?? [];
    if (todos.length === 0) {
      return summary;
    }
    const todoMarkdown = renderTodoList(todos, '## TODO List');
    return `${summary.trim()}\n\n${todoMarkdown}`;
  }
}

function resolveCompactionRange(
  history: readonly ContextMessage[],
  selection: PartialCompactionSelection | undefined,
  defaultCompactedCount: () => number,
): { readonly startIndex: number; readonly compactedCount: number } {
  if (selection === undefined) {
    return { startIndex: 0, compactedCount: defaultCompactedCount() };
  }
  if (!Number.isSafeInteger(selection.promptFromEnd) || selection.promptFromEnd <= 0) {
    throw new PythinkerError(
      ErrorCodes.REQUEST_INVALID,
      'promptFromEnd must be a positive integer.',
    );
  }

  let remaining = selection.promptFromEnd;
  let promptIndex = -1;
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (message === undefined || !isSelectableUserPrompt(message)) continue;
    remaining--;
    if (remaining === 0) {
      promptIndex = index;
      break;
    }
  }
  if (promptIndex < 0) {
    throw new PythinkerError(
      ErrorCodes.REQUEST_INVALID,
      'Selected prompt is outside the active context.',
    );
  }

  return selection.direction === 'up_to'
    ? { startIndex: 0, compactedCount: promptIndex }
    : { startIndex: promptIndex, compactedCount: history.length - promptIndex };
}

function isSelectableUserPrompt(
  message: ContextMessage,
): boolean {
  if (message.role !== 'user') return false;
  const origin = message.origin;
  if (origin === undefined || origin.kind === 'user') return true;
  return origin.kind === 'skill_activation' && origin.trigger === 'user-slash';
}

function extractCompactionSummary(response: GenerateResult): string {
  const summary =
    typeof response.message.content === 'string'
      ? response.message.content
      : response.message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');

  if (summary.trim().length === 0) {
    throw new APIEmptyResponseError(
      'The compaction response did not contain a non-empty summary.',
    );
  }
  return summary;
}
