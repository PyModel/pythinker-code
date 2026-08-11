/** Built-in model roles a user can lock a model alias to. */
export const BUILT_IN_MODEL_ROLES = ['small', 'implementer', 'advisor'] as const;
export type BuiltInModelRole = (typeof BUILT_IN_MODEL_ROLES)[number];

interface ModelRoleSource {
  modelRoles?: Record<string, string>;
  defaultModel?: string;
}

/** Resolve a role name to its locked model alias. Empty string means cleared. */
export function resolveModelRoleAlias(
  config: ModelRoleSource | undefined,
  role: string,
): string | undefined {
  if (role === 'default') return config?.defaultModel;
  const alias = config?.modelRoles?.[role]?.trim();
  return alias === '' ? undefined : alias;
}

/** Expand a "@role" model reference; non-@ strings pass through unchanged. */
export function expandModelRef(
  config: ModelRoleSource | undefined,
  ref: string,
): string | undefined {
  return ref.startsWith('@') ? resolveModelRoleAlias(config, ref.slice(1)) : ref;
}
