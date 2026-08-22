import {
  createRPC,
  ensureConfigFile,
  getRootLogger,
  PythinkerCore,
  noopTelemetryClient,
  resolveConfigPath,
  resolvePythinkerHome,
  resolveLoggingConfig,
  type CoreAPI,
  type OAuthTokenProviderResolver,
  type RPCMethods,
  type SDKAPI,
  type TelemetryClient,
} from '@pymodel/agent-core';
import type { Pyaos } from '@pymodel/pyaos';
import { assertPythinkerHostIdentity, createPythinkerDefaultHeaders } from '@pymodel/pythinker-code-oauth';

import { PythinkerAuthFacade } from '#/auth';
import { PythinkerHarness } from '#/pythinker-harness';
import { ClientAPI, SDKRpcClientBase } from '#/rpc';
import type {
  CreateSessionOptions,
  PythinkerHarnessOptions,
  PythinkerHostIdentity,
  OAuthRefreshOutcome,
  ResumeSessionInput,
  ResumedSessionSummary,
  SessionSummary,
} from '#/types';

export interface SDKRpcClientOptions {
  readonly homeDir?: string;
  readonly configPath?: string;
  readonly identity?: PythinkerHostIdentity;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver;
  readonly skillDirs?: readonly string[];
  readonly telemetry?: TelemetryClient;
  readonly onOAuthRefresh?: (outcome: OAuthRefreshOutcome) => void;
  /**
   * Host UI mode (`'print'` for `pythinker -p`, `'cli'` for the TUI, ...). Forwarded
   * to the v1 core, which applies print-mode config defaults when it is
   * `'print'`.
   */
  readonly uiMode?: string;
}

export class SDKRpcClient extends SDKRpcClientBase {
  readonly homeDir: string;
  readonly configPath: string;
  readonly identity: PythinkerHostIdentity | undefined;
  readonly telemetry: TelemetryClient;
  readonly auth: PythinkerAuthFacade;
  readonly core: PythinkerCore;

  private readonly ready: Promise<RPCMethods<CoreAPI>>;

  constructor(options: SDKRpcClientOptions = {}) {
    super();
    this.identity =
      options.identity === undefined ? undefined : assertPythinkerHostIdentity(options.identity);
    this.homeDir = resolvePythinkerHome(options.homeDir);
    this.configPath = resolveConfigPath({
      homeDir: this.homeDir,
      configPath: options.configPath,
    });
    this.telemetry = options.telemetry ?? noopTelemetryClient;
    this.auth = new PythinkerAuthFacade({
      homeDir: this.homeDir,
      configPath: this.configPath,
      identity: this.identity,
      onRefresh: options.onOAuthRefresh,
    });

    void getRootLogger().configure(resolveLoggingConfig({ homeDir: this.homeDir }));

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    this.core = new PythinkerCore(coreRpc, {
      homeDir: options.homeDir,
      configPath: this.configPath,
      pythinkerRequestHeaders: this.createPythinkerRequestHeaders(),
      resolveOAuthTokenProvider:
        options.resolveOAuthTokenProvider ?? this.auth.resolveOAuthTokenProvider,
      skillDirs: options.skillDirs,
      telemetry: this.telemetry,
      appVersion: this.identity?.version,
      uiMode: options.uiMode,
    });
    this.ready = sdkRpc(new ClientAPI(this));
  }

  async ensureConfigFile(): Promise<void> {
    await ensureConfigFile(this.configPath);
  }

  async close(): Promise<void> {
    try {
      // Close live sessions and stop the shared MCP OAuth service (proactive
      // refresh timers, in-flight authorization flows) before flushing logs.
      await this.core.shutdown();
    } catch {
      // never let core shutdown block process exit
    }
    try {
      await getRootLogger().flush();
    } catch {
      // never let logger flush block process exit
    }
  }

  protected async getRpc(): Promise<RPCMethods<CoreAPI>> {
    return this.ready;
  }

  override async createSessionWithPyaos(
    input: CreateSessionOptions,
    pyaos: Pyaos,
    persistencePyaos?: Pyaos,
  ): Promise<SessionSummary> {
    const { planMode, ...coreInput } = input;
    void planMode;
    return this.core.createSessionWithOverrides(coreInput, { pyaos, persistencePyaos });
  }

  override async resumeSessionWithPyaos(
    input: ResumeSessionInput,
    pyaos: Pyaos,
    persistencePyaos?: Pyaos,
  ): Promise<ResumedSessionSummary> {
    return this.core.resumeSessionWithOverrides(
      { ...input, sessionId: input.id },
      { pyaos, persistencePyaos },
    );
  }

  private createPythinkerRequestHeaders(): Record<string, string> | undefined {
    if (this.identity === undefined) return undefined;
    return createPythinkerDefaultHeaders({
      homeDir: this.homeDir,
      ...this.identity,
    });
  }
}

export function createPythinkerHarness(options: PythinkerHarnessOptions): PythinkerHarness {
  const rpc = new SDKRpcClient(options);
  return new PythinkerHarness(rpc, {
    identity: rpc.identity,
    uiMode: options.uiMode,
    homeDir: rpc.homeDir,
    configPath: rpc.configPath,
    auth: rpc.auth,
    telemetry: rpc.telemetry,
    ensureConfigFile: () => rpc.ensureConfigFile(),
    onClose: () => rpc.close(),
    imageLimits: rpc.core.imageLimits,
    sessionStartedProperties: options.sessionStartedProperties,
  });
}
