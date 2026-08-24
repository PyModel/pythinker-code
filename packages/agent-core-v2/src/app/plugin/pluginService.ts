
import { Service } from '#/_base/di/service';
import { AsyncEmitter, Emitter, type Event } from '#/_base/event';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { BugIndicatingError, Error2, PluginErrors } from '#/errors';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IProviderService } from '#/kosong/provider/provider';
import { ISkillDiscovery } from '#/app/skillCatalog/skillDiscovery';
import type { HookDef } from '#/features/externalHooks/internal/types';
import type { McpServerConfig } from '#/mcpCore/config-schema';
import type { SkillRoot } from '#/app/skillCatalog/types';

import { PluginManager } from './manager';
import {
  type GetPluginInfoInput,
  type InstallPluginInput,
  IPluginService,
  type RemovePluginInput,
  type SetPluginEnabledInput,
  type SetPluginMcpServerEnabledInput,
} from './plugin';
import type {
  EnabledPluginSessionStart,
  EnabledPluginSystemPrompt,
  PluginCommandDef,
  PluginInfo,
  PluginAgentRoot,
  PluginMcpServerEntry,
  PluginMutation,
  PluginMutationSummary,
  PluginReloadEvent,
  PluginSummary,
  PluginUpdateStatus,
  ReloadSummary,
} from './types';

const NO_ABORT = new AbortController().signal;

interface PluginReloadNotification {
  readonly summary: ReloadSummary;
  readonly delivery: Promise<void>;
}

interface PluginMutationOutcome<T> {
  readonly result: T;
  readonly notification: PluginReloadNotification;
}

export class PluginService extends Service implements IPluginService {
  declare readonly _serviceBrand: undefined;

  private readonly homeDir: string;
  private readonly manager: PluginManager;
  private initialLoadPromise: Promise<void> | undefined;
  private snapshotLoaded = false;
  private loadError: Error | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly onDidReloadEmitter = this._register(new AsyncEmitter<PluginReloadEvent>());
  private readonly onDidMutateEmitter = this._register(new Emitter<PluginMutationSummary>());

  readonly onDidReload: Event<PluginReloadEvent> = this.onDidReloadEmitter.event;
  readonly onDidMutate: Event<PluginMutationSummary> = this.onDidMutateEmitter.event;

  constructor(
    @IBootstrapService bootstrap: IBootstrapService,
    @ISkillDiscovery discovery: ISkillDiscovery,
    @IProviderService private readonly providers: IProviderService,
  ) {
    super();
    this.homeDir = bootstrap.homeDir;
    this.manager = new PluginManager({
      pythinkerHomeDir: this.homeDir,
      discoverSkills: (roots) => discovery.discover(roots),
    });
  }

  listPlugins(): Promise<readonly PluginSummary[]> {
    return this.runManagementRead(async () => this.manager.summaries());
  }

  installPlugin(input: InstallPluginInput): Promise<PluginSummary> {
    return this.runNotifiedMutation(async () => {
      const record = await this.manager.install(input.source);
      const info = this.manager.info(record.id);
      if (info === undefined)
        throw new BugIndicatingError(`Plugin "${record.id}" missing right after install`);
      const notification = await this.reloadAndNotify({
        mutation: { kind: 'install', id: record.id },
      });
      return { result: info, notification };
    });
  }

  setPluginEnabled(input: SetPluginEnabledInput): Promise<void> {
    return this.runNotifiedMutation(async () => {
      await this.manager.setEnabled(input.id, input.enabled);
      const notification = await this.reloadAndNotify({
        mutation: { kind: input.enabled ? 'enable' : 'disable', id: input.id },
      });
      return { result: undefined, notification };
    });
  }

  setPluginMcpServerEnabled(input: SetPluginMcpServerEnabledInput): Promise<void> {
    return this.runNotifiedMutation(async () => {
      await this.manager.setMcpServerEnabled(input.id, input.server, input.enabled);
      const notification = await this.reloadAndNotify({
        mutation: { kind: 'mcp-server', id: input.id },
      });
      return { result: undefined, notification };
    });
  }

  removePlugin(input: RemovePluginInput): Promise<void> {
    return this.runNotifiedMutation(async () => {
      await this.manager.remove(input.id);
      const notification = await this.reloadAndNotify({
        mutation: { kind: 'remove', id: input.id },
      });
      return { result: undefined, notification };
    });
  }

  reloadPlugins(): Promise<ReloadSummary> {
    const reload = this.awaitReloadDelivery(
      this.enqueueMutation(async () => {
        try {
          const notification = await this.reloadAndNotify();
          return { result: notification.summary, notification };
        } catch (error) {
          this.loadError = error instanceof Error ? error : new Error(String(error));
          throw new Error2(
            PluginErrors.codes.PLUGIN_LOAD_FAILED,
            `Failed to reload plugins: ${this.loadError.message}`,
            { cause: this.loadError, details: { pythinkerHomeDir: this.homeDir } },
          );
        }
      }),
    );
    this.initialLoadPromise ??= reload.then(
      () => undefined,
      () => undefined,
    );
    return reload;
  }

  private async reloadAndNotify(options?: {
    readonly mutation: PluginMutation;
  }): Promise<PluginReloadNotification> {
    const summary = await this.manager.reload();
    this.snapshotLoaded = true;
    this.loadError = undefined;
    const delivery = this.onDidReloadEmitter.fireAsyncConcurrent(summary, NO_ABORT);
    if (options?.mutation !== undefined)
      this.onDidMutateEmitter.fire({ ...summary, mutation: options.mutation });
    return { summary, delivery };
  }

  private runNotifiedMutation<T>(operation: () => Promise<PluginMutationOutcome<T>>): Promise<T> {
    return this.awaitReloadDelivery(this.runSerializedOperation(operation));
  }

  private async awaitReloadDelivery<T>(operation: Promise<PluginMutationOutcome<T>>): Promise<T> {
    const { result, notification } = await operation;
    await notification.delivery;
    return result;
  }

  getPluginInfo(input: GetPluginInfoInput): Promise<PluginInfo> {
    return this.runManagementRead(async () => {
      const info = this.manager.info(input.id);
      if (info === undefined) {
        throw new Error2(
          PluginErrors.codes.PLUGIN_NOT_FOUND,
          `Plugin "${input.id}" is not installed`,
          { details: { id: input.id } },
        );
      }
      return info;
    });
  }

  listPluginCommands(): Promise<readonly PluginCommandDef[]> {
    return this.runSerializedOperation(async () => this.manager.enabledCommands());
  }

  checkUpdates(): Promise<readonly PluginUpdateStatus[]> {
    return this.runManagementRead(async () => this.manager.checkUpdates());
  }

  pluginSkillRoots(): Promise<readonly SkillRoot[]> {
    return this.runConsumptionRead([], async () => this.manager.pluginSkillRoots());
  }

  pluginAgentRoots(): Promise<readonly PluginAgentRoot[]> {
    return this.runConsumptionRead([], async () => this.manager.pluginAgentRoots());
  }

  enabledSessionStarts(): Promise<readonly EnabledPluginSessionStart[]> {
    return this.runConsumptionRead([], async () => this.manager.enabledSessionStarts());
  }

  enabledSystemPrompts(): Promise<readonly EnabledPluginSystemPrompt[]> {
    return this.runConsumptionRead([], async () => this.manager.enabledSystemPrompts());
  }

  enabledMcpServers(): Promise<Record<string, McpServerConfig>> {
    return this.runConsumptionRead({}, async () => this.manager.enabledMcpServers());
  }

  mcpServerEntries(): Promise<readonly PluginMcpServerEntry[]> {
    return this.runManagementRead(async () => this.manager.mcpServerEntries());
  }

  enabledHooks(): Promise<readonly HookDef[]> {
    return this.runConsumptionRead([], async () => this.manager.enabledHooks());
  }

  hasLoadedSnapshot(): boolean {
    return this.snapshotLoaded;
  }

  private runSerializedOperation<T>(operation: () => Promise<T>): Promise<T> {
    void this.startInitialLoad();
    return this.enqueueMutation(async () => {
      this.assertLoaded();
      return operation();
    });
  }

  private async runManagementRead<T>(operation: () => Promise<T>): Promise<T> {
    await this.waitForPendingMutations();
    this.assertLoaded();
    return operation();
  }

  private async runConsumptionRead<T>(fallback: T, operation: () => Promise<T>): Promise<T> {
    await this.waitForPendingMutations();
    if (!this.snapshotLoaded) return fallback;
    return operation();
  }

  private async waitForPendingMutations(): Promise<void> {
    void this.startInitialLoad();
    await this.mutationQueue;
  }

  private startInitialLoad(): Promise<void> {
    this.initialLoadPromise ??= this.enqueueMutation(async () => {
      await this.loadOnce();
    });
    return this.initialLoadPromise;
  }

  private async loadOnce(): Promise<void> {
    try {
      await this.manager.load();
      this.snapshotLoaded = true;
      this.loadError = undefined;
    } catch (error) {
      this.loadError = error instanceof Error ? error : new Error(String(error));
    }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertLoaded(): void {
    if (this.loadError === undefined) return;
    throw new Error2(
      PluginErrors.codes.PLUGIN_LOAD_FAILED,
      `Plugin state failed to load: ${this.loadError.message}. ` +
        `Fix the file at ${this.homeDir}/plugins/installed.json and run /plugins reload.`,
      { cause: this.loadError, details: { pythinkerHomeDir: this.homeDir } },
    );
  }

}

registerScopedService(
  LifecycleScope.App,
  IPluginService,
  PluginService,
  ScopeActivation.OnScopeCreated,
  'plugin',
);
