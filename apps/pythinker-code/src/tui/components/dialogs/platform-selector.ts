import { OPENAI_CODEX_OAUTH_LOGIN, OPEN_PLATFORMS } from '@pythoughts/pythinker-code-oauth';
import {
  catalogConnectionWire,
  type Catalog,
  type CatalogProviderEntry,
} from '@pythoughts/pythinker-code-sdk';

import { ChoicePickerComponent, type ChoiceOption } from './choice-picker';

export const CATALOG_PLATFORM_VALUE_PREFIX = 'catalog:';

const FEATURED_CATALOG_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek API' },
  { id: 'zai-coding-plan', label: 'GLM Coding Plan' },
  { id: 'minimax-coding-plan', label: 'MiniMax Token Plan' },
  { id: 'kimi-for-coding', label: 'Kimi For Coding' },
] as const;

const REPLACED_OPEN_PLATFORM_IDS = new Set(['moonshot-ai', 'minimax-token']);

export function catalogProviderIdFromPlatformValue(value: string): string | undefined {
  if (!value.startsWith(CATALOG_PLATFORM_VALUE_PREFIX)) return undefined;
  const providerId = value.slice(CATALOG_PLATFORM_VALUE_PREFIX.length);
  return providerId.length > 0 ? providerId : undefined;
}

function catalogOption(
  providerId: string,
  entry: CatalogProviderEntry | undefined,
  label = entry?.name ?? providerId,
): ChoiceOption {
  return {
    value: `${CATALOG_PLATFORM_VALUE_PREFIX}${providerId}`,
    label,
    description:
      typeof entry?.api === 'string' && entry.api.length > 0 ? entry.api : 'API key',
  };
}

function buildPlatformOptions(catalog: Catalog): readonly ChoiceOption[] {
  const options: ChoiceOption[] = [
    {
      value: OPENAI_CODEX_OAUTH_LOGIN.id,
      label: OPENAI_CODEX_OAUTH_LOGIN.name,
      description: 'OAuth',
    },
    { value: 'pythinker-code', label: 'Pythinker (OAuth)', description: 'OAuth' },
  ];
  const seen = new Set(['pythinker-code', OPENAI_CODEX_OAUTH_LOGIN.id]);

  for (const featured of FEATURED_CATALOG_PROVIDERS) {
    const entry = catalog[featured.id];
    if (entry === undefined || catalogConnectionWire(entry) === undefined) continue;
    options.push(catalogOption(featured.id, entry, featured.label));
    seen.add(featured.id);
  }

  const catalogEntries = Object.entries(catalog)
    .filter(([id, entry]) => !seen.has(id) && catalogConnectionWire(entry) !== undefined)
    .toSorted(([aId, a], [bId, b]) => (a.name ?? aId).localeCompare(b.name ?? bId));
  for (const [id, entry] of catalogEntries) {
    options.push(catalogOption(id, entry));
    seen.add(id);
  }

  for (const platform of OPEN_PLATFORMS) {
    if (
      platform.catalogProviderId !== undefined ||
      REPLACED_OPEN_PLATFORM_IDS.has(platform.id) ||
      seen.has(platform.id)
    ) {
      continue;
    }
    options.push({
      value: platform.id,
      label: platform.name,
      description: platform.baseUrl,
    });
  }
  return options;
}

export interface PlatformSelectorOptions {
  readonly catalog?: Catalog;
  readonly onSelect: (platformId: string) => void;
  readonly onCancel: () => void;
}

export class PlatformSelectorComponent extends ChoicePickerComponent {
  constructor(opts: PlatformSelectorOptions) {
    super({
      title: 'Select a platform',
      options: [...buildPlatformOptions(opts.catalog ?? {})],
      searchable: true,
      onSelect: opts.onSelect,
      onCancel: opts.onCancel,
    });
  }
}
