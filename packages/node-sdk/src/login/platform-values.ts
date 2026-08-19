export const CATALOG_PLATFORM_VALUE_PREFIX = 'catalog:';

export function catalogProviderIdFromPlatformValue(value: string): string | undefined {
  if (!value.startsWith(CATALOG_PLATFORM_VALUE_PREFIX)) return undefined;
  const providerId = value.slice(CATALOG_PLATFORM_VALUE_PREFIX.length);
  return providerId.length > 0 ? providerId : undefined;
}
