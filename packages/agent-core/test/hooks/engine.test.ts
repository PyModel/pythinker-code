import { describe, expect, it, vi } from 'vitest';
import type { ContentPart } from '@pythoughts/kosong';

// Dynamic-import contract: locks the public shape of the future HookEngine
// without forcing TS module resolution to find a file that doesn't exist yet.
const ENGINE_MODULE = '../../src/session/hooks/engine' as string;

type CommandHookDef = {
  event: string;
  matcher?: string;
  if?: string;
  statusMessage?: string;
  type?: 'command';
  command: string;
  timeout?: number;
  once?: boolean;
  async?: boolean;
  asyncRewake?: boolean;
};

type HttpHookDef = {
  event: string;
  matcher?: string;
  if?: string;
  statusMessage?: string;
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
  timeout?: number;
  once?: boolean;
  async?: boolean;
};

type ModelHookDef = {
  event: string;
  matcher?: string;
  if?: string;
  statusMessage?: string;
  type: 'prompt' | 'agent';
  prompt: string;
  timeout?: number;
  once?: boolean;
  model?: string;
};

type HookDef = CommandHookDef | HttpHookDef | ModelHookDef;

interface HookResult {
  action: 'allow' | 'block';
  message?: string;
  reason?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
}

interface HookBlockDecision {
  block: true;
  reason?: string;
}

type HookMatcherValue = string | readonly ContentPart[];

interface HookEngineCtor {
  new (
    hooks: HookDef[],
    options?: {
      cwd?: string;
      sessionId?: string;
      onTriggered?: (event: string, target: string, count: number) => void;
      onResolved?: (
        event: string,
        target: string,
        action: string,
        reason: string | undefined,
        durationMs: number,
      ) => void;
      allowedHttpHookUrls?: readonly string[];
      httpHookAllowedEnvVars?: readonly string[];
      fetchImpl?: typeof fetch;
      onAsyncRewake?: (event: string, results: readonly HookResult[]) => void | Promise<void>;
      onStatus?: (
        event: string,
        statusId: string,
        content: string,
        active: boolean,
        agentId?: string,
      ) => void;
      runModelHook?: (
        hook: ModelHookDef,
        event: string,
        input: Record<string, unknown>,
        signal?: AbortSignal,
      ) => Promise<HookResult>;
    },
  ): {
    register: (
      hooks: HookDef[],
      options?: { readonly agentId?: string },
    ) => () => void;
    trigger: (
      event: string,
      args?: {
        matcherValue?: HookMatcherValue;
        inputData?: Record<string, unknown>;
        signal?: AbortSignal;
        ifMatcher?: (condition: string) => boolean;
      },
    ) => Promise<HookResult[]>;
    triggerBlock: (
      event: string,
      args?: {
        matcherValue?: HookMatcherValue;
        inputData?: Record<string, unknown>;
        signal?: AbortSignal;
        ifMatcher?: (condition: string) => boolean;
      },
    ) => Promise<HookBlockDecision | undefined>;
    fireAndForgetTrigger: (
      event: string,
      args?: {
        matcherValue?: HookMatcherValue;
        inputData?: Record<string, unknown>;
        signal?: AbortSignal;
        ifMatcher?: (condition: string) => boolean;
      },
    ) => Promise<HookResult[]>;
    summary: Record<string, number>;
  };
}

interface EngineModule {
  HookEngine: HookEngineCtor;
  createHookIfMatcher: (
    toolName: string,
    execution: { matchesRule?: (ruleArgs: string) => boolean },
  ) => (condition: string) => boolean;
}

async function importEngine(): Promise<EngineModule> {
  return (await import(ENGINE_MODULE)) as EngineModule;
}

describe('HookEngine', () => {
  it('fires a PreToolUse hook whose matcher regex matches the matcher value', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'PreToolUse', matcher: 'Shell|WriteFile', command: 'exit 0', timeout: 5 },
      { event: 'PreToolUse', matcher: 'ReadFile', command: 'exit 2', timeout: 5 },
      { event: 'Stop', matcher: '', command: 'echo done', timeout: 5 },
    ]);
    const results = await engine.trigger('PreToolUse', {
      matcherValue: 'Shell',
      inputData: { toolName: 'Shell' },
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe('allow');
  });

  it('returns no results when no hook matcher matches the matcher value', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'PreToolUse', matcher: 'Shell|WriteFile', command: 'exit 0', timeout: 5 },
      { event: 'PreToolUse', matcher: 'ReadFile', command: 'exit 2', timeout: 5 },
    ]);
    const results = await engine.trigger('PreToolUse', {
      matcherValue: 'Grep',
      inputData: {},
    });
    expect(results).toHaveLength(0);
  });

  it('maps exit code 2 to a block action', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'PreToolUse', matcher: 'ReadFile', command: 'exit 2', timeout: 5 },
    ]);
    const results = await engine.trigger('PreToolUse', {
      matcherValue: 'ReadFile',
      inputData: {},
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe('block');
  });

  it('exposes a triggerBlock helper for block decisions', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      {
        event: 'PreToolUse',
        matcher: 'ReadFile',
        command: "echo 'blocked' >&2; exit 2",
        timeout: 5,
      },
    ]);

    await expect(
      engine.triggerBlock('PreToolUse', {
        matcherValue: 'ReadFile',
        inputData: {},
      }),
    ).resolves.toEqual({ block: true, reason: 'blocked' });
  });

  it('fills a default triggerBlock reason when the hook result has none', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'PreToolUse', matcher: 'ReadFile', command: 'exit 2', timeout: 5 },
    ]);

    await expect(
      engine.triggerBlock('PreToolUse', {
        matcherValue: 'ReadFile',
        inputData: {},
      }),
    ).resolves.toEqual({ block: true, reason: 'Blocked by PreToolUse hook' });
  });

  it('aborts a running hook when the trigger signal aborts', async () => {
    const { HookEngine } = await importEngine();
    const abortController = new AbortController();
    const engine = new HookEngine([
      {
        event: 'PreToolUse',
        matcher: 'Shell',
        command: 'node -e "setTimeout(() => {}, 10000)"',
        timeout: 5,
      },
    ]);
    const startedAt = Date.now();
    setTimeout(() => {
      abortController.abort();
    }, 50);

    const results = await engine.trigger('PreToolUse', {
      matcherValue: 'Shell',
      inputData: {},
      signal: abortController.signal,
    });

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe('allow');
    expect(results[0]?.timedOut).toBeUndefined();
  });

  it('serializes camelCase inputData as snake_case for hook stdin', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      {
        event: 'PreToolUse',
        matcher: 'Shell',
        command:
          'node -e "let s=\\"\\";process.stdin.on(\\"data\\",d=>s+=d);process.stdin.on(\\"end\\",()=>{const o=JSON.parse(s);process.stdout.write(o.tool_name+\\" \\"+o.tool_call_id);})"',
        timeout: 5,
      },
    ]);

    const results = await engine.trigger('PreToolUse', {
      matcherValue: 'Shell',
      inputData: { toolName: 'Shell', toolCallId: 'call_1' },
    });

    expect(results[0]?.stdout?.trim()).toBe('Shell call_1');
  });

  it('adds sessionId, cwd, and hookEventName from engine context', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine(
      [
        {
          event: 'SessionStart',
          command:
            'node -e "let s=\\"\\";process.stdin.on(\\"data\\",d=>s+=d);process.stdin.on(\\"end\\",()=>{const o=JSON.parse(s);process.stdout.write(o.hook_event_name+\\" \\"+o.session_id+\\" \\"+o.cwd);})"',
          timeout: 5,
        },
      ],
      {
        sessionId: 'ses_123',
        cwd: '/tmp',
      },
    );

    const results = await engine.trigger('SessionStart');

    expect(results[0]?.stdout?.trim()).toBe('SessionStart ses_123 /tmp');
  });

  it('treats an empty matcher string as a catch-all for any matcher value', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'Stop', matcher: '', command: 'echo done', timeout: 5 },
    ]);
    const results = await engine.trigger('Stop', {
      matcherValue: 'anything',
      inputData: {},
    });
    expect(results).toHaveLength(1);
  });

  it('matches ContentPart matcher values against their text content', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'UserPromptSubmit', matcher: 'hello world', command: 'exit 0', timeout: 5 },
    ]);
    const results = await engine.trigger('UserPromptSubmit', {
      matcherValue: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', imageUrl: { url: 'file:///tmp/a.png' } },
        { type: 'text', text: 'world' },
      ],
      inputData: {},
    });
    expect(results).toHaveLength(1);
  });

  it('returns no results for events that have no registered hooks', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'PreToolUse', matcher: 'Shell', command: 'exit 0', timeout: 5 },
    ]);
    const results = await engine.trigger('UserPromptSubmit', {
      matcherValue: '',
      inputData: {},
    });
    expect(results).toHaveLength(0);
  });

  it('scopes dynamically registered hooks to one agent and removes them on cleanup', async () => {
    const { HookEngine } = await importEngine();
    const runModelHook = vi.fn(async () => ({ action: 'allow' as const }));
    const engine = new HookEngine([], { runModelHook });
    const unregister = engine.register(
      [{ event: 'Stop', type: 'prompt', prompt: 'Check the child result' }],
      { agentId: 'agent-1' },
    );

    await expect(
      engine.trigger('Stop', { inputData: { agentId: 'main' } }),
    ).resolves.toEqual([]);
    await expect(
      engine.trigger('Stop', { inputData: { agentId: 'agent-1' } }),
    ).resolves.toHaveLength(1);

    unregister();
    await expect(
      engine.trigger('Stop', { inputData: { agentId: 'agent-1' } }),
    ).resolves.toEqual([]);
    expect(runModelHook).toHaveBeenCalledOnce();
  });

  it('dedupes hooks with identical command strings so they only fire once', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'Stop', command: 'echo once', timeout: 5 },
      { event: 'Stop', command: 'echo once', timeout: 5 },
    ]);
    const results = await engine.trigger('Stop', { inputData: {} });
    expect(results).toHaveLength(1);
  });

  it('removes a once hook after its first matching execution', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'Notification', command: 'echo once', once: true },
    ]);

    await expect(engine.trigger('Notification')).resolves.toHaveLength(1);
    await expect(engine.trigger('Notification')).resolves.toEqual([]);
    expect(engine.summary).toEqual({});
  });

  it('starts an async hook without delaying the trigger result', async () => {
    const { HookEngine } = await importEngine();
    let resolveResponse!: (response: Response) => void;
    const onAsyncRewake = vi.fn();
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const engine = new HookEngine(
      [
        {
          event: 'Notification',
          type: 'http',
          url: 'https://93.184.216.34/hooks/async',
          async: true,
          once: true,
        },
      ],
      { fetchImpl, onAsyncRewake },
    );

    await expect(engine.trigger('Notification')).resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledOnce();

    resolveResponse(new Response('{}'));
    await vi.waitFor(() => {
      expect(engine.summary).toEqual({});
    });
    expect(onAsyncRewake).not.toHaveBeenCalled();
  });

  it('reports exit-code-2 asyncRewake results without delaying the trigger', async () => {
    const { HookEngine } = await importEngine();
    const onAsyncRewake = vi.fn();
    const engine = new HookEngine(
      [
        {
          event: 'Notification',
          command: `node -e "process.stderr.write('fix required'); process.exit(2)"`,
          asyncRewake: true,
        },
      ],
      { onAsyncRewake },
    );

    await expect(engine.trigger('Notification')).resolves.toEqual([]);
    await vi.waitFor(() => {
      expect(onAsyncRewake).toHaveBeenCalledWith(
        'Notification',
        expect.arrayContaining([
          expect.objectContaining({
            action: 'block',
            message: 'fix required',
            exitCode: 2,
          }),
        ]),
      );
    });
  });

  it('delegates prompt and agent hooks to the configured model runner', async () => {
    const { HookEngine } = await importEngine();
    const runModelHook = vi
      .fn()
      .mockResolvedValueOnce({ action: 'allow', message: 'prompt passed' })
      .mockResolvedValueOnce({ action: 'block', reason: 'verification failed' });
    const engine = new HookEngine(
      [
        { event: 'Stop', type: 'prompt', prompt: 'Check $ARGUMENTS' },
        { event: 'Notification', type: 'agent', prompt: 'Verify $ARGUMENTS' },
      ],
      { runModelHook },
    );

    await expect(engine.trigger('Stop', { inputData: { done: true } })).resolves.toEqual([
      expect.objectContaining({ action: 'allow', message: 'prompt passed' }),
    ]);
    await expect(
      engine.triggerBlock('Notification', { inputData: { task: 'tests' } }),
    ).resolves.toEqual({ block: true, reason: 'verification failed' });
    expect(runModelHook).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'prompt', prompt: 'Check $ARGUMENTS' }),
      'Stop',
      expect.objectContaining({ done: true }),
      undefined,
    );
    expect(runModelHook).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'agent', prompt: 'Verify $ARGUMENTS' }),
      'Notification',
      expect.objectContaining({ task: 'tests' }),
      undefined,
    );
  });

  it('reports a configured status message only while hooks are running', async () => {
    const { HookEngine } = await importEngine();
    let resolveHook!: (result: HookResult) => void;
    const onStatus = vi.fn();
    const engine = new HookEngine(
      [
        {
          event: 'Stop',
          type: 'prompt',
          prompt: 'Check the result',
          statusMessage: 'Checking the result',
        },
      ],
      {
        onStatus,
        runModelHook: () =>
          new Promise<HookResult>((resolve) => {
            resolveHook = resolve;
          }),
      },
    );

    const trigger = engine.trigger('Stop', { inputData: { agentId: 'reviewer' } });
    expect(onStatus).toHaveBeenCalledWith(
      'Stop',
      expect.any(String),
      'Checking the result',
      true,
      'reviewer',
    );

    resolveHook({ action: 'allow' });
    await expect(trigger).resolves.toEqual([{ action: 'allow' }]);
    expect(onStatus).toHaveBeenLastCalledWith(
      'Stop',
      expect.any(String),
      'Checking the result',
      false,
      'reviewer',
    );
    expect(onStatus.mock.calls[0]?.[1]).toBe(onStatus.mock.calls[1]?.[1]);
  });

  it('runs hooks with distinct if conditions only when the tool permission rule matches', async () => {
    const { HookEngine } = await importEngine();
    const runModelHook = vi.fn(async () => ({ action: 'allow' as const }));
    const engine = new HookEngine(
      [
        { event: 'PreToolUse', type: 'prompt', prompt: 'Check command', if: 'Bash(git *)' },
        { event: 'PreToolUse', type: 'prompt', prompt: 'Check command', if: 'Bash(rm *)' },
      ],
      { runModelHook },
    );

    await engine.trigger('PreToolUse', {
      matcherValue: 'Bash',
      ifMatcher: (condition) => condition === 'Bash(git *)',
    });

    expect(runModelHook).toHaveBeenCalledOnce();
    expect(runModelHook).toHaveBeenCalledWith(
      expect.objectContaining({ if: 'Bash(git *)' }),
      'PreToolUse',
      expect.any(Object),
      undefined,
    );
  });

  it('uses the existing permission-rule matcher for hook if conditions', async () => {
    const { createHookIfMatcher } = await importEngine();
    const matcher = createHookIfMatcher('Bash', {
      matchesRule: (ruleArgs) => ruleArgs === 'git *',
    });

    expect(matcher('Bash(git *)')).toBe(true);
    expect(matcher('Bash(rm *)')).toBe(false);
    expect(matcher('Read')).toBe(false);
  });

  it('skips an if-conditioned hook when the event has no tool matcher', async () => {
    const { HookEngine } = await importEngine();
    const runModelHook = vi.fn(async () => ({ action: 'allow' as const }));
    const engine = new HookEngine(
      [{ event: 'Stop', type: 'prompt', prompt: 'Check command', if: 'Bash(git *)' }],
      { runModelHook },
    );

    await expect(engine.trigger('Stop')).resolves.toEqual([]);
    expect(runModelHook).not.toHaveBeenCalled();
  });

  it('silently skips hooks whose matcher is not a valid regex', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'PreToolUse', matcher: '[invalid', command: 'exit 0', timeout: 5 },
    ]);
    const results = await engine.trigger('PreToolUse', {
      matcherValue: 'Shell',
      inputData: {},
    });
    expect(results).toHaveLength(0);
  });

  it('fails open when trigger input preparation throws', async () => {
    const { HookEngine } = await importEngine();
    const inputData = {};
    Object.defineProperty(inputData, 'broken', {
      enumerable: true,
      get() {
        throw new Error('broken input');
      },
    });
    const engine = new HookEngine([{ event: 'PreToolUse', command: 'echo should-not-run' }]);

    await expect(
      engine.trigger('PreToolUse', {
        matcherValue: 'Bash',
        inputData,
      }),
    ).resolves.toEqual([]);
    await expect(
      engine.triggerBlock('PreToolUse', {
        matcherValue: 'Bash',
        inputData,
      }),
    ).resolves.toBeUndefined();
  });

  it('fails open when fireAndForgetTrigger sees a synchronous trigger error', async () => {
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([]);
    vi.spyOn(engine, 'trigger').mockImplementation(() => {
        throw new Error('trigger failed');
    });

    await expect(engine.fireAndForgetTrigger('Notification')).resolves.toEqual([]);
  });

  it('preserves a PreToolUse block result even when telemetry throws (no fail-open)', async () => {
    // Safety-critical: a telemetry failure MUST NOT silently bypass a block.
    const telemetry = await import('../../src/utils/telemetry' as string).catch(() => null);
    const { HookEngine } = await importEngine();
    const engine = new HookEngine([
      { event: 'PreToolUse', matcher: 'ReadFile', command: 'exit 2', timeout: 5 },
    ]);

    const spy =
      telemetry && typeof (telemetry as { track?: unknown }).track === 'function'
        ? vi
            .spyOn(telemetry as { track: (...args: unknown[]) => unknown }, 'track')
            .mockImplementation(() => {
              throw new Error('telemetry broken');
            })
        : null;

    try {
      const results = await engine.trigger('PreToolUse', {
        matcherValue: 'ReadFile',
        inputData: {},
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.action).toBe('block');
    } finally {
      spy?.mockRestore();
    }
  });

  it('posts hook input to an HTTP hook and applies its structured block response', async () => {
    const { HookEngine } = await importEngine();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          session_id: 'ses_123',
          cwd: '/work',
          tool_name: 'Shell',
        }),
      );
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token');
      return new Response(
        JSON.stringify({
          hookSpecificOutput: {
            permissionDecision: 'deny',
            permissionDecisionReason: 'blocked by HTTP hook',
          },
        }),
      );
    });
    vi.stubEnv('HOOK_TOKEN', 'secret-token');
    const engine = new HookEngine(
      [
        {
          event: 'PreToolUse',
          matcher: 'Shell',
          type: 'http',
          url: 'https://93.184.216.34/hooks/pre-tool',
          headers: { Authorization: 'Bearer $HOOK_TOKEN' },
          allowedEnvVars: ['HOOK_TOKEN'],
          timeout: 5,
        },
      ],
      {
        cwd: '/work',
        sessionId: 'ses_123',
        allowedHttpHookUrls: ['https://93.184.216.34/hooks/*'],
        httpHookAllowedEnvVars: ['HOOK_TOKEN'],
        fetchImpl,
      },
    );

    await expect(
      engine.triggerBlock('PreToolUse', {
        matcherValue: 'Shell',
        inputData: { toolName: 'Shell' },
      }),
    ).resolves.toEqual({ block: true, reason: 'blocked by HTTP hook' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('blocks HTTP hooks outside the configured URL allowlist before network I/O', async () => {
    const { HookEngine } = await importEngine();
    const fetchImpl = vi.fn<typeof fetch>();
    const engine = new HookEngine(
      [
        {
          event: 'Notification',
          type: 'http',
          url: 'https://93.184.216.34/hooks/notify',
        },
      ],
      {
        allowedHttpHookUrls: [],
        fetchImpl,
      },
    );

    const results = await engine.trigger('Notification');

    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe('allow');
    expect(results[0]?.stderr).toContain('does not match allowed_http_hook_urls');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects private HTTP hook targets even when the URL policy allows them', async () => {
    const { HookEngine } = await importEngine();
    const fetchImpl = vi.fn<typeof fetch>();
    const engine = new HookEngine(
      [
        {
          event: 'Notification',
          type: 'http',
          url: 'http://169.254.169.254/latest/meta-data',
        },
      ],
      {
        allowedHttpHookUrls: ['http://169.254.169.254/*'],
        fetchImpl,
      },
    );

    const results = await engine.trigger('Notification');

    expect(results).toHaveLength(1);
    expect(results[0]?.action).toBe('allow');
    expect(results[0]?.stderr).toContain('private address');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
