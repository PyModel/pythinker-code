/**
 * Loop-local error helpers.
 */

import { ErrorCodes, PythinkerError, isPythinkerError } from '#/errors';

export function createMaxStepsExceededError(maxSteps: number, message?: string): PythinkerError {
  return new PythinkerError(ErrorCodes.LOOP_MAX_STEPS_EXCEEDED, message ?? `Turn exceeded maxSteps=${maxSteps}`, {
    details: { maxSteps },
  });
}

export function isMaxStepsExceededError(error: unknown): boolean {
  return isPythinkerError(error) && error.code === ErrorCodes.LOOP_MAX_STEPS_EXCEEDED;
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError';
  }
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
