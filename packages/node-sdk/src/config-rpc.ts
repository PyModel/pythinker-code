import { resolveConfigPath } from '@pymodel/agent-core-v2';
import { z } from 'zod';

import { parseConfigString } from '#/config/index';
import { ErrorCodes, PythinkerError } from '#/errors';

export type PythinkerConfigValidationPathSegment = string | number;

export interface PythinkerConfigValidationIssue {
  readonly path: readonly PythinkerConfigValidationPathSegment[];
  readonly message: string;
}

export interface ResolvePythinkerConfigPathInput {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
}

export interface ValidatePythinkerConfigTomlInput {
  readonly text: string;
  readonly filePath?: string | undefined;
}

export interface PythinkerConfigRpc {
  resolveConfigPath(input?: ResolvePythinkerConfigPathInput): Promise<string>;
  validateConfigToml(input: ValidatePythinkerConfigTomlInput): Promise<void>;
}

export class PythinkerConfigRpcClient implements PythinkerConfigRpc {
  async resolveConfigPath(input: ResolvePythinkerConfigPathInput = {}): Promise<string> {
    return resolveConfigPath(input);
  }

  async validateConfigToml(input: ValidatePythinkerConfigTomlInput): Promise<void> {
    try {
      parseConfigString(input.text, input.filePath);
    } catch (error) {
      const validationIssues = extractValidationIssues(error);
      if (validationIssues !== undefined) {
        throw toConfigValidationError(error, validationIssues);
      }
      throw error;
    }
  }
}

export function createPythinkerConfigRpc(): PythinkerConfigRpc {
  return new PythinkerConfigRpcClient();
}

function toConfigValidationError(
  error: unknown,
  validationIssues: readonly PythinkerConfigValidationIssue[],
): PythinkerError {
  const details =
    error instanceof PythinkerError && error.details !== undefined
      ? { ...error.details, validationIssues }
      : { validationIssues };

  if (error instanceof PythinkerError) {
    return new PythinkerError(error.code, error.message, { details });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new PythinkerError(ErrorCodes.CONFIG_INVALID, message, { details });
}

function extractValidationIssues(error: unknown): readonly PythinkerConfigValidationIssue[] | undefined {
  const zodError = findZodError(error);
  if (zodError === undefined) return undefined;
  return zodError.issues.map((issue) => ({
    path: issue.path.map((segment) =>
      typeof segment === 'number' ? segment : String(segment),
    ),
    message: issue.message,
  }));
}

function findZodError(error: unknown): z.ZodError | undefined {
  if (error instanceof z.ZodError) return error;
  if (error instanceof Error && error.cause instanceof z.ZodError) return error.cause;
  return undefined;
}
