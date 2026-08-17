/**
 * `ICodexLoginService` — browser-mediated OpenAI Codex sign-in for clients
 * with no terminal.
 *
 * The CLI runs this flow in one call (`runOpenAICodexOAuthFlow`) because it can
 * block on stdin. A web or desktop client cannot: it needs a URL to open and a
 * status to poll. So the flow splits into `start()` and `status()`, and the
 * token exchange, model fetch, and config write all stay on the server.
 * **Tokens never reach the client** — the status reply names the selected model
 * alias and nothing else.
 *
 * Two ways in, because only one of them always works:
 *   - Loopback. `startOpenAICodexCallbackServer` binds `127.0.0.1:1455`, the
 *     redirect URI registered for this client id. It needs the browser and the
 *     server on one host, with the port free.
 *   - Manual paste. When the port is taken — a `codex login` or an abandoned
 *     attempt holds it — or the browser sits on another machine, no callback
 *     arrives, and `submitCode()` takes the redirect URL from the user.
 * `start()` reports which one applies through `loopback`, and `submitCode()`
 * works either way, so a loopback that fails silently still has a way out.
 *
 * One login runs at a time. Starting a second cancels the first, which releases
 * port 1455; without that an abandoned attempt would block every later one
 * until its timeout.
 */

import { createDecorator } from '../../di';
import type { CodexLoginStart, CodexLoginStatus } from '@pymodel/protocol';

export interface ICodexLoginService {
  readonly _serviceBrand: undefined;

  /**
   * Build the authorize URL and arm the callback listener, cancelling any
   * login still in flight.
   */
  start(): Promise<CodexLoginStart>;

  /** Current state of `loginId`. Throws `CodexLoginNotFoundError` if unknown. */
  status(loginId: string): CodexLoginStatus;

  /**
   * Finish a login from a pasted redirect URL, query string, or bare code.
   * Resolves once the config is written.
   */
  submitCode(loginId: string, redirectUrl: string): Promise<CodexLoginStatus>;

  /** Drop the login and release the callback listener. */
  cancel(loginId: string): CodexLoginStatus;
}

// eslint-disable-next-line @typescript-eslint/no-redeclare
export const ICodexLoginService = createDecorator<ICodexLoginService>(
  'codexLoginService',
);

/** `40416 codex_login.not_found` — unknown or already-discarded login id. */
export class CodexLoginNotFoundError extends Error {
  readonly loginId: string;

  constructor(loginId: string) {
    super(`codex login ${loginId} is not in flight`);
    this.name = 'CodexLoginNotFoundError';
    this.loginId = loginId;
  }
}

/** `40001 validation.failed` — the pasted redirect carried no usable code. */
export class CodexLoginInvalidCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexLoginInvalidCodeError';
  }
}
