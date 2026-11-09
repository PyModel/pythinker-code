import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { ISessionMetadata } from '#/session/sessionMetadata/sessionMetadata';

import { ISessionTitleService, type SessionTitleSource } from './sessionTitle';

export class SessionTitleService implements ISessionTitleService {
  declare readonly _serviceBrand: undefined;

  constructor(@ISessionMetadata private readonly metadata: ISessionMetadata) {}

  async generateTitle(opts?: {
    force?: boolean;
    source?: SessionTitleSource;
  }): Promise<string | undefined> {
    void opts?.source;
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
