import { existsSync } from 'node:fs';

import { join } from 'pathe';
import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Disposable, DisposableStore } from '#/_base/di/lifecycle';
import { Emitter, type Event } from '#/_base/event';
import { TimeoutTimer } from '#/_base/utils/timer';
import { subtreeWatchFilter } from '#/_base/utils/paths';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { IHostFsWatchService } from '#/os/interface/hostFsWatch';

import {
  MERGE_ALL_AVAILABLE_SKILLS_SECTION,
  type MergeAllAvailableSkillsConfig,
} from './configSection';
import { ISkillDiscovery } from './skillDiscovery';
import { userRoots } from './skillRoots';
import { SKILL_SOURCE_PRIORITY, type ISkillSource, type SkillContribution } from './skillSource';

export interface IUserFileSkillSource extends ISkillSource {
  readonly _serviceBrand: undefined;
}

export const IUserFileSkillSource: ServiceIdentifier<IUserFileSkillSource> =
  createDecorator<IUserFileSkillSource>('userFileSkillSource');

const WATCH_DEBOUNCE_MS = 200;

export class UserFileSkillSource extends Disposable implements IUserFileSkillSource {
  declare readonly _serviceBrand: undefined;

  readonly id = 'user';
  readonly priority = SKILL_SOURCE_PRIORITY.user;
  private readonly onDidChangeEmitter = this._register(new Emitter<void>());
  readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
  private readonly watchDebounce = this._register(new TimeoutTimer());
  private readonly watchResources = this._register(new DisposableStore());
  private watchReady: Promise<void> = Promise.resolve();

  constructor(
    @ISkillDiscovery private readonly discovery: ISkillDiscovery,
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @IConfigService private readonly config: IConfigService,
    @IHostFsWatchService private readonly fsWatch: IHostFsWatchService,
  ) {
    super();
    this._register(
      this.config.onDidSectionChange((event) => {
        if (event.domain === MERGE_ALL_AVAILABLE_SKILLS_SECTION) this.onDidChangeEmitter.fire();
      }),
    );
    if ((this.bootstrap.args.skillDirs?.length ?? 0) === 0) {
      this.watchUserSkillRoots();
    }
  }

  async load(): Promise<SkillContribution> {
    await this.watchReady;
    if ((this.bootstrap.args.skillDirs?.length ?? 0) > 0) {
      return { skills: [] };
    }
    await this.config.ready;
    const mergeAllAvailableSkills =
      this.config.get<MergeAllAvailableSkillsConfig>(MERGE_ALL_AVAILABLE_SKILLS_SECTION) ?? true;
    return this.discovery.discover(
      await userRoots(this.bootstrap.homeDir, this.bootstrap.osHomeDir, { mergeAllAvailableSkills }),
    );
  }

  private watchUserSkillRoots(): void {
    const candidatesByBase = new Map<string, string[]>();
    for (const [base, root] of [
      [this.bootstrap.homeDir, join(this.bootstrap.homeDir, 'skills')],
      [this.bootstrap.osHomeDir, join(this.bootstrap.osHomeDir, '.agents', 'skills')],
    ] as const) {
      const existing = candidatesByBase.get(base);
      if (existing === undefined) candidatesByBase.set(base, [root]);
      else existing.push(root);
    }
    const ready: Promise<void>[] = [];
    for (const [base, candidates] of candidatesByBase) {
      if (!existsSync(base)) continue;
      const handle = this.fsWatch.watch(base, {
        ignored: subtreeWatchFilter(base, candidates),
        signal: true,
      });
      this.watchResources.add(handle);
      this.watchResources.add(
        handle.onDidChange(() => {
          this.watchDebounce.cancelAndSet(() => {
            this.onDidChangeEmitter.fire();
          }, WATCH_DEBOUNCE_MS);
        }),
      );
      ready.push(handle.ready);
    }
    this.watchReady = Promise.allSettled(ready).then(() => undefined);
  }
}

registerScopedService(
  LifecycleScope.App,
  IUserFileSkillSource,
  UserFileSkillSource,
  ScopeActivation.OnScopeCreated,
  'skillCatalog',
);
