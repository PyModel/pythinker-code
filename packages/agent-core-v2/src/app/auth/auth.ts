import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Error2 } from '#/_base/errors/errors';

import type { OAuthRef } from '#/kosong/provider/provider';

import { AuthErrors } from './errors';

export interface AuthStatus {
  readonly loggedIn: boolean;
  readonly provider: string;
}

export interface OAuthBearerTokenProvider {
  getAccessToken(options?: { readonly force?: boolean }): Promise<string>;
}

export interface IOAuthTokenService {
  readonly _serviceBrand: undefined;

  status(provider: string, oauthRef: OAuthRef): Promise<AuthStatus>;
  resolveTokenProvider(provider: string, oauthRef: OAuthRef): OAuthBearerTokenProvider | undefined;
  getCachedAccessToken(provider: string, oauthRef: OAuthRef): Promise<string | undefined>;
}

export const IOAuthTokenService: ServiceIdentifier<IOAuthTokenService> =
  createDecorator<IOAuthTokenService>('oauthTokenService');

export interface IAuthSummaryService {
  readonly _serviceBrand: undefined;

  summarize(): Promise<readonly AuthStatus[]>;
  ensureReady(modelOverride?: string): Promise<void>;
}

export const IAuthSummaryService: ServiceIdentifier<IAuthSummaryService> =
  createDecorator<IAuthSummaryService>('authSummaryService');

export class AuthProvisioningRequiredError extends Error2 {
  constructor() {
    super(
      AuthErrors.codes.AUTH_PROVISIONING_REQUIRED,
      'no provider configured; configure one through a supported sign-in flow or the providers endpoint',
      { name: 'AuthProvisioningRequiredError' },
    );
  }
}

export class AuthTokenMissingError extends Error2 {
  readonly providerId: string;

  constructor(providerId: string) {
    super(
      AuthErrors.codes.AUTH_TOKEN_MISSING,
      `provider ${providerId} has no usable credential configured`,
      { details: { provider_id: providerId }, name: 'AuthTokenMissingError' },
    );
    this.providerId = providerId;
  }
}

export class AuthModelNotResolvedError extends Error2 {
  readonly modelId: string | undefined;
  readonly providerId: string | undefined;

  constructor(modelId: string | undefined, providerId?: string) {
    const details: Record<string, unknown> = {};
    if (modelId !== undefined) details['model_id'] = modelId;
    if (providerId !== undefined) details['provider_id'] = providerId;
    super(
      AuthErrors.codes.AUTH_MODEL_NOT_RESOLVED,
      modelId === undefined
        ? 'no default model configured'
        : `model ${modelId} does not resolve to a configured provider`,
      {
        details: Object.keys(details).length === 0 ? undefined : details,
        name: 'AuthModelNotResolvedError',
      },
    );
    this.modelId = modelId;
    this.providerId = providerId;
  }
}
