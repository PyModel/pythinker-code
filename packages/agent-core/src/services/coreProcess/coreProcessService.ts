/**
 * `CoreProcessService` — implementation of `ICoreProcessService`.
 */

import { createRPC, PythinkerCore } from '../../rpc';
import type { ImageLimits } from '../../tools/support/image-limits';
import { Disposable, registerSingleton, SyncDescriptor } from '../../di';
import type { CoreAPI, CoreRPC, SDKAPI } from '../../rpc';
import type { OAuthTokenProviderResolver } from '../../session/provider-manager';
import { noopTelemetryClient, type TelemetryClient } from '../../telemetry';
import {
  createPythinkerDefaultHeaders,
  type PythinkerHostIdentity,
} from '@pymodel/pythinker-code-oauth';

import { OAuthTokenReader } from '../auth/oauthToken';
import { BridgeClientAPI } from './coreProcessClient';
import { IApprovalService } from '../approval/approval';
import { IEnvironmentService } from '../environment/environment';
import { IEventService } from '../event/event';
import { ILogService } from '../logger/logger';
import { IQuestionService } from '../question/question';
import { IWorkspaceRegistry } from '../workspace/workspaceRegistry';
import { ICoreProcessService, type CoreProcessServiceOptions } from './coreProcess';

export class CoreProcessService extends Disposable implements ICoreProcessService {
  readonly _serviceBrand: undefined;

  /**
   * Service-facing RPC handle. This is a `Proxy` over the awaited
   * `RPCMethods<CoreAPI>` so callers don't have to await a promise themselves
   * — `core.rpc.createSession({...})` returns a `Promise<SessionSummary>`
   * directly. After dispose, the proxy rejects on every method invocation.
   */
  public readonly rpc: CoreRPC;

  public readonly pythinkerRequestHeaders: Record<string, string> | undefined;

  public readonly telemetry: TelemetryClient;

  /** The core's owner-scoped [image] limits; see ICoreProcessService. */
  public get imageLimits(): ImageLimits {
    return this._core.imageLimits;
  }

  /**
   * The in-process `PythinkerCore` instance. Kept private so daemon-side code can't
   * grab it and bypass the peer-service indirection.
   */
  private readonly _core: PythinkerCore;

  /**
   * Promise that resolves to the resolved RPC methods. The `rpc` proxy awaits
   * this on every dispatch (cheap — controlled-promise resolves synchronously
   * on the second call).
   */
  private readonly _coreRpcPromise: Promise<CoreRPC>;

  /**
   * Cached readiness signal. We treat "SDK-side RPC bound" as the readiness
   * marker today; once `PythinkerCore.pluginsReady` is publicly exposed we can
   * combine them here.
   */
  private readonly _ready: Promise<void>;

  constructor(
    options: CoreProcessServiceOptions,
    @IEnvironmentService env: IEnvironmentService,
    @IEventService eventService: IEventService,
    @IApprovalService approvalService: IApprovalService,
    @IQuestionService questionService: IQuestionService,
    @ILogService logService: ILogService,
    @IWorkspaceRegistry workspaceRegistry: IWorkspaceRegistry,
  ) {
    super();

    // 1. Build the in-process RPC pair. Left/Right are typed; `coreRpc` is the
    //    function PythinkerCore receives, `sdkRpc` is the one we satisfy.
    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();

    const resolveOAuthTokenProvider: OAuthTokenProviderResolver =
      options.resolveOAuthTokenProvider ??
      CoreProcessService._defaultOAuthTokenResolver(env.homeDir);

    // Default-wire the product User-Agent without device identity headers.
    // Mirrors the in-process TUI path in SDKRpcClient.
    // Caller-supplied `pythinkerRequestHeaders` always wins; absent that, we
    // synthesize from `options.identity`. Hosts that pass neither
    // (no identity, no headers) still construct — but their requests will
    // trip the 40340 guard.
    this.pythinkerRequestHeaders =
      options.pythinkerRequestHeaders ??
      CoreProcessService._defaultPythinkerRequestHeaders(env.homeDir, options.identity);
    this.telemetry = options.telemetry ?? noopTelemetryClient;

    // `appVersion` flows into Session records (`app_version`) and tool
    // call ctx. Prefer explicit > identity.version so callers can pin
    // a different value if they need to.
    const appVersion: string | undefined =
      options.appVersion ?? options.identity?.version;

    // Default-wire the workspace-id resolver. Without it, PythinkerCore's session
    // store mints a bucket hash from the workDir string as-is, so a case/slash
    // variant of a registered Windows root splits sessions into a second
    // bucket that the registered workspace cannot page. The registry's
    // identity-aware lookup reuses the registered id. Caller-supplied
    // `resolveWorkspaceId` always wins — same override contract as
    // `resolveOAuthTokenProvider` above.
    const resolveWorkspaceId =
      options.resolveWorkspaceId ??
      ((workDir: string) => workspaceRegistry.findWorkspaceIdByRoot(workDir));

    // 2. Construct the core. PythinkerCore's ctor wires itself into `coreRpc` and
    //    exposes `this.sdk: Promise<SDKRPC>` for the reverse direction.
    this._core = new PythinkerCore(coreRpc, {
      ...options,
      homeDir: env.homeDir,
      configPath: env.configPath,
      pythinkerRequestHeaders: this.pythinkerRequestHeaders,
      appVersion,
      resolveOAuthTokenProvider,
      resolveWorkspaceId,
    });

    // 3. Satisfy the SDK side with a BridgeClientAPI that routes to peer services.
    //    sdkRpc returns Promise<RPCMethods<CoreAPI>> — these are the methods
    //    in-package services will dispatch on.
    const clientApi = new BridgeClientAPI({
      eventService,
      approvalService,
      questionService,
      logService,
    });
    this._coreRpcPromise = sdkRpc(clientApi);

    // 4. Readiness is "the RPC pair is bound on both sides". Plugin load
    //    happens inside PythinkerCore's ctor and self-heals (the worker captures
    //    the error rather than surfacing it; see core-impl.ts:170-172).
    this._ready = this._coreRpcPromise.then(() => undefined);

    // 5. Build the dispatch proxy. Each method on the proxy awaits the resolved
    //    RPC methods then forwards. After dispose, dispatch rejects eagerly.
    this.rpc = this._buildRpcProxy();
  }

  async ready(): Promise<void> {
    return this._ready;
  }

  override dispose(): void {
    if (this._store.isDisposed) return;
    // PythinkerCore does not currently expose a dispose() — when it does, we'll
    // await/call it here BEFORE super.dispose(). For now, disposing the
    // service flips _disposed, which makes future rpc.* invocations reject
    // before they reach PythinkerCore.
    super.dispose();
  }

  private _buildRpcProxy(): CoreRPC {
    const rpcPromise = this._coreRpcPromise;
    const isDisposedRef = () => this._store.isDisposed;

    // We don't know the concrete method set at compile time here (CoreAPI is
    // a structural interface; `RPCMethods<CoreAPI>` is a mapped type).
    // The Proxy lets us intercept every property access and return a function
    // that awaits the underlying RPC and forwards.
    return new Proxy({} as CoreRPC, {
      get(_target, prop) {
        // Symbols / well-known properties (Symbol.toPrimitive, then-able
        // probe, etc.) should not be RPC-dispatched.
        if (typeof prop !== 'string') return undefined;
        // Returning a function keeps `typeof rpc.foo === 'function'` true,
        // which downstream code may probe.
        return (...args: unknown[]) => {
          if (isDisposedRef()) {
            return Promise.reject(new Error('CoreProcessService has been disposed'));
          }
          return rpcPromise.then((methods) => {
            const fn = (methods as unknown as Record<string, unknown>)[prop];
            if (typeof fn !== 'function') {
              throw new Error(`CoreProcessService.rpc.${prop} is not a function`);
            }
            return (fn as (...args: unknown[]) => unknown)(...args);
          });
        };
      },
    });
  }

  static _defaultOAuthTokenResolver(homeDir: string): OAuthTokenProviderResolver {
    return new OAuthTokenReader(homeDir).resolveOAuthTokenProvider;
  }

  /**
   * Build the default `pythinkerRequestHeaders` from `options.identity` so the
   * outbound User-Agent identifies this process (for example,
   * `pythinker-code-cli/<ver>`). Device identity headers stay absent.
   *
   * Returns `undefined` when no identity is provided — preserves the
   * pre-fix contract for hosts that pass headers explicitly via
   * `options.pythinkerRequestHeaders` (or for legacy callers / tests that
   * do not send provider requests).
   *
   * Exposed as `static` so tests can assert the wiring without booting
   * the service.
   */
  static _defaultPythinkerRequestHeaders(
    homeDir: string,
    identity?: PythinkerHostIdentity,
  ): Record<string, string> | undefined {
    if (identity === undefined) return undefined;
    return createPythinkerDefaultHeaders({
      homeDir,
      ...identity,
    });
  }
}

// Self-register under the global singleton registry. Ctor signature is
// `(options, @IEnvironmentService, @IEventService, @IApprovalService,
//  @IQuestionService, @ILogService, @IWorkspaceRegistry)` — the leading
// `options` slot is a pure data bag so we
// register with `[{}]` as a sane default. Daemon-side `start.ts` overrides
// this descriptor via `services.set(ICoreProcessService, new
// SyncDescriptor(CoreProcessService, [opts.coreProcessOptions ?? {}], false))`
// when it has access to the real options bag. Later registrations win — both
// at registry level and at `ServiceCollection` level.
// `supportsDelayedInstantiation = false` preserves current reverse-dispose
// semantics.
registerSingleton(
  ICoreProcessService,
  new SyncDescriptor(CoreProcessService, [{} as CoreProcessServiceOptions], false),
);
