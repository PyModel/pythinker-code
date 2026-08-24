/**
 * Shapes and value parsers for the Pythinker config file and for the `/models`
 * payload that providers return.
 *
 * Nothing here is specific to one provider or to any hosted service: the same
 * config shape backs a custom registry, a models.dev import, an API-key
 * provider, and an OAuth provider alike. Keep provider-specific login and
 * provisioning logic out of this module.
 */

export type ModelProtocol = 'pythinker' | 'anthropic';

export function parseModelProtocol(value: unknown): ModelProtocol | undefined {
  return value === 'anthropic' ? 'anthropic' : undefined;
}

/**
 * Server-declared thinking toggle support from `/models`:
 *  - 'only' — thinking cannot be turned off (always-thinking)
 *  - 'no'   — thinking is not supported at all
 *  - 'both' — thinking can be toggled on and off
 * Absent on older servers — callers fall back to `supportsReasoning`.
 */
export type SupportsThinkingType = 'only' | 'no' | 'both';

// Unknown or missing values resolve to undefined so callers fall back to the
// legacy supports_reasoning boolean instead of guessing.
export function parseSupportsThinkingType(value: unknown): SupportsThinkingType | undefined {
  return value === 'only' || value === 'no' || value === 'both' ? value : undefined;
}

export function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * Parse the nested `think_efforts` object from `/models`:
 *   { "support": true, "valid_efforts": ["low", "high", "max"], "default_effort": "high" }
 * Returns the effort list and default effort, or undefineds when absent so
 * callers can fall back to the legacy flat `support_efforts` / `default_effort`
 * fields on older servers.
 */
export function parseThinkEfforts(value: unknown): {
  supportEfforts: readonly string[] | undefined;
  defaultEffort: string | undefined;
} {
  if (value === null || typeof value !== 'object') {
    return { supportEfforts: undefined, defaultEffort: undefined };
  }
  const record = value as Record<string, unknown>;
  // `support` gates the whole object: when it is not true, ignore
  // valid_efforts / default_effort entirely.
  if (record['support'] !== true) {
    return { supportEfforts: undefined, defaultEffort: undefined };
  }
  const rawDefault = record['default_effort'];
  return {
    supportEfforts: parseStringArray(record['valid_efforts']),
    defaultEffort:
      typeof rawDefault === 'string' && rawDefault.length > 0 ? rawDefault : undefined,
  };
}

export interface OAuthRef {
  readonly storage: 'file';
  readonly key: string;
  readonly oauthHost?: string | undefined;
}

export interface OAuthRefInput {
  readonly storage?: 'file' | undefined;
  readonly key?: string | undefined;
  readonly oauthHost?: string | undefined;
}

export interface ProviderConfig {
  type: ModelProtocol;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: OAuthRef | undefined;
  readonly [key: string]: unknown;
}

export interface ModelAliasOverrides {
  maxContextSize?: number | undefined;
  maxOutputSize?: number | undefined;
  capabilities?: string[] | undefined;
  displayName?: string | undefined;
  reasoningKey?: string | undefined;
  adaptiveThinking?: boolean | undefined;
  supportEfforts?: readonly string[] | undefined;
  defaultEffort?: string | undefined;
  readonly [key: string]: unknown;
}

export interface ModelAlias {
  provider: string;
  model: string;
  maxContextSize: number;
  maxInputSize?: number | undefined;
  maxOutputSize?: number | undefined;
  capabilities?: string[] | undefined;
  supportEfforts?: readonly string[] | undefined;
  defaultEffort?: string | undefined;
  displayName?: string | undefined;
  reasoningKey?: string | undefined;
  offEffort?: string | undefined;
  baseUrl?: string | undefined;
  protocol?: ModelProtocol;
  betaApi?: boolean;
  adaptiveThinking?: boolean | undefined;
  overrides?: ModelAliasOverrides | undefined;
  readonly [key: string]: unknown;
}

export interface ProviderModelInfo {
  readonly id: string;
  readonly contextLength: number;
  readonly supportsReasoning: boolean;
  readonly supportsImageIn: boolean;
  readonly supportsVideoIn: boolean;
  readonly supportsToolUse?: boolean | undefined;
  readonly supportsThinkingType?: SupportsThinkingType | undefined;
  readonly supportEfforts?: readonly string[] | undefined;
  readonly defaultEffort?: string | undefined;
  readonly displayName?: string | undefined;
}

export interface ServiceConfig {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: OAuthRef | undefined;
}

export interface ServicesConfig {
  pymodelSearch?: ServiceConfig | undefined;
  pymodelFetch?: ServiceConfig | undefined;
  readonly [key: string]: unknown;
}

export interface ThinkingShape {
  enabled?: boolean | undefined;
  effort?: string | undefined;
  [key: string]: unknown;
}

export interface PythinkerConfigShape {
  providers: Record<string, ProviderConfig | Record<string, unknown>>;
  models?: Record<string, ModelAlias | Record<string, unknown>> | undefined;
  defaultModel?: string | undefined;
  thinking?: ThinkingShape | undefined;
  services?: ServicesConfig | undefined;
  [key: string]: unknown;
}
