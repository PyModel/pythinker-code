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
  type RPCMethods,
  type SDKAPI,
  type TelemetryClient,
} from '@pymodel/agent-core';
import type { Kaos } from '@pymodel/kaos';
import { assertPythinkerHostIdentity, createPythinkerDefaultHeaders } from '@pymodel/pythinker-code-oauth';

import { PythinkerHarness } from '#/pythinker-harness';
import { ClientAPI, SDKRpcClientBase } from '#/rpc';
import type {
  CreateSessionOptions,
  PythinkerHarnessOptions,
  PythinkerHostIdentity,
  ResumeSessionInput,
  ResumedSessionSummary,
  SessionSummary,
} from '#/types';

export interface SDKRpcClientOptions {
  readonly homeDir?: string;
  readonly configPath?: string;
  readonly identity?: PythinkerHostIdentity;
  readonly skillDirs?: readonly string[];
  readonly telemetry?: TelemetryClient;
}

export class SDKRpcClient extends SDKRpcClientBase {
  readonly homeDir: string;
  readonly configPath: string;
  readonly identity: PythinkerHostIdentity | undefined;
  readonly telemetry: TelemetryClient;
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

    void getRootLogger().configure(resolveLoggingConfig({ homeDir: this.homeDir }));

    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();
    this.core = new PythinkerCore(coreRpc, {
      homeDir: options.homeDir,
      configPath: this.configPath,
      pythinkerRequestHeaders: this.createPythinkerRequestHeaders(),
      skillDirs: options.skillDirs,
      telemetry: this.telemetry,
      appVersion: this.identity?.version,
    });
    this.ready = sdkRpc(new ClientAPI(this));
  }

  async ensureConfigFile(): Promise<void> {
    await ensureConfigFile(this.configPath);
  }

  async close(): Promise<void> {
    await this.core.close();
    try {
      await getRootLogger().flush();
    } catch {
      // never let logger flush block process exit
    }
  }

  protected async getRpc(): Promise<RPCMethods<CoreAPI>> {
    return this.ready;
  }

  override async createSessionWithKaos(
    input: CreateSessionOptions,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<SessionSummary> {
    const { planMode, ...coreInput } = input;
    void planMode;
    return this.core.createSessionWithOverrides(coreInput, { kaos, persistenceKaos });
  }

  override async resumeSessionWithKaos(
    input: ResumeSessionInput,
    kaos: Kaos,
    persistenceKaos?: Kaos,
  ): Promise<ResumedSessionSummary> {
    return this.core.resumeSessionWithOverrides(
      { ...input, sessionId: input.id },
      { kaos, persistenceKaos },
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
    telemetry: rpc.telemetry,
    ensureConfigFile: () => rpc.ensureConfigFile(),
    onClose: () => rpc.close(),
  });
}
