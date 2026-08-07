/**
 * The list of platforms a user can log in to, built once and rendered by every
 * surface: the TUI platform selector and the `pythinker login` terminal picker.
 *
 * Pure data — no renderer imports — so both surfaces offer the same providers in
 * the same order. `PlatformOption` is structurally compatible with the TUI's
 * `ChoiceOption`, which is why the selector can pass these straight through.
 */

import { OPENAI_CODEX_OAUTH_LOGIN, OPEN_PLATFORMS } from '@pythoughts/pythinker-code-oauth';
import {
  catalogConnectionWire,
  type Catalog,
  type CatalogProviderEntry,
} from '#/catalog';

import { CATALOG_PLATFORM_VALUE_PREFIX } from './platform-values';

export interface PlatformOption {
  /** Platform id, or a `catalog:`-prefixed catalog provider id. */
  readonly value: string;
  /** Display name shown in the picker. */
  readonly label: string;
  /** Secondary line: the auth kind (`OAuth` / `API key`) or the platform base URL. */
  readonly description?: string;
}

/** Kimi's managed OAuth platform id — one option among many, never a default. */
export const KIMI_CODE_PLATFORM_ID = 'kimi-code';

const FEATURED_CATALOG_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek API' },
  { id: 'zai-coding-plan', label: 'GLM Coding Plan' },
  { id: 'minimax-coding-plan', label: 'MiniMax Token Plan' },
  { id: 'kimi-for-coding', label: 'Kimi For Coding' },
] as const;

const REPLACED_OPEN_PLATFORM_IDS = new Set(['moonshot-ai', 'minimax-token']);

function catalogOption(
  providerId: string,
  entry: CatalogProviderEntry | undefined,
  label = entry?.name ?? providerId,
): PlatformOption {
  return {
    value: `${CATALOG_PLATFORM_VALUE_PREFIX}${providerId}`,
    label,
    description:
      typeof entry?.api === 'string' && entry.api.length > 0 ? entry.api : 'API key',
  };
}

export function buildPlatformOptions(catalog: Catalog): readonly PlatformOption[] {
  const options: PlatformOption[] = [
    {
      value: OPENAI_CODEX_OAUTH_LOGIN.id,
      label: OPENAI_CODEX_OAUTH_LOGIN.name,
      description: 'OAuth',
    },
    { value: KIMI_CODE_PLATFORM_ID, label: 'Kimi (OAuth)', description: 'OAuth' },
  ];
  const seen = new Set<string>([KIMI_CODE_PLATFORM_ID, OPENAI_CODEX_OAUTH_LOGIN.id]);

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

/**
 * Resolve a user-supplied `--provider` value to a platform id, matching by id
 * first and then by case-insensitive display name — the same rule the reference
 * CLI uses. Returns `undefined` when nothing matches, so the caller can fail
 * with the list of valid choices rather than silently picking one.
 */
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
  // A catalog provider's value carries the internal `catalog:` prefix and its
  // label is a product name ("DeepSeek API"), so the id the user actually knows
  // — `deepseek` — matches neither rule above. Ids are unique across the whole
  // option list, so accepting the bare form cannot become ambiguous.
  const catalogValue = `${CATALOG_PLATFORM_VALUE_PREFIX}${lowered}`;
  return options.find((option) => option.value.toLowerCase() === catalogValue);
}
