import type { createPythinkerDeviceId as createPythinkerDeviceIdFn } from '@pymodel/pythinker-code-oauth';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPrompt } from '#/cli/run-prompt';

type CreatePythinkerDeviceId = typeof createPythinkerDeviceIdFn;

const mocks = vi.hoisted(() => {
  const eventHandlers = new Set<(event: any) => void>();
  const agentEvent = (agentId: string, event: Record<string, unknown>) => ({
    sessionId: 'ses_prompt',
    agentId,
    ...event,
  });
  const mainEvent = (event: Record<string, unknown>) => agentEvent('main', event);
  const session = {
    id: 'ses_prompt',
    setModel: vi.fn(),
    setPermission: vi.fn(),
    setApprovalHandler: vi.fn(),
    setQuestionHandler: vi.fn(),
    addWorkspaceDirectory: vi.fn(async (path: string) => ({ path, source: 'session' as const })),
    restoreFileCheckpoint: vi.fn(async () => ({
      checkpointId: 'checkpoint-1',
      recoveryCheckpointId: 'recovery-1',
      restoredPaths: ['/workspace/a.ts'],
      deletedPaths: ['/workspace/new.ts'],
    })),
    getStatus: vi.fn(
      async (): Promise<{ readonly permission: string; readonly model?: string }> => ({
        permission: 'manual',
      }),
    ),
    onEvent: vi.fn((handler: (event: any) => void) => {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    }),
    prompt: vi.fn(async () => {
      for (const handler of eventHandlers) {
        handler(
          mainEvent({ type: 'turn.started', turnId: 1, origin: { kind: 'user' } }),
        );
        handler(mainEvent({ type: 'assistant.delta', turnId: 1, delta: 'hello' }));
        handler(mainEvent({ type: 'assistant.delta', turnId: 1, delta: ' world' }));
        handler(mainEvent({ type: 'turn.ended', turnId: 1, reason: 'completed' }));
      }
    }),
  };

  return {
    session,
    eventHandlers,
    agentEvent,
    mainEvent,
    pythinkerHarnessConstructor: vi.fn(),
    harnessEnsureConfigFile: vi.fn(),
    harnessGetConfig: vi.fn(
      async (): Promise<{ providers: {}; defaultModel?: string; telemetry: boolean }> => ({
        providers: {},
        defaultModel: 'k2',
        telemetry: true,
      }),
    ),
    harnessGetConfigDiagnostics: vi.fn(async () => ({ warnings: [] as readonly string[] })),
    harnessGetExperimentalFeatures: vi.fn(async () => []),
    harnessCreateSession: vi.fn(async () => session),
    harnessResumeSession: vi.fn(async () => session),
    harnessListSessions: vi.fn(async () => [{ id: 'ses_previous', workDir: process.cwd() }]),
    harnessClose: vi.fn(),
    harnessTrack: vi.fn(),
    harnessGetCachedAccessToken: vi.fn(),
    initializeTelemetry: vi.fn(),
    setCrashPhase: vi.fn(),
    shutdownTelemetry: vi.fn(),
    telemetryTrack: vi.fn(),
    setTelemetryContext: vi.fn(),
    lifecycleTrack: vi.fn(),
    withTelemetryContext: vi.fn(() => ({ track: vi.fn() })),
    createPythinkerDeviceId: vi.fn<CreatePythinkerDeviceId>(() => 'device-1'),
    resolvePythinkerHome: vi.fn((homeDir?: string) => homeDir ?? '/tmp/pythinker-code-test-home'),
    harnessCreatesDeviceIdOnConstruction: false,
  };
});

vi.mock('@pymodel/pythinker-code-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pymodel/pythinker-code-sdk')>();
  return {
    ...actual,
    resolvePythinkerHome: mocks.resolvePythinkerHome,
    createPythinkerHarness: (...args: unknown[]) => {
      const options = args[0] as { readonly homeDir?: string } | undefined;
      const homeDir = options?.homeDir ?? '/tmp/pythinker-code-test-home';
      if (mocks.harnessCreatesDeviceIdOnConstruction) {
        mocks.createPythinkerDeviceId(homeDir);
      }
      mocks.pythinkerHarnessConstructor(...args);
      return {
        homeDir,
        auth: { getCachedAccessToken: mocks.harnessGetCachedAccessToken },
        ensureConfigFile: mocks.harnessEnsureConfigFile,
        getConfig: mocks.harnessGetConfig,
        getConfigDiagnostics: mocks.harnessGetConfigDiagnostics,
        getExperimentalFeatures: mocks.harnessGetExperimentalFeatures,
        createSession: mocks.harnessCreateSession,
        resumeSession: mocks.harnessResumeSession,
        listSessions: mocks.harnessListSessions,
        close: mocks.harnessClose,
        track: mocks.harnessTrack,
      };
    },
  };
});

vi.mock('@pymodel/pythinker-code-oauth', async () => {
  const actual = await vi.importActual<typeof import('@pymodel/pythinker-code-oauth')>(
    '@pymodel/pythinker-code-oauth',
  );
  return {
    ...actual,
    createPythinkerDeviceId: mocks.createPythinkerDeviceId,
  };
});

vi.mock('@pymodel/pythinker-telemetry', () => ({
  initializeTelemetry: mocks.initializeTelemetry,
  setCrashPhase: mocks.setCrashPhase,
  shutdownTelemetry: mocks.shutdownTelemetry,
  track: mocks.telemetryTrack,
  setTelemetryContext: mocks.setTelemetryContext,
  withTelemetryContext: mocks.withTelemetryContext,
}));

function opts(overrides: Partial<Parameters<typeof runPrompt>[0]> = {}) {
  return {
    session: undefined,
    continue: false,
    yolo: false,
    auto: false,
    plan: false,
    model: undefined,
    outputFormat: undefined,
    jsonSchema: undefined,
    prompt: 'say hello',
    rewindFiles: undefined,
    skillsDirs: [],
    ...overrides,
  };
}

function writer(columns?: number) {
  let text = '';
  return {
    columns,
    write: vi.fn((chunk: string) => {
      text += chunk;
      return true;
    }),
    flush: vi.fn(async () => {}),
    text: () => text,
  };
}

function fakeProcess() {
  const listeners = new Map<NodeJS.Signals, () => Promise<void> | void>();
  return {
    on: vi.fn((signal: NodeJS.Signals, listener: () => Promise<void> | void) => {
      listeners.set(signal, listener);
    }),
    off: vi.fn((signal: NodeJS.Signals, listener: () => Promise<void> | void) => {
      if (listeners.get(signal) === listener) {
        listeners.delete(signal);
      }
    }),
    exit: vi.fn(),
    listener: (signal: NodeJS.Signals) => listeners.get(signal),
  };
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw lastError;
}

describe('runPrompt', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.eventHandlers.clear();
    mocks.createPythinkerDeviceId.mockImplementation(() => 'device-1');
    mocks.resolvePythinkerHome.mockImplementation(
      (homeDir?: string) => homeDir ?? '/tmp/pythinker-code-test-home',
    );
    mocks.harnessCreatesDeviceIdOnConstruction = false;
  });

  it('creates a fresh auto-permission session and streams assistant output to stdout', async () => {
    const stdout = writer();
    const stderr = writer();

    await runPrompt(opts({ skillsDirs: ['/skills'] }), '1.2.3-test', { stdout, stderr });

    expect(mocks.pythinkerHarnessConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ skillDirs: ['/skills'], uiMode: 'print' }),
    );
    expect(mocks.harnessCreateSession).toHaveBeenCalledWith({
      workDir: process.cwd(),
      model: 'k2',
      permission: 'auto',
    });
    expect(mocks.session.setPermission).not.toHaveBeenCalled();
    expect(mocks.session.setApprovalHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.session.setQuestionHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.session.prompt).toHaveBeenCalledWith('say hello', {
      outputSchema: undefined,
    });
    expect(stdout.text()).toBe('• hello world\n\n');
    expect(stderr.text()).toBe('To resume this session: pythinker -r ses_prompt\n');
    expect(mocks.shutdownTelemetry).toHaveBeenCalled();
    expect(mocks.harnessClose).toHaveBeenCalled();
  });

  it('passes the maintenance Setup trigger into prompt session startup', async () => {
    await runPrompt(opts({ maintenance: true }), '1.2.3-test', {
      stdout: writer(),
      stderr: writer(),
    });

    expect(mocks.harnessCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ setupTrigger: 'maintenance' }),
    );
  });

  it('passes the init Setup trigger into prompt session startup', async () => {
    await runPrompt(opts({ init: true }), '1.2.3-test', {
      stdout: writer(),
      stderr: writer(),
    });

    expect(mocks.harnessCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ setupTrigger: 'init' }),
    );
  });

  it('applies additional working directories before running the prompt', async () => {
    const stdout = writer();
    const stderr = writer();

    await runPrompt(opts({ additionalDirs: ['/tmp/extra'] }), '1.2.3-test', {
      stdout,
      stderr,
    });

    expect(mocks.session.addWorkspaceDirectory).toHaveBeenCalledWith('/tmp/extra');
  });

  it('stops prompt startup when session creation fails', async () => {
    const stdout = writer();
    const stderr = writer();
    mocks.harnessCreateSession.mockRejectedValueOnce(new Error('Git Bash missing'));

    await expect(runPrompt(opts(), '1.2.3-test', { stdout, stderr })).rejects.toThrow(
      'Git Bash missing',
    );

    expect(mocks.harnessEnsureConfigFile).toHaveBeenCalledOnce();
    expect(mocks.harnessGetConfig).toHaveBeenCalledOnce();
    expect(mocks.harnessCreateSession).toHaveBeenCalledOnce();
    expect(mocks.session.prompt).not.toHaveBeenCalled();
    expect(mocks.harnessClose).toHaveBeenCalledOnce();
  });

  it('uses the CLI model override when creating a fresh prompt session', async () => {
    await runPrompt(opts({ model: 'pythinker-code/k2.5' }), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    expect(mocks.harnessCreateSession).toHaveBeenCalledWith({
      workDir: process.cwd(),
      model: 'pythinker-code/k2.5',
      permission: 'auto',
    });
    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'pythinker-code/k2.5' }),
    );
  });

  it('tracks first launch in prompt mode before harness construction can create the device id', async () => {
    mocks.harnessCreatesDeviceIdOnConstruction = true;
    const createdHomes = new Set<string>();
    mocks.createPythinkerDeviceId.mockImplementation((homeDir, options) => {
      const deviceId = `device-for-${homeDir}`;
      if (!createdHomes.has(homeDir)) {
        createdHomes.add(homeDir);
        options?.onFirstLaunch?.(deviceId);
      }
      return deviceId;
    });

    await runPrompt(opts(), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    expect(mocks.createPythinkerDeviceId).toHaveBeenNthCalledWith(
      1,
      '/tmp/pythinker-code-test-home',
      expect.objectContaining({ onFirstLaunch: expect.any(Function) }),
    );
    expect(mocks.createPythinkerDeviceId.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.pythinkerHarnessConstructor.mock.invocationCallOrder[0]!,
    );
    expect(mocks.pythinkerHarnessConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ homeDir: '/tmp/pythinker-code-test-home' }),
    );
    expect(mocks.harnessTrack).toHaveBeenCalledWith('first_launch');
  });

  it('formats thinking and assistant output as transcript blocks', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 3, origin: { kind: 'user' } }),
        );
        handler(
          mocks.mainEvent({
            type: 'thinking.delta',
            turnId: 3,
            delta: 'The user wants an exact reply.',
          }),
        );
        handler(
          mocks.mainEvent({
            type: 'thinking.delta',
            turnId: 3,
            delta: '\nNo tools are needed.',
          }),
        );
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 3, delta: 'prompt-mode-ok' }));
        handler(mocks.mainEvent({ type: 'turn.ended', turnId: 3, reason: 'completed' }));
      }
    });
    const stdout = writer();
    const stderr = writer();

    await runPrompt(opts(), '1.2.3-test', { stdout, stderr });

    expect(stderr.text()).toBe(
      '• The user wants an exact reply.\n  No tools are needed.\n\nTo resume this session: pythinker -r ses_prompt\n',
    );
    expect(stdout.text()).toBe('• prompt-mode-ok\n\n');
    expect(stderr.write).toHaveBeenNthCalledWith(1, '• The user wants an exact reply.');
    expect(stderr.write).toHaveBeenNthCalledWith(2, '\n  No tools are needed.');
    expect(stdout.write).toHaveBeenNthCalledWith(1, '• prompt-mode-ok');
  });

  it('formats hook results as their own transcript block', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 3, origin: { kind: 'user' } }),
        );
        handler(
          mocks.mainEvent({
            type: 'hook.result',
            turnId: 3,
            hookEvent: 'UserPromptSubmit',
            content: '{}',
          }),
        );
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 3, delta: 'answer' }));
        handler(mocks.mainEvent({ type: 'turn.ended', turnId: 3, reason: 'completed' }));
      }
    });
    const stdout = writer();
    const stderr = writer();

    await runPrompt(opts(), '1.2.3-test', { stdout, stderr });

    expect(stdout.text()).toBe('• UserPromptSubmit hook\n\n  {}\n\n• answer\n\n');
    expect(stderr.text()).toBe('To resume this session: pythinker -r ses_prompt\n');
  });

  it('wraps transcript blocks with hanging indentation when terminal width is known', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 4, origin: { kind: 'user' } }),
        );
        handler(mocks.mainEvent({ type: 'thinking.delta', turnId: 4, delta: 'thinking-wrap' }));
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 4, delta: 'answer-wrap' }));
        handler(mocks.mainEvent({ type: 'turn.ended', turnId: 4, reason: 'completed' }));
      }
    });
    const stdout = writer(10);
    const stderr = writer(10);

    await runPrompt(opts(), '1.2.3-test', { stdout, stderr });

    expect(stderr.text()).toBe('• thinking\n  -wrap\n\nTo resume this session: pythinker -r ses_prompt\n');
    expect(stdout.text()).toBe('• answer-w\n  rap\n\n');
  });

  it('filters prompt output and completion to the main agent turn', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      const emit = (event: Record<string, unknown>) => {
        for (const handler of Array.from(mocks.eventHandlers)) {
          handler(event);
        }
      };

      emit(mocks.mainEvent({ type: 'turn.started', turnId: 1, origin: { kind: 'user' } }));
      emit(
        mocks.agentEvent('child-agent', {
          type: 'turn.started',
          turnId: 1,
          origin: { kind: 'user' },
        }),
      );
      emit(
        mocks.agentEvent('child-agent', {
          type: 'assistant.delta',
          turnId: 1,
          delta: 'sub answer',
        }),
      );
      emit(mocks.agentEvent('child-agent', { type: 'turn.ended', turnId: 1, reason: 'completed' }));
      await Promise.resolve();
      emit(mocks.mainEvent({ type: 'assistant.delta', turnId: 1, delta: 'main answer' }));
      emit(mocks.mainEvent({ type: 'turn.ended', turnId: 1, reason: 'completed' }));
    });
    const stdout = writer();
    const stderr = writer();

    await runPrompt(opts(), '1.2.3-test', { stdout, stderr });

    expect(stdout.text()).toBe('• main answer\n\n');
    expect(stderr.text()).toBe('To resume this session: pythinker -r ses_prompt\n');
  });

  it('ignores child-agent error events while the main turn continues', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      const emit = (event: Record<string, unknown>) => {
        for (const handler of Array.from(mocks.eventHandlers)) {
          handler(event);
        }
      };

      emit(mocks.mainEvent({ type: 'turn.started', turnId: 1, origin: { kind: 'user' } }));
      emit(
        mocks.agentEvent('child-agent', {
          type: 'error',
          code: 'subagent.failed',
          message: 'child failed',
        }),
      );
      await Promise.resolve();
      emit(mocks.mainEvent({ type: 'assistant.delta', turnId: 1, delta: 'main recovered' }));
      emit(mocks.mainEvent({ type: 'turn.ended', turnId: 1, reason: 'completed' }));
    });
    const stdout = writer();
    const stderr = writer();

    await runPrompt(opts(), '1.2.3-test', { stdout, stderr });

    expect(stdout.text()).toBe('• main recovered\n\n');
    expect(stderr.text()).toBe('To resume this session: pythinker -r ses_prompt\n');
  });

  it('resumes a concrete session and forces auto permission before prompting', async () => {
    await runPrompt(opts({ session: 'ses_existing' }), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    expect(mocks.harnessResumeSession).toHaveBeenCalledWith({ id: 'ses_existing' });
    expect(mocks.session.getStatus).toHaveBeenCalled();
    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(1, 'auto');
    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(2, 'manual');
  });

  it('rewinds a resumed session without starting a prompt turn', async () => {
    const stdout = writer();
    const stderr = writer();

    await runPrompt(
      opts({
        session: 'session-1',
        prompt: undefined,
        rewindFiles: 'checkpoint-1',
      }),
      '1.2.3-test',
      { stdout, stderr },
    );

    expect(mocks.harnessResumeSession).toHaveBeenCalledWith({ id: 'session-1' });
    expect(mocks.session.restoreFileCheckpoint).toHaveBeenCalledWith('checkpoint-1');
    expect(mocks.session.getStatus).not.toHaveBeenCalled();
    expect(mocks.session.setPermission).not.toHaveBeenCalled();
    expect(mocks.session.onEvent).not.toHaveBeenCalled();
    expect(mocks.session.prompt).not.toHaveBeenCalled();
    expect(stdout.text()).toBe(
      'Files rewound to checkpoint checkpoint-1.\n' +
        'Recovery checkpoint: recovery-1.\n' +
        'Restored: 1. Deleted: 1.\n',
    );
    expect(stderr.text()).toBe('');
  });

  it('allows resuming a concrete session when Windows workdir uses backslashes', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(String.raw`C:\Users\pythinker\project`);
    mocks.harnessListSessions.mockResolvedValueOnce([
      { id: 'ses_existing', workDir: 'C:/Users/pythinker/project' },
    ]);

    try {
      await runPrompt(opts({ session: 'ses_existing' }), '1.2.3-test', {
        stdout: { write: vi.fn(() => true) },
        stderr: { write: vi.fn(() => true) },
      });
    } finally {
      cwd.mockRestore();
    }

    expect(mocks.harnessListSessions).toHaveBeenCalledWith({
      sessionId: 'ses_existing',
      workDir: String.raw`C:\Users\pythinker\project`,
    });
    expect(mocks.harnessResumeSession).toHaveBeenCalledWith({ id: 'ses_existing' });
  });

  it('applies the CLI model override to resumed prompt sessions', async () => {
    await runPrompt(opts({ session: 'ses_existing', model: 'pythinker-code/k2.5' }), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    expect(mocks.harnessResumeSession).toHaveBeenCalledWith({ id: 'ses_existing' });
    expect(mocks.session.setModel).toHaveBeenCalledWith('pythinker-code/k2.5');
    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'pythinker-code/k2.5' }),
    );
  });

  it('writes stream-json output as assistant JSONL with resume meta without transcript bullets', async () => {
    const stdout = writer();
    const stderr = writer();

    await runPrompt(opts({ outputFormat: 'stream-json' }), '1.2.3-test', { stdout, stderr });

    expect(stdout.text()).toBe(
      [
        '{"role":"assistant","content":"hello world"}',
        '{"role":"meta","type":"session.resume_hint","session_id":"ses_prompt","command":"pythinker -r ses_prompt","content":"To resume this session: pythinker -r ses_prompt"}',
        '',
      ].join('\n'),
    );
    expect(stderr.text()).toBe('');
  });

  it('writes stream-json tool calls and tool results as JSONL messages', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 8, origin: { kind: 'user' } }),
        );
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 8, delta: 'checking' }));
        handler(
          mocks.mainEvent({
            type: 'tool.call.started',
            turnId: 8,
            toolCallId: 'tc_1',
            name: 'Shell',
            args: { command: 'ls' },
          }),
        );
        handler(
          mocks.mainEvent({
            type: 'tool.result',
            turnId: 8,
            toolCallId: 'tc_1',
            output: 'file1.py\nfile2.py',
          }),
        );
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 8, delta: 'done' }));
        handler(mocks.mainEvent({ type: 'turn.ended', turnId: 8, reason: 'completed' }));
      }
    });
    const stdout = writer();
    const stderr = writer();

    await runPrompt(opts({ outputFormat: 'stream-json' }), '1.2.3-test', { stdout, stderr });

    expect(stdout.text()).toBe(
      [
        '{"role":"assistant","content":"checking","tool_calls":[{"type":"function","id":"tc_1","function":{"name":"Shell","arguments":"{\\"command\\":\\"ls\\"}"}}]}',
        '{"role":"tool","tool_call_id":"tc_1","content":"file1.py\\nfile2.py"}',
        '{"role":"assistant","content":"done"}',
        '{"role":"meta","type":"session.resume_hint","session_id":"ses_prompt","command":"pythinker -r ses_prompt","content":"To resume this session: pythinker -r ses_prompt"}',
        '',
      ].join('\n'),
    );
  });

  it('writes one JSON result with validated structured output', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 9, origin: { kind: 'user' } }),
        );
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 9, delta: 'working' }));
        handler(mocks.mainEvent({ type: 'turn.step.started', turnId: 9, step: 2 }));
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 9, delta: 'done' }));
        handler(
          mocks.mainEvent({
            type: 'turn.ended',
            turnId: 9,
            reason: 'completed',
            structuredOutput: { answer: 'done' },
          }),
        );
      }
    });
    const stdout = writer();
    const stderr = writer();
    const schema = '{"type":"object","properties":{"answer":{"type":"string"}}}';

    await runPrompt(
      opts({ outputFormat: 'json', jsonSchema: schema }),
      '1.2.3-test',
      { stdout, stderr },
    );

    expect(mocks.session.prompt).toHaveBeenCalledWith('say hello', {
      outputSchema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
      },
    });
    expect(stdout.text()).toBe(
      '{"type":"result","subtype":"success","is_error":false,"result":"done","structured_output":{"answer":"done"},"session_id":"ses_prompt"}\n',
    );
    expect(stderr.text()).toBe('To resume this session: pythinker -r ses_prompt\n');
  });

  it('writes a terminal structured result in stream-json mode', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 10, origin: { kind: 'user' } }),
        );
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 10, delta: 'working' }));
        handler(mocks.mainEvent({ type: 'turn.step.started', turnId: 10, step: 2 }));
        handler(mocks.mainEvent({ type: 'assistant.delta', turnId: 10, delta: 'done' }));
        handler(
          mocks.mainEvent({
            type: 'turn.ended',
            turnId: 10,
            reason: 'completed',
            structuredOutput: { answer: 'done' },
          }),
        );
      }
    });
    const stdout = writer();
    const stderr = writer();

    await runPrompt(
      opts({
        outputFormat: 'stream-json',
        jsonSchema: '{"type":"object"}',
      }),
      '1.2.3-test',
      { stdout, stderr },
    );

    expect(stdout.text()).toBe(
      [
        '{"role":"assistant","content":"working"}',
        '{"role":"assistant","content":"done"}',
        '{"type":"result","subtype":"success","is_error":false,"result":"done","structured_output":{"answer":"done"},"session_id":"ses_prompt"}',
        '{"role":"meta","type":"session.resume_hint","session_id":"ses_prompt","command":"pythinker -r ses_prompt","content":"To resume this session: pythinker -r ses_prompt"}',
        '',
      ].join('\n'),
    );
    expect(stderr.text()).toBe('');
  });

  it('rejects malformed --json-schema before creating a harness', async () => {
    await expect(
      runPrompt(opts({ jsonSchema: '{invalid' }), '1.2.3-test'),
    ).rejects.toThrow('Invalid --json-schema JSON');

    expect(mocks.pythinkerHarnessConstructor).not.toHaveBeenCalled();
  });

  it('rejects non-object --json-schema values before creating a harness', async () => {
    await expect(
      runPrompt(opts({ jsonSchema: '["not", "an", "object"]' }), '1.2.3-test'),
    ).rejects.toThrow('Invalid --json-schema JSON: expected a JSON object.');

    expect(mocks.pythinkerHarnessConstructor).not.toHaveBeenCalled();
  });

  it('rejects structured output for headless goal prompts', async () => {
    await expect(
      runPrompt(
        opts({
          prompt: '/goal finish the migration',
          jsonSchema: '{"type":"object"}',
        }),
        '1.2.3-test',
      ),
    ).rejects.toThrow('Cannot combine --json-schema with a headless goal prompt.');

    expect(mocks.session.prompt).not.toHaveBeenCalled();
  });

  it('resumes a concrete session without a configured default model', async () => {
    mocks.harnessGetConfig.mockResolvedValueOnce({ providers: {}, telemetry: true });
    mocks.session.getStatus.mockResolvedValueOnce({ permission: 'manual', model: 'saved-model' });

    await runPrompt(opts({ session: 'ses_existing' }), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    expect(mocks.harnessResumeSession).toHaveBeenCalledWith({ id: 'ses_existing' });
    expect(mocks.harnessCreateSession).not.toHaveBeenCalled();
    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'saved-model' }),
    );
    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(1, 'auto');
    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(2, 'manual');
  });

  it('continues the previous workdir session when --continue is used', async () => {
    await runPrompt(opts({ continue: true }), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    expect(mocks.harnessListSessions).toHaveBeenCalledWith({ workDir: process.cwd() });
    expect(mocks.harnessResumeSession).toHaveBeenCalledWith({ id: 'ses_previous' });
    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(1, 'auto');
    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(2, 'manual');
  });

  it('continues a previous session without a configured default model', async () => {
    mocks.harnessGetConfig.mockResolvedValueOnce({ providers: {}, telemetry: true });
    mocks.session.getStatus.mockResolvedValueOnce({ permission: 'manual', model: 'saved-model' });

    await runPrompt(opts({ continue: true }), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    expect(mocks.harnessListSessions).toHaveBeenCalledWith({ workDir: process.cwd() });
    expect(mocks.harnessResumeSession).toHaveBeenCalledWith({ id: 'ses_previous' });
    expect(mocks.harnessCreateSession).not.toHaveBeenCalled();
    expect(mocks.initializeTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'saved-model' }),
    );
  });

  it('restores resumed session permission even when the turn fails', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 5, origin: { kind: 'user' } }),
        );
        handler(
          mocks.mainEvent({
            type: 'turn.ended',
            turnId: 5,
            reason: 'failed',
            error: { code: 'provider.error', message: 'model failed' },
          }),
        );
      }
    });

    await expect(
      runPrompt(opts({ session: 'ses_existing' }), '1.2.3-test', {
        stdout: { write: vi.fn(() => true) },
        stderr: { write: vi.fn(() => true) },
      }),
    ).rejects.toThrow('provider.error: model failed');

    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(1, 'auto');
    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(2, 'manual');
    expect(mocks.session.setPermission.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.harnessClose.mock.invocationCallOrder[0]!,
    );
  });

  it('restores resumed session permission before exiting on SIGINT', async () => {
    let releasePrompt!: () => void;
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 6, origin: { kind: 'user' } }),
        );
      }
      await new Promise<void>((resolve) => {
        releasePrompt = resolve;
      });
    });
    const processMock = fakeProcess();
    const run = runPrompt(opts({ session: 'ses_existing' }), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
      process: processMock,
    } as Parameters<typeof runPrompt>[2] & { process: ReturnType<typeof fakeProcess> });

    await waitForAssertion(() => {
      expect(mocks.session.setPermission).toHaveBeenCalledWith('auto');
      expect(processMock.listener('SIGINT')).toBeDefined();
    });

    await processMock.listener('SIGINT')?.();

    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(2, 'manual');
    expect(mocks.session.setPermission.mock.invocationCallOrder[1]).toBeLessThan(
      processMock.exit.mock.invocationCallOrder[0]!,
    );
    expect(mocks.shutdownTelemetry).toHaveBeenCalled();
    expect(mocks.harnessClose).toHaveBeenCalled();
    expect(processMock.exit).toHaveBeenCalledWith(130);

    for (const handler of mocks.eventHandlers) {
      handler(mocks.mainEvent({ type: 'turn.ended', turnId: 6, reason: 'completed' }));
    }
    releasePrompt();
    await run;

    expect(mocks.harnessClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SIGTERM' as NodeJS.Signals, 143],
    ['SIGHUP' as NodeJS.Signals, 129],
  ])('cleans up prompt mode before exiting on %s', async (signal, exitCode) => {
    let releasePrompt!: () => void;
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 7, origin: { kind: 'user' } }),
        );
      }
      await new Promise<void>((resolve) => {
        releasePrompt = resolve;
      });
    });
    const processMock = fakeProcess();
    const run = runPrompt(opts(), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
      process: processMock,
    } as Parameters<typeof runPrompt>[2] & { process: ReturnType<typeof fakeProcess> });

    await waitForAssertion(() => {
      expect(processMock.listener(signal)).toBeDefined();
    });

    await processMock.listener(signal)?.();

    expect(mocks.shutdownTelemetry).toHaveBeenCalled();
    expect(mocks.harnessClose).toHaveBeenCalled();
    expect(processMock.exit).toHaveBeenCalledWith(exitCode);

    for (const handler of mocks.eventHandlers) {
      handler(mocks.mainEvent({ type: 'turn.ended', turnId: 7, reason: 'completed' }));
    }
    releasePrompt();
    await run;

    expect(mocks.harnessClose).toHaveBeenCalledTimes(1);
  });

  it('forces immediate exit on a second signal while graceful cleanup is pending', async () => {
    let releaseAutoPermission!: () => void;
    mocks.session.setPermission.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseAutoPermission = resolve;
      });
    });
    const processMock = fakeProcess();
    const stdout = writer();
    const stderr = writer();
    const run = runPrompt(opts({ session: 'ses_existing' }), '1.2.3-test', {
      stdout,
      stderr,
      process: processMock,
    } as Parameters<typeof runPrompt>[2] & { process: ReturnType<typeof fakeProcess> });

    await waitForAssertion(() => {
      expect(processMock.listener('SIGINT')).toBeDefined();
      expect(mocks.session.setPermission).toHaveBeenCalledWith('auto');
    });
    expect(processMock.on.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.session.setPermission.mock.invocationCallOrder[0]!,
    );

    const signalCleanup = processMock.listener('SIGINT')!();
    await Promise.resolve();

    expect(mocks.session.setPermission).toHaveBeenCalledTimes(1);
    expect(processMock.exit).not.toHaveBeenCalled();

    const forceExit = processMock.listener('SIGTERM')!();

    expect(processMock.exit).toHaveBeenCalledOnce();
    expect(processMock.exit).toHaveBeenCalledWith(143);
    expect(processMock.listener('SIGINT')).toBeUndefined();
    expect(processMock.listener('SIGTERM')).toBeUndefined();

    releaseAutoPermission();
    await Promise.all([signalCleanup, forceExit]);
    await run;

    expect(mocks.session.setPermission).toHaveBeenNthCalledWith(2, 'manual');
    expect(mocks.shutdownTelemetry).toHaveBeenCalledTimes(1);
    expect(mocks.harnessClose).toHaveBeenCalledTimes(1);
    expect(stdout.flush).toHaveBeenCalledOnce();
    expect(stderr.flush).toHaveBeenCalledOnce();
    expect(processMock.exit).toHaveBeenCalledOnce();
  });

  it('uses auto permission so headless mode can bypass plan approval and questions', async () => {
    await runPrompt(opts(), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    expect(mocks.harnessCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ permission: 'auto' }),
    );
  });

  it('throws when no default model is configured', async () => {
    mocks.harnessGetConfig.mockResolvedValueOnce({ providers: {}, telemetry: true });

    await expect(
      runPrompt(opts(), '1.2.3-test', {
        stdout: { write: vi.fn(() => true) },
        stderr: { write: vi.fn(() => true) },
      }),
    ).rejects.toThrow(
      'No model configured. Run `pythinker` and use /login to sign in, then retry; or set default_model in config.toml.',
    );

    expect(mocks.harnessClose).toHaveBeenCalled();
  });

  it('rejects when the turn fails and still closes resources', async () => {
    mocks.session.prompt.mockImplementationOnce(async () => {
      for (const handler of mocks.eventHandlers) {
        handler(
          mocks.mainEvent({ type: 'turn.started', turnId: 2, origin: { kind: 'user' } }),
        );
        handler(
          mocks.mainEvent({
            type: 'turn.ended',
            turnId: 2,
            reason: 'failed',
            error: { code: 'provider.error', message: 'model failed' },
          }),
        );
      }
    });

    await expect(
      runPrompt(opts(), '1.2.3-test', {
        stdout: { write: vi.fn(() => true) },
        stderr: { write: vi.fn(() => true) },
      }),
    ).rejects.toThrow('provider.error: model failed');

    expect(mocks.shutdownTelemetry).toHaveBeenCalled();
    expect(mocks.harnessClose).toHaveBeenCalled();
  });

  it('approval fallback approves if an unexpected approval request reaches SDK', async () => {
    await runPrompt(opts(), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    const handler = mocks.session.setApprovalHandler.mock.calls[0]![0] as () => unknown;
    expect(handler()).toEqual({ decision: 'approved' });
  });

  it('question fallback returns null so prompt mode never opens a question UI', async () => {
    await runPrompt(opts(), '1.2.3-test', {
      stdout: { write: vi.fn(() => true) },
      stderr: { write: vi.fn(() => true) },
    });

    const handler = mocks.session.setQuestionHandler.mock.calls[0]![0] as () => unknown;
    expect(handler()).toBeNull();
  });
});
