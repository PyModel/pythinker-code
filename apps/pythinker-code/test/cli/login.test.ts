/**
 * `pythinker login`
 *
 * Verifies that the login sub-command is registered on the program and that
 * the action drives the multi-provider login flow: the provider picker
 * (`@clack/prompts`) is offered unless `--provider <id>` skips it, the device
 * code is printed to stderr, and the process exits with the right code on
 * success / cancellation / failure. Non-TTY stdin refuses to prompt.
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceAuthorization } from '@pythoughts/pythinker-code-oauth';

const mockLogin = vi.fn();
const mockStatus = vi.fn();
const mockGetConfig = vi.fn();
const mockSetConfig = vi.fn();
const mockRemoveProvider = vi.fn();

vi.mock('@pythoughts/pythinker-code-sdk', async () => {
  const actual = await vi.importActual<typeof import('@pythoughts/pythinker-code-sdk')>(
    '@pythoughts/pythinker-code-sdk',
  );
  return {
    ...actual,
    createPythinkerHarness: vi.fn(() => ({
      auth: {
        login: mockLogin,
        status: mockStatus,
      },
      getConfig: mockGetConfig,
      setConfig: mockSetConfig,
      removeProvider: mockRemoveProvider,
    })),
    // Deterministic offline fallback: login must work from the bundled
    // catalog without touching the network.
    fetchCatalog: vi.fn().mockRejectedValue(new Error('offline')),
  };
});

vi.mock('@clack/prompts', async () => {
  const actual = await vi.importActual<typeof import('@clack/prompts')>('@clack/prompts');
  // clack's log caches its own write reference at import time, which would
  // bypass the per-test process.stderr.write spy; route through the live
  // stream instead so the assertions below observe the output.
  const logWrite = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  // clack 1.7's real cancel sentinel is a private local symbol, so the mock
  // pairs its own sentinel with a matching isCancel predicate.
  const cancelSymbol = Symbol.for('clack:cancel');
  return {
    ...actual,
    isCancel: (value: unknown): boolean => value === cancelSymbol,
    log: {
      message: logWrite,
      info: logWrite,
      success: logWrite,
      warn: logWrite,
      error: logWrite,
    },
    select: vi.fn(),
    password: vi.fn(),
    text: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      error: vi.fn(),
    })),
  };
});

// The oauth package is imported transitively before this module's body runs,
// so the spy has to exist at hoist time.
const { mockFetchOpenPlatformModels } = vi.hoisted(() => ({
  mockFetchOpenPlatformModels: vi.fn(),
}));

vi.mock('@pythoughts/pythinker-code-oauth', async () => {
  const actual = await vi.importActual<typeof import('@pythoughts/pythinker-code-oauth')>(
    '@pythoughts/pythinker-code-oauth',
  );
  return { ...actual, fetchOpenPlatformModels: mockFetchOpenPlatformModels };
});

vi.mock('#/utils/open-url', () => ({ openUrl: vi.fn() }));

import { password, select } from '@clack/prompts';
import {
  createPythinkerHarness,
  fetchCatalog,
  type Catalog,
} from '@pythoughts/pythinker-code-sdk';

import { registerLoginCommand } from '#/cli/sub/login';
import { openUrl } from '#/utils/open-url';

class ExitCalled extends Error {
  constructor(public code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

const CANCEL = Symbol.for('clack:cancel');

describe('pythinker login', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let originalIsTTY: PropertyDescriptor | undefined;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockLogin.mockReset();
    mockStatus.mockReset();
    mockGetConfig.mockReset();
    mockSetConfig.mockReset();
    mockRemoveProvider.mockReset();
    vi.mocked(openUrl).mockReset();
    vi.mocked(createPythinkerHarness).mockClear();
    vi.mocked(select).mockReset();
    // Capture the real descriptor so teardown restores it exactly; assigning
    // `undefined` would leave a fake own-property behind for later suites.
    originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      throw new ExitCalled(code);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((
      _chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      const complete =
        typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      complete?.();
      return true;
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    if (originalIsTTY === undefined) {
      delete (process.stdin as { isTTY?: boolean }).isTTY;
    } else {
      Object.defineProperty(process.stdin, 'isTTY', originalIsTTY);
    }
  });

  function pickerProgram(): Command {
    const program = new Command('pythinker').exitOverride();
    registerLoginCommand(program);
    return program;
  }

  async function runLogin(args: readonly string[]): Promise<void> {
    await expect(pickerProgram().parseAsync(['node', 'pythinker', ...args])).rejects.toThrow(
      ExitCalled,
    );
  }

  function writtenChunks(): string[] {
    return stderrSpy.mock.calls.map((call: unknown[]) => String(call[0]));
  }

  /** One connectable catalog provider, enough for `buildPlatformOptions` to list it. */
  function catalogWithDeepSeek(): Catalog {
    return {
      deepseek: {
        id: 'deepseek',
        name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://api.example.com/v1',
        models: {
          'deepseek-chat': {
            id: 'deepseek-chat',
            name: 'DeepSeek Chat',
            tool_call: true,
            limit: { context: 128_000, output: 8_192 },
          },
        },
      },
    };
  }

  it('registers a `login` subcommand with a --provider option on the program', () => {
    const program = new Command('pythinker');
    registerLoginCommand(program);

    const login = program.commands.find((c) => c.name() === 'login');
    expect(login).toBeDefined();
    expect(login?.description()).toMatch(/[Ll]og in/u);
    expect(login?.options.some((option) => option.attributeName() === 'provider')).toBe(true);
  });

  it('shows the provider picker and exits 0 after a successful OAuth login', async () => {
    vi.mocked(select).mockResolvedValueOnce('kimi-code');
    mockStatus.mockResolvedValue({ providers: [] });
    mockLogin.mockResolvedValue({ providerName: 'managed:kimi-code', ok: true });

    await runLogin(['login']);

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Select a provider' }),
    );
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledWith(
      'managed:kimi-code',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onDeviceCode: expect.any(Function),
      }),
    );
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
  });

  it('prints the device code and verification URL to stderr', async () => {
    vi.mocked(select).mockResolvedValueOnce('kimi-code');
    mockStatus.mockResolvedValue({ providers: [] });
    mockLogin.mockImplementation(
      async (
        _providerName: string,
        options: { onDeviceCode?: (data: DeviceAuthorization) => void | Promise<void> },
      ) => {
        await options.onDeviceCode?.({
          userCode: 'ABCD-EFGH',
          deviceCode: 'device-code',
          verificationUri: 'https://example.com/v',
          verificationUriComplete: 'https://example.com/v?code=ABCD-EFGH',
          expiresIn: 600,
          interval: 5,
        });
        return { providerName: 'managed:kimi-code', ok: true };
      },
    );

    await runLogin(['login']);

    const chunks = writtenChunks();
    expect(chunks.some((chunk: string) => chunk.includes('ABCD-EFGH'))).toBe(true);
    expect(chunks.some((chunk: string) => chunk.includes('https://example.com/v'))).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/v?code=ABCD-EFGH');
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
  });

  it('still prints the device code when opening the browser fails', async () => {
    vi.mocked(openUrl).mockImplementation(() => {
      throw new Error('no browser');
    });
    vi.mocked(select).mockResolvedValueOnce('kimi-code');
    mockStatus.mockResolvedValue({ providers: [] });
    mockLogin.mockImplementation(
      async (
        _providerName: string,
        options: { onDeviceCode?: (data: DeviceAuthorization) => void | Promise<void> },
      ) => {
        await options.onDeviceCode?.({
          userCode: 'ABCD-EFGH',
          deviceCode: 'device-code',
          verificationUri: 'https://example.com/v',
          verificationUriComplete: 'https://example.com/v?code=ABCD-EFGH',
          expiresIn: 600,
          interval: 5,
        });
        return { providerName: 'managed:kimi-code', ok: true };
      },
    );

    await runLogin(['login']);

    const chunks = writtenChunks();
    expect(chunks.some((chunk: string) => chunk.includes('ABCD-EFGH'))).toBe(true);
    expect(chunks.some((chunk: string) => chunk.includes('https://example.com/v'))).toBe(true);
    expect(openUrl).toHaveBeenCalledWith('https://example.com/v?code=ABCD-EFGH');
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
  });

  it('exits 1 when auth.login throws', async () => {
    vi.mocked(select).mockResolvedValueOnce('kimi-code');
    mockStatus.mockResolvedValue({ providers: [] });
    mockLogin.mockRejectedValue(new Error('boom'));

    await runLogin(['login']);

    const chunks = writtenChunks();
    expect(chunks.some((chunk: string) => chunk.includes('boom'))).toBe(true);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  it('--provider <id> skips the picker entirely and logs in directly', async () => {
    mockStatus.mockResolvedValue({ providers: [] });
    mockLogin.mockResolvedValue({ providerName: 'managed:kimi-code', ok: true });

    await runLogin(['login', '--provider', 'kimi-code']);

    expect(select).not.toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
  });

  it('--provider matches a display name case-insensitively', async () => {
    mockStatus.mockResolvedValue({ providers: [] });
    mockLogin.mockResolvedValue({ providerName: 'managed:kimi-code', ok: true });

    await runLogin(['login', '-p', 'kimi (oauth)']);

    expect(select).not.toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
  });

  it('--provider matches a catalog provider by its bare id', async () => {
    // A catalog provider's option value carries the internal `catalog:` prefix
    // and its label is a product name, so the id printed everywhere else —
    // `deepseek` — used to match neither and the login failed outright.
    mockStatus.mockResolvedValue({ providers: [] });
    mockGetConfig.mockResolvedValue({ providers: {}, models: {} });
    vi.mocked(fetchCatalog).mockResolvedValueOnce(catalogWithDeepSeek());
    vi.mocked(password).mockResolvedValue('sk-test-key');
    vi.mocked(select)
      .mockResolvedValueOnce('deepseek/deepseek-chat')
      .mockResolvedValueOnce('off');

    await runLogin(['login', '--provider', 'DeepSeek API']);

    expect(select).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Select a provider' }),
    );
    expect(mockSetConfig).toHaveBeenCalled();
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);

    // The bare id resolves the same option the label does.
    vi.mocked(select).mockReset();
    mockSetConfig.mockClear();
    exitSpy.mockClear();
    vi.mocked(fetchCatalog).mockResolvedValueOnce(catalogWithDeepSeek());
    vi.mocked(select)
      .mockResolvedValueOnce('deepseek/deepseek-chat')
      .mockResolvedValueOnce('off');

    await runLogin(['login', '--provider', 'deepseek']);

    expect(select).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Select a provider' }),
    );
    expect(mockSetConfig).toHaveBeenCalled();
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
  });

  it('--provider with an unknown value exits non-zero, names the input, and never runs the picker', async () => {
    await runLogin(['login', '--provider', 'nope']);

    expect(select).not.toHaveBeenCalled();
    const chunks = writtenChunks();
    expect(chunks.some((chunk: string) => chunk.includes('Unknown provider "nope"'))).toBe(true);
    // The valid ids follow, so the user can retry with a real value.
    expect(chunks.some((chunk: string) => chunk.includes('kimi-code'))).toBe(true);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  it('refuses to prompt when stdin is not a TTY and exits non-zero', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: false });

    await runLogin(['login']);

    expect(select).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
    const chunks = writtenChunks();
    // The TTY gate is unconditional — --provider cannot rescue a non-interactive
    // run, so the message must not imply that it can.
    expect(chunks.some((chunk: string) => chunk.includes('interactive terminal'))).toBe(true);
    expect(chunks.some((chunk: string) => chunk.includes('--provider'))).toBe(false);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  it('exits 1 when the provider picker is cancelled, without writing config', async () => {
    vi.mocked(select).mockResolvedValueOnce(CANCEL);
    mockStatus.mockResolvedValue({ providers: [] });

    await runLogin(['login']);

    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockSetConfig).not.toHaveBeenCalled();
    expect(mockRemoveProvider).not.toHaveBeenCalled();
    const chunks = writtenChunks();
    expect(chunks.some((chunk: string) => chunk.includes('Login cancelled.'))).toBe(true);
    expect(exitSpy.mock.calls[0]?.[0]).toBe(1);
  });

  // Every other case here drives the OAuth path. API-key login is the path most
  // providers use — and the only one left once managed OAuth is gone — so its
  // exit code needs its own cover.
  it('exits 0 after a successful API-key login on an open platform', async () => {
    mockStatus.mockResolvedValue({ providers: [] });
    mockGetConfig.mockResolvedValue({ providers: {}, models: {} });
    vi.mocked(password).mockResolvedValue('sk-test-key');
    mockFetchOpenPlatformModels.mockResolvedValue([
      { id: 'glm-4', name: 'GLM 4', contextLength: 128_000 },
    ]);
    // The model select's value is the `<platform>/<model>` alias, not the bare id.
    vi.mocked(select)
      .mockResolvedValueOnce('glm-zai-coding/glm-4')
      .mockResolvedValueOnce('off');

    await runLogin(['login', '--provider', 'glm-zai-coding']);

    expect(mockSetConfig).toHaveBeenCalled();
    expect(exitSpy.mock.calls[0]?.[0]).toBe(0);
  });
});
