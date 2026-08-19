import { OPENAI_CODEX_OAUTH_PLATFORM_ID, OPEN_PLATFORMS } from '@pymodel/pythinker-code-oauth';

import { resolveCatalogImport, type Catalog, type CatalogProviderEntry } from '#/catalog';

import { CATALOG_PLATFORM_VALUE_PREFIX } from './platform-values';

export interface PlatformOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

const FEATURED_CATALOG_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek API' },
  { id: 'zai-coding-plan', label: 'GLM Coding Plan' },
  { id: 'minimax-coding-plan', label: 'MiniMax Token Plan' },
  { id: 'kimi-for-coding', label: 'Kimi For Coding' },
] as const;

function catalogOption(
  providerId: string,
  entry: CatalogProviderEntry,
  label = entry.name ?? providerId,
): PlatformOption {
  return {
    value: `${CATALOG_PLATFORM_VALUE_PREFIX}${providerId}`,
    label,
    description: typeof entry.api === 'string' && entry.api.length > 0 ? entry.api : 'API key',
  };
}

function catalogEntryIsUsable(entry: CatalogProviderEntry | undefined): entry is CatalogProviderEntry {
  return entry !== undefined && resolveCatalogImport(entry).kind === 'ok';
}

export function buildPlatformOptions(catalog: Catalog): readonly PlatformOption[] {
  const options: PlatformOption[] = [
    {
      value: OPENAI_CODEX_OAUTH_PLATFORM_ID,
      label: 'OpenAI Codex (OAuth)',
      description: 'OAuth',
    },
  ];
  const seen = new Set<string>([OPENAI_CODEX_OAUTH_PLATFORM_ID]);

  for (const featured of FEATURED_CATALOG_PROVIDERS) {
    const entry = catalog[featured.id];
    if (!catalogEntryIsUsable(entry)) continue;
    options.push(catalogOption(featured.id, entry, featured.label));
    seen.add(featured.id);
  }

  for (const [id, entry] of Object.entries(catalog)
    .filter(([id, entry]) => !seen.has(id) && catalogEntryIsUsable(entry))
    .toSorted(([leftId, left], [rightId, right]) =>
      (left.name ?? leftId).localeCompare(right.name ?? rightId),
    )) {
    options.push(catalogOption(id, entry));
    seen.add(id);
  }

  for (const platform of OPEN_PLATFORMS) {
    if (seen.has(platform.id)) continue;
    options.push({ value: platform.id, label: platform.name, description: platform.baseUrl });
  }
  return options;
}

export function resolvePlatformOption(
  options: readonly PlatformOption[],
  input: string,
): PlatformOption | undefined {
  const wanted = input.trim();
  const byId = options.find((option) => option.value === wanted);
  if (byId !== undefined) return byId;
  const lowered = wanted.toLowerCase();
  const byLabel = options.find((option) => option.label.toLowerCase() === lowered);
  if (byLabel !== undefined) return byLabel;
  const catalogValue = `${CATALOG_PLATFORM_VALUE_PREFIX}${lowered}`;
  return options.find((option) => option.value.toLowerCase() === catalogValue);
}
