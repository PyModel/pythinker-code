/** A persisted OAuth token bundle. */
export interface TokenInfo {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Unix seconds when access_token expires. */
  readonly expiresAt: number;
  readonly scope: string;
  readonly tokenType: string;
  /** Original expires_in from server response (seconds). */
  readonly expiresIn: number;
}

/** JSON wire format for token persistence (snake_case, Python-compatible). */
export interface TokenInfoWire {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_at: number;
  readonly scope: string;
  readonly token_type: string;
  readonly expires_in: number;
}

export function tokenToWire(token: TokenInfo): TokenInfoWire {
  return {
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt,
    scope: token.scope,
    token_type: token.tokenType,
    expires_in: token.expiresIn,
  };
}

export function tokenFromWire(wire: Partial<TokenInfoWire>): TokenInfo {
  return {
    accessToken: wire.access_token ?? '',
    refreshToken: wire.refresh_token ?? '',
    expiresAt: typeof wire.expires_at === 'number' ? wire.expires_at : 0,
    scope: wire.scope ?? '',
    tokenType: wire.token_type ?? '',
    expiresIn: typeof wire.expires_in === 'number' ? wire.expires_in : 0,
  };
}
