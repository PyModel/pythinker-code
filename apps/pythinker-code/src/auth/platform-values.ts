/**
 * Platform-selection value vocabulary, shared by the login flows and every
 * renderer that presents them.
 *
 * These live outside `#/tui` on purpose: `#/auth/login-flows` is renderer
 * agnostic, and importing them from the TUI's platform selector would pull the
 * whole dialog stack (choice picker, theme, searchable list) into non-TUI
 * callers such as the `pythinker login` subcommand.
 */

/** Marks a platform id as referring to a catalog provider rather than a built-in platform. */
export const CATALOG_PLATFORM_VALUE_PREFIX = 'catalog:';

/** The catalog provider id behind a platform value, or `undefined` for a non-catalog platform. */
export function catalogProviderIdFromPlatformValue(value: string): string | undefined {
  if (!value.startsWith(CATALOG_PLATFORM_VALUE_PREFIX)) return undefined;
  const providerId = value.slice(CATALOG_PLATFORM_VALUE_PREFIX.length);
  return providerId.length > 0 ? providerId : undefined;
}
