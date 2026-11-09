import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import { Error2 } from '#/_base/errors/errors';

import type { CodexLoginStart, CodexLoginStatus } from './codexLoginProtocol';
import { CodexLoginErrors } from './errors';

export interface ICodexLoginService {
  readonly _serviceBrand: undefined;

  start(): Promise<CodexLoginStart>;
  status(loginId: string): CodexLoginStatus;
  submitCode(loginId: string, redirectUrl: string): Promise<CodexLoginStatus>;
  cancel(loginId: string): CodexLoginStatus;
}

export const ICodexLoginService: ServiceIdentifier<ICodexLoginService> =
  createDecorator<ICodexLoginService>('codexLoginService');

export class CodexLoginNotFoundError extends Error2 {
  constructor(loginId: string) {
    super(
      CodexLoginErrors.codes.CODEX_LOGIN_NOT_FOUND,
      `codex login ${loginId} is not in flight`,
      { details: { login_id: loginId }, name: 'CodexLoginNotFoundError' },
    );
  }
}

export class CodexLoginInvalidCodeError extends Error2 {
  constructor(message: string) {
    super(CodexLoginErrors.codes.CODEX_LOGIN_INVALID_CODE, message, {
      name: 'CodexLoginInvalidCodeError',
    });
  }
}
