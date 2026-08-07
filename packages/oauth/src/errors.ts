/**
 * OAuth error classes.
 *
 * All errors derive from {@link OAuthError}. Distinguishing subclasses let
 * callers react appropriately:
 *  - `OAuthUnauthorizedError`: 401/403 from token endpoint → refresh_token
 *    or credentials are bad; drive user through `/login` again.
 *  - `OAuthConnectionError`: transport-level OAuth request failure; callers
 *    may retry the operation.
 */

export class OAuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OAuthError';
  }
}

export class OAuthUnauthorizedError extends OAuthError {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthUnauthorizedError';
  }
}

export class OAuthConnectionError extends OAuthError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OAuthConnectionError';
  }
}



