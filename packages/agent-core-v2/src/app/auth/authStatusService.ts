import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { IModelService } from '#/kosong/model/model';
import { IProviderService } from '#/kosong/provider/provider';

import type { AuthSummary } from './authStatus';
import { IAuthStatusService } from './authStatus';

export class AuthStatusService implements IAuthStatusService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IProviderService private readonly providerService: IProviderService,
    @IModelService private readonly modelService: IModelService,
  ) {}

  async get(): Promise<AuthSummary> {
    await this.modelService.ready;
    const providers_count = Object.keys(this.providerService.list()).length;
    const default_model = nonEmpty(this.modelService.getDefaultModel());
    return {
      ready: providers_count >= 1 && default_model !== null,
      providers_count,
      default_model,
    };
  }
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

registerScopedService(
  LifecycleScope.App,
  IAuthStatusService,
  AuthStatusService,
  ScopeActivation.OnScopeCreated,
  'authStatus',
);
