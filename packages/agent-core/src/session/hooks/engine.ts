import { runHook, runHttpHook } from './runner';
import { matchPermissionRule } from '#/agent/permission/matches-rule';
import type {
  CommandHookDef,
  HookBlockDecision,
  HookDef,
  HookEngineOptions,
  HookEngineTriggerArgs,
  HookMatcherValue,
  HookResult,
} from './types';

const DEFAULT_HOOK_TIMEOUT_SECONDS = 30;

export function createHookIfMatcher(
  toolName: string,
  execution: { readonly matchesRule?: (ruleArgs: string) => boolean },
): (condition: string) => boolean {
  return (condition) =>
    matchPermissionRule({
      rule: {
        decision: 'allow',
        scope: 'session-runtime',
        pattern: condition,
      },
      toolName,
      execution,
    }) !== undefined;
}

export class HookEngine {
  private readonly byEvent = new Map<string, HookDef[]>();
  private readonly agentScopes = new WeakMap<HookDef, string>();
  private readonly claimedOnceHooks = new Set<HookDef>();
  private readonly pendingTriggers = new Set<Promise<HookResult[]>>();
  private nextStatusId = 0;
  private cwd: string;

  constructor(
    hooks: readonly HookDef[] = [],
    private readonly options: HookEngineOptions = {},
  ) {
    this.cwd = options.cwd ?? '';
    this.register(hooks);
  }

  register(
    hooks: readonly HookDef[],
    options: { readonly agentId?: string } = {},
  ): () => void {
    const registered = options.agentId === undefined ? [...hooks] : hooks.map((hook) => ({ ...hook }));
    for (const hook of registered) {
      const entries = this.byEvent.get(hook.event) ?? [];
      entries.push(hook);
      this.byEvent.set(hook.event, entries);
      if (options.agentId !== undefined) this.agentScopes.set(hook, options.agentId);
    }
    return () => {
      for (const hook of registered) {
        const remaining = (this.byEvent.get(hook.event) ?? []).filter((entry) => entry !== hook);
        if (remaining.length === 0) {
          this.byEvent.delete(hook.event);
        } else {
          this.byEvent.set(hook.event, remaining);
        }
        this.claimedOnceHooks.delete(hook);
        this.agentScopes.delete(hook);
      }
    };
  }

  async setCwd(cwd: string): Promise<void> {
    this.cwd = cwd;
    await this.options.onCwdChanged?.(cwd);
  }

  get summary(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [event, hooks] of this.byEvent.entries()) {
      result[event] = hooks.length;
    }
    return result;
  }

  trigger(event: string, args: HookEngineTriggerArgs = {}): Promise<HookResult[]> {
    try {
      return this.triggerInner(event, args).catch((): HookResult[] => []);
    } catch {
      return Promise.resolve([]);
    }
  }

  async triggerBlock(
    event: string,
    args: HookEngineTriggerArgs = {},
  ): Promise<HookBlockDecision | undefined> {
    return blockDecision(event, await this.trigger(event, args));
  }

  fireAndForgetTrigger(
    event: string,
    args: HookEngineTriggerArgs = {},
  ): Promise<HookResult[]> {
    let promise: Promise<HookResult[]>;
    try {
      promise = this.trigger(event, args).catch((): HookResult[] => []);
    } catch {
      promise = Promise.resolve([]);
    }
    this.pendingTriggers.add(promise);
    void promise.finally(() => {
      this.pendingTriggers.delete(promise);
    });
    return promise;
  }

  private async triggerInner(
    event: string,
    args: HookEngineTriggerArgs,
  ): Promise<HookResult[]> {
    const matcherValue = matcherValueText(args.matcherValue);
    const inputData = toHookInputData({
      hookEventName: event,
      sessionId: this.options.sessionId ?? '',
      cwd: this.cwd,
      ...args.inputData,
    });
    const agentId =
      typeof args.inputData?.['agentId'] === 'string'
        ? args.inputData['agentId']
        : typeof args.inputData?.['agent_id'] === 'string'
          ? args.inputData['agent_id']
          : undefined;
    const matched = this.matchingHooks(event, matcherValue, args.ifMatcher, agentId);
    if (matched.length === 0) return [];

    const background = matched.filter(
      (hook) => hook.async === true || (isCommandHook(hook) && hook.asyncRewake === true),
    );
    if (background.length > 0) {
      const promise = this.runMatchedHooks(
        event,
        matcherValue,
        inputData,
        background,
        args.signal,
      )
        .then(async (results) => {
          const rewakeResults = results.filter((result, index) => {
            const hook = background[index];
            return (
              hook !== undefined &&
              isCommandHook(hook) &&
              hook?.asyncRewake === true &&
              result.action === 'block' &&
              result.exitCode === 2
            );
          });
          if (rewakeResults.length > 0) {
            await this.emitAsyncRewake(event, rewakeResults);
          }
          return results;
        })
        .catch((): HookResult[] => []);
      this.pendingTriggers.add(promise);
      void promise.finally(() => {
        this.pendingTriggers.delete(promise);
      });
    }

    const foreground = matched.filter(
      (hook) => hook.async !== true && (!isCommandHook(hook) || hook.asyncRewake !== true),
    );
    if (foreground.length === 0) return [];
    return this.runMatchedHooks(event, matcherValue, inputData, foreground, args.signal);
  }

  private async runMatchedHooks(
    event: string,
    matcherValue: string,
    inputData: Record<string, unknown>,
    hooks: readonly HookDef[],
    signal?: AbortSignal,
  ): Promise<HookResult[]> {
    this.emitTriggered(event, matcherValue, hooks.length);
    const statusMessage = hooks.find((hook) => hook.statusMessage?.trim())?.statusMessage?.trim();
    const status =
      statusMessage === undefined
        ? undefined
        : { id: `hook-${String(++this.nextStatusId)}`, content: statusMessage };
    if (status !== undefined) {
      this.emitStatus(event, status.id, status.content, true, inputData['agent_id']);
    }
    const startedAt = Date.now();
    let results: HookResult[];
    try {
      results = await Promise.all(
        hooks.map((hook) => {
          if (isCommandHook(hook)) {
            return runHook(hook.command, inputData, {
              timeout: hook.timeout ?? DEFAULT_HOOK_TIMEOUT_SECONDS,
              cwd: this.cwd === '' ? undefined : this.cwd,
              signal,
              shell: hook.shell,
            });
          }
          if (hook.type === 'http') {
            return runHttpHook(hook, inputData, {
              timeout: hook.timeout ?? DEFAULT_HOOK_TIMEOUT_SECONDS,
              cwd: this.cwd === '' ? undefined : this.cwd,
              signal,
              allowedUrls: this.options.allowedHttpHookUrls,
              allowedEnvVars: this.options.httpHookAllowedEnvVars,
              fetchImpl: this.options.fetchImpl,
            });
          }
          return (
            this.options.runModelHook?.(hook, event, inputData, signal) ??
            Promise.resolve({
              action: 'allow' as const,
              stderr: `No ${hook.type} hook runner is configured.`,
            })
          );
        }),
      );
    } finally {
      if (status !== undefined) {
        this.emitStatus(event, status.id, status.content, false, inputData['agent_id']);
      }
      this.removeOnceHooks(event, hooks);
    }
    const watchPaths = results.flatMap((result) => result.watchPaths ?? []);
    if (watchPaths.length > 0) {
      await this.options.onWatchPaths?.(event, watchPaths);
    }
    const { action, reason } = aggregateResults(event, results);
    this.emitResolved(event, matcherValue, action, reason, Date.now() - startedAt);
    return results;
  }

  private matchingHooks(
    event: string,
    matcherValue: string,
    ifMatcher: ((condition: string) => boolean) | undefined,
    agentId: string | undefined,
  ): HookDef[] {
    const seenHooks = new Set<string>();
    const matched: HookDef[] = [];

    for (const hook of this.byEvent.get(event) ?? []) {
      const agentScope = this.agentScopes.get(hook);
      if (agentScope !== undefined && agentScope !== agentId) continue;
      if (
        event !== 'TaskCreated' &&
        event !== 'TaskCompleted' &&
        event !== 'CwdChanged' &&
        event !== 'FileChanged' &&
        !matches(hook.matcher ?? '', matcherValue)
      ) {
        continue;
      }
      if (hook.if !== undefined && ifMatcher?.(hook.if) !== true) continue;
      const identity = isCommandHook(hook)
        ? `command:${hook.shell ?? 'bash'}:${hook.command}:${hook.if ?? ''}`
        : hook.type === 'http'
          ? `http:${hook.url}:${hook.if ?? ''}`
          : `${hook.type}:${hook.prompt}:${hook.if ?? ''}`;
      if (seenHooks.has(identity)) continue;
      if (hook.once === true && this.claimedOnceHooks.has(hook)) continue;
      seenHooks.add(identity);
      if (hook.once === true) this.claimedOnceHooks.add(hook);
      matched.push(hook);
    }

    return matched;
  }

  private removeOnceHooks(event: string, matched: readonly HookDef[]): void {
    const onceHooks = new Set(matched.filter((hook) => hook.once === true));
    if (onceHooks.size === 0) return;
    const remaining = (this.byEvent.get(event) ?? []).filter((hook) => !onceHooks.has(hook));
    if (remaining.length === 0) {
      this.byEvent.delete(event);
    } else {
      this.byEvent.set(event, remaining);
    }
  }

  private emitTriggered(event: string, target: string, count: number): void {
    try {
      this.options.onTriggered?.(event, target, count);
    } catch {}
  }

  private emitResolved(
    event: string,
    target: string,
    action: string,
    reason: string | undefined,
    durationMs: number,
  ): void {
    try {
      this.options.onResolved?.(event, target, action, reason, durationMs);
    } catch {}
  }

  private async emitAsyncRewake(event: string, results: readonly HookResult[]): Promise<void> {
    try {
      await this.options.onAsyncRewake?.(event, results);
    } catch {}
  }

  private emitStatus(
    event: string,
    statusId: string,
    content: string,
    active: boolean,
    agentId: unknown,
  ): void {
    try {
      this.options.onStatus?.(
        event,
        statusId,
        content,
        active,
        typeof agentId === 'string' ? agentId : undefined,
      );
    } catch {}
  }
}

function isCommandHook(hook: HookDef): hook is CommandHookDef {
  return hook.type === undefined || hook.type === 'command';
}

function matches(pattern: string, value: string): boolean {
  if (pattern.length === 0) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function matcherValueText(value: HookMatcherValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return value
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

function aggregateResults(
  event: string,
  results: readonly HookResult[],
): {
  readonly action: 'allow' | 'block';
  readonly reason?: string;
} {
  const block = blockDecision(event, results);
  if (block !== undefined) {
    return { action: 'block', reason: block.reason };
  }
  return { action: 'allow' };
}

function blockDecision(
  event: string,
  results: readonly HookResult[],
): HookBlockDecision | undefined {
  const block = results.find((result) => result.action === 'block');
  if (block === undefined) return undefined;
  const reason = block.reason?.trim();
  return {
    block: true,
    reason: reason === undefined || reason.length === 0 ? `Blocked by ${event} hook` : reason,
  };
}

function toHookInputData(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    result[camelToSnake(key)] = value;
  }
  return result;
}

function camelToSnake(value: string): string {
  return value.replaceAll(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}
