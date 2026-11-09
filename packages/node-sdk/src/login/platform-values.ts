export const CATALOG_PLATFORM_VALUE_PREFIX = 'catalog:';

export function catalogProviderIdFromPlatformValue(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null || !value.startsWith(CATALOG_PLATFORM_VALUE_PREFIX)) return undefined;
  const providerId = value.slice(CATALOG_PLATFORM_VALUE_PREFIX.length);
  return providerId.length > 0 ? providerId : undefined;
}
