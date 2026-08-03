import { ErrorCodes, PythinkerError } from '#/errors';
import type { ProviderConfig } from './schema';

const TRUE_BOOLEAN_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_BOOLEAN_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

export interface ResolveConfigValueInput<T> {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly envKey: string;
  readonly configValue?: T;
  readonly defaultValue: T;
  readonly parseEnv: (value: string | undefined) => T | undefined;
}

export function resolveConfigValue<T>(input: ResolveConfigValueInput<T>): T {
  return (
    input.parseEnv(input.env?.[input.envKey]) ??
    input.configValue ??
    input.defaultValue
  );
}

export function parseBooleanEnv(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) return undefined;
  if (TRUE_BOOLEAN_ENV_VALUES.has(normalized)) return true;
  if (FALSE_BOOLEAN_ENV_VALUES.has(normalized)) return false;
  return undefined;
}

/**
 * Parse a floating-point environment value (e.g. `PYTHINKER_MODEL_TEMPERATURE`).
 * Returns `undefined` when unset/blank; throws `PythinkerError(CONFIG_INVALID)` on a
 * non-numeric value so a typo fails fast like the other `PYTHINKER_MODEL_*` vars.
 * No range validation — callers pass values the upstream API accepts.
 */
export function parseFloatEnv(value: string | undefined, varName: string): number | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new PythinkerError(ErrorCodes.CONFIG_INVALID, `${varName} must be a number, got "${value}".`);
  }
  return parsed;
}

export function resolveProviderApiKey(
  provider: ProviderConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const direct = nonEmptyString(provider.apiKey);
  if (direct !== undefined) return direct;
  if (provider.apiKeyEnvVar !== undefined) return nonEmptyString(env[provider.apiKeyEnvVar]);

  switch (provider.type) {
    case 'anthropic':
      return nonEmptyString(provider.env?.['ANTHROPIC_API_KEY']);
    case 'openai':
    case 'openai_responses':
      return nonEmptyString(provider.env?.['OPENAI_API_KEY']);
    case 'pythinker':
      return nonEmptyString(provider.env?.['PYTHINKER_API_KEY']);
    case 'google-genai':
      return nonEmptyString(provider.env?.['GOOGLE_API_KEY']);
    case 'vertexai':
      return (
        nonEmptyString(provider.env?.['VERTEXAI_API_KEY']) ??
        nonEmptyString(provider.env?.['GOOGLE_API_KEY'])
      );
  }
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
