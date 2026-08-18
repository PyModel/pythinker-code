import {
  createRPC,
  ErrorCodes,
  PythinkerError,
  parseConfigString,
  resolveConfigPath,
  type RPCMethods,
} from '@pymodel/agent-core';
import { z } from 'zod';

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

interface PythinkerConfigCoreRpc {
  resolveConfigPath(input: ResolvePythinkerConfigPathInput): string;
  validateConfigToml(input: ValidatePythinkerConfigTomlInput): void;
}

interface PythinkerConfigClientRpc {}

class PythinkerConfigCoreRpcImpl implements PythinkerConfigCoreRpc {
  resolveConfigPath(input: ResolvePythinkerConfigPathInput): string {
    return resolveConfigPath(input);
  }

  validateConfigToml(input: ValidatePythinkerConfigTomlInput): void {
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

export class PythinkerConfigRpcClient implements PythinkerConfigRpc {
  private readonly ready: Promise<RPCMethods<PythinkerConfigCoreRpc>>;

  constructor() {
    const [coreRpc, clientRpc] = createRPC<PythinkerConfigCoreRpc, PythinkerConfigClientRpc>();
    void coreRpc(new PythinkerConfigCoreRpcImpl());
    this.ready = clientRpc({});
  }

  async resolveConfigPath(input: ResolvePythinkerConfigPathInput = {}): Promise<string> {
    const rpc = await this.ready;
    return rpc.resolveConfigPath(input);
  }

  async validateConfigToml(input: ValidatePythinkerConfigTomlInput): Promise<void> {
    const rpc = await this.ready;
    await rpc.validateConfigToml(input);
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
