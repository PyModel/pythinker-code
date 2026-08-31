import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IFlagService } from '#/app/flag/flag';
import { ISessionMetadata } from '#/session/sessionMetadata/sessionMetadata';

import { AUTO_SESSION_TITLE_FLAG_ID } from './flag';
import { ISessionTitleService, type SessionTitleSource } from './sessionTitle';

export class SessionTitleService implements ISessionTitleService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @ISessionMetadata private readonly metadata: ISessionMetadata,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  async generateTitle(opts?: {
    force?: boolean;
    source?: SessionTitleSource;
  }): Promise<string | undefined> {
    if (!this.flags.enabled(AUTO_SESSION_TITLE_FLAG_ID)) return undefined;
    if (opts?.force !== true) {
      const current = await this.metadata.read();
      if (current.titleKind === 'custom') return undefined;
      if (current.titleKind === 'generated') return undefined;
    }
    return undefined;
  }
}

registerScopedService(
  LifecycleScope.Session,
  ISessionTitleService,
  SessionTitleService,
  ScopeActivation.OnScopeCreated,
  'sessionTitle',
);
