import { registerErrorDomain, type ErrorDomain } from '#/_base/errors/codes';

export const CodexLoginErrors = {
  codes: {
    CODEX_LOGIN_NOT_FOUND: 'codex_login.not_found',
    CODEX_LOGIN_INVALID_CODE: 'codex_login.invalid_code',
  },
} as const satisfies ErrorDomain;

registerErrorDomain(CodexLoginErrors);
