import type { PythinkerErrorCode } from './codes';

export interface PythinkerErrorOptions {
  /** JSON-serializable structured details. */
  readonly details?: Record<string, unknown>;
  /** Original error or value. Local-only; never serialized to the wire. */
  readonly cause?: unknown;
}

/**
 * The single Pythinker error class.
 *
 * Discrimination is always by `code`. Cross-process consumers receive
 * `PythinkerErrorPayload` and must branch on `code` rather than class identity.
 */
export class PythinkerError extends Error {
  readonly code: PythinkerErrorCode;
  readonly details?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(code: PythinkerErrorCode, message: string, options: PythinkerErrorOptions = {}) {
    super(message);
    this.name = 'PythinkerError';
    this.code = code;
    this.details = options.details;
    this.cause = options.cause;
  }
}
