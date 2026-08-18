import {
  APIConnectionError,
  APIEmptyResponseError,
  APIProviderQuotaExhaustedError,
  APIStatusError,
  APITimeoutError,
  ChatProviderError,
} from '@pymodel/kosong';

import { PythinkerError } from './classes';
import { ErrorCodes, PYTHINKER_ERROR_INFO, type PythinkerErrorCode } from './codes';

/**
 * Wire-safe payload of a Pythinker error.
 *
 * The structure passed across process / language boundaries (RPC, events,
 * telemetry, SDK wrappers). Class identity does not survive the boundary;
 * downstream code must branch on `code` rather than `instanceof`.
 *
 * `details` is JSON-serialized. `cause` is intentionally absent -- it is
 * local-only diagnostic state and must not cross the boundary.
 */
export interface PythinkerErrorPayload {
  readonly code: PythinkerErrorCode;
  readonly message: string;
  readonly name?: string;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;
}

/** Type guard for PythinkerError. */
export function isPythinkerError(error: unknown): error is PythinkerError {
  return error instanceof PythinkerError;
}

/**
 * Build a PythinkerErrorPayload directly from a code + message (no Error instance
 * needed). Use this for synthetic error events that are signaled, not thrown
 * -- e.g. "turn busy" or "compaction failed". `retryable` is filled from
 * PYTHINKER_ERROR_INFO so callers cannot drift out of sync with the registry.
 */
export function makeErrorPayload(
  code: PythinkerErrorCode,
  message: string,
  options?: { readonly details?: Record<string, unknown>; readonly name?: string },
): PythinkerErrorPayload {
  return {
    code,
    message,
    name: options?.name,
    details: options?.details,
    retryable: PYTHINKER_ERROR_INFO[code].retryable,
  };
}

/**
 * Normalize any value into a PythinkerErrorPayload.
 *
 * Recognized errors:
 * - `PythinkerError`: passthrough.
 * - `APIStatusError`: 429 -> rate_limit, 401 -> auth_error, otherwise -> api_error.
 *   Exception: a quota-exhausted 429 maps to api_error (retryable: false) —
 *   the rate_limit code would re-mint a rate-limit error across the wire
 *   boundary and drive the dynamic_workflow requeue/suspend loop, which cannot help
 *   until the account is recharged.
 * - `APIConnectionError` / `APITimeoutError`: connection_error.
 * - `ChatProviderError`: api_error.
 *
 * Anything else collapses to `internal`. We never echo `cause` or stack on
 * the wire.
 */
export function toPythinkerErrorPayload(error: unknown): PythinkerErrorPayload {
  if (isPythinkerError(error)) {
    return {
      code: error.code,
      message: error.message,
      name: error.name,
      details: error.details,
      retryable: PYTHINKER_ERROR_INFO[error.code].retryable,
    };
  }

  if (error instanceof APIStatusError) {
    const code: PythinkerErrorCode =
      error instanceof APIProviderQuotaExhaustedError
        ? ErrorCodes.PROVIDER_API_ERROR
        : error.statusCode === 429
          ? ErrorCodes.PROVIDER_RATE_LIMIT
          : error.statusCode === 401
            ? ErrorCodes.PROVIDER_AUTH_ERROR
            : ErrorCodes.PROVIDER_API_ERROR;
    return {
      code,
      message: sanitizeStatusErrorMessage(error.message),
      name: error.name,
      details: {
        statusCode: error.statusCode,
        requestId: error.requestId,
      },
      retryable: PYTHINKER_ERROR_INFO[code].retryable,
    };
  }

  if (error instanceof APIConnectionError || error instanceof APITimeoutError) {
    return {
      code: ErrorCodes.PROVIDER_CONNECTION_ERROR,
      message: error.message,
      name: error.name,
      retryable: PYTHINKER_ERROR_INFO[ErrorCodes.PROVIDER_CONNECTION_ERROR].retryable,
    };
  }

  if (error instanceof APIEmptyResponseError) {
    const code =
      error.finishReason === 'filtered'
        ? ErrorCodes.PROVIDER_FILTERED
        : ErrorCodes.PROVIDER_API_ERROR;
    return {
      code,
      message: error.message,
      name: error.name,
      details: {
        finishReason: error.finishReason,
        rawFinishReason: error.rawFinishReason,
      },
      retryable: PYTHINKER_ERROR_INFO[code].retryable,
    };
  }

  if (error instanceof ChatProviderError) {
    return {
      code: ErrorCodes.PROVIDER_API_ERROR,
      message: error.message,
      name: error.name,
      retryable: PYTHINKER_ERROR_INFO[ErrorCodes.PROVIDER_API_ERROR].retryable,
    };
  }

  if (error instanceof Error) {
    return {
      code: ErrorCodes.INTERNAL,
      message: error.message,
      name: error.name,
      retryable: PYTHINKER_ERROR_INFO[ErrorCodes.INTERNAL].retryable,
    };
  }

  return {
    code: ErrorCodes.INTERNAL,
    message: String(error),
    retryable: PYTHINKER_ERROR_INFO[ErrorCodes.INTERNAL].retryable,
  };
}

/**
 * Provider status errors occasionally carry an HTML body instead of a
 * structured message (for example, nginx returning
 * "413 <html><head><title>413 Request Entity Too Large</title>...</html>").
 * Extract the `<title>` when present so the wire message is human readable,
 * and strip carriage returns so the text renders cleanly in terminals — a
 * trailing `\r` combined with line-end padding would otherwise overwrite
 * the whole line. The original HTML remains available in logs and `details`.
 */
function sanitizeStatusErrorMessage(message: string): string {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(message);
  const extracted = titleMatch?.[1]?.trim();
  const normalized = extracted !== undefined && extracted.length > 0 ? extracted : message;
  return normalized.replaceAll('\r', '');
}

/**
 * Rehydrate a PythinkerErrorPayload into a PythinkerError. Used by SDK boundary code
 * receiving errors over RPC to re-surface them with a real class so
 * in-process consumers can still use `instanceof`.
 */
export function fromPythinkerErrorPayload(payload: PythinkerErrorPayload): PythinkerError {
  return new PythinkerError(payload.code, payload.message, {
    details: payload.details,
  });
}
