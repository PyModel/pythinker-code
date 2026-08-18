import {
  CatalogProviderError,
  DEFAULT_CATALOG_URL,
  catalogProviderModels,
  fetchCatalog,
  importCatalogProvider,
  resolveCatalogImport,
  type Catalog,
} from "@pymodel/pythinker-code-sdk";

import { Events, Methods } from "../../shared/bridge";
import type {
  AddCatalogProviderRequest,
  CatalogProviderSummary,
  ConfiguredProvider,
  ProvidersView,
} from "../../shared/types";
import type { Handler, HandlerContext } from "./types";

/**
 * The catalog is a ~1 MB public document that changes rarely. One fetch per
 * extension host is enough; the modal reads it repeatedly while the user browses.
 */
let catalogCache: Promise<Catalog> | undefined;

async function loadCatalog(): Promise<Catalog> {
  catalogCache ??= fetchCatalog(DEFAULT_CATALOG_URL).catch((error: unknown) => {
    catalogCache = undefined;
    throw error;
  });
  return catalogCache;
}

async function readProviders(ctx: HandlerContext): Promise<ProvidersView> {
  const config = await ctx.harness.getConfig({ reload: true });
  const providers: ConfiguredProvider[] = Object.entries(config.providers ?? {})
    .map(([id, provider]) => toConfiguredProvider(id, provider, config))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  return { providers, defaultModel: config.defaultModel ?? null };
}

function toConfiguredProvider(id: string, provider: any, config: any): ConfiguredProvider {
  const models = Object.entries(config.models ?? {})
    .filter(([, alias]) => (alias as any).provider === id)
    .map(([alias]) => alias);
  return {
    id,
    type: provider.type ?? "unknown",
    baseUrl: provider.baseUrl,
    host: hostOf(provider.baseUrl),
    // Never send the key itself to the Webview; only whether one is configured
    // and where it comes from. A managed provider authenticates over OAuth and
    // is required by the schema to carry no key at all, so it is not missing one.
    keySource:
      provider.oauth !== undefined
        ? "oauth"
        : typeof provider.apiKey === "string" && provider.apiKey.length > 0
          ? "config"
          : providerEnvKey(provider) !== undefined
            ? "env"
            : "none",
    apiKeyEnvVar: providerEnvKey(provider),
    catalogUrl: provider.source?.kind === "modelsDev" ? provider.source.url : undefined,
    models: models.toSorted((left, right) => left.localeCompare(right)),
  };
}

export const providerHandlers: Record<string, Handler<any, any>> = {
  [Methods.GetProviders]: async (_, ctx): Promise<ProvidersView> => readProviders(ctx),

  [Methods.GetProviderCatalog]: async (): Promise<CatalogProviderSummary[]> => {
    const catalog = await loadCatalog();
    return Object.entries(catalog)
      .map(([id, entry]) => toCatalogSummary(id, entry))
      // A provider that cannot be reached with a single API key has no path
      // through this UI, so it is not offered.
      .filter((entry) => entry.wire !== undefined && entry.models.length > 0)
      .toSorted((left, right) => left.name.localeCompare(right.name));
  },

  [Methods.AddCatalogProvider]: async (
    params: AddCatalogProviderRequest,
    ctx,
  ): Promise<ProvidersView> => {
    const catalog = await loadCatalog();
    const entry = catalog[params.providerId];
    if (entry === undefined) {
      throw new Error(`Provider "${params.providerId}" is not in the catalog.`);
    }
    try {
      await importCatalogProvider(ctx.harness, {
        providerId: params.providerId,
        entry,
        catalogUrl: DEFAULT_CATALOG_URL,
        apiKey: params.apiKey ?? "",
        defaultModel: params.defaultModel,
      });
    } catch (error) {
      // The import errors are already written for a person to read.
      if (error instanceof CatalogProviderError) throw new Error(error.message, { cause: error });
      throw error;
    }
    const view = await readProviders(ctx);
    ctx.broadcast(Events.ProvidersChanged, view);
    return view;
  },

  [Methods.RemoveProvider]: async (
    { providerId }: { providerId: string },
    ctx,
  ): Promise<ProvidersView> => {
    await ctx.harness.removeProvider(providerId);
    const view = await readProviders(ctx);
    ctx.broadcast(Events.ProvidersChanged, view);
    return view;
  },
};

function hostOf(baseUrl: unknown): string | undefined {
  if (typeof baseUrl !== "string" || baseUrl.length === 0) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch {
    return undefined;
  }
}

function toCatalogSummary(id: string, entry: any): CatalogProviderSummary {
  const resolution = resolveCatalogImport(entry);
  const wire = resolution.kind === "ok" ? resolution.wire : undefined;
  return {
    id,
    name: entry.name ?? id,
    wire,
    models: catalogProviderModels(entry).map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      maxContextTokens: model.capability?.max_context_tokens,
      thinking: model.capability?.thinking === true,
    })),
  };
}

function providerEnvKey(provider: any): string | undefined {
  if (typeof provider.env !== "object" || provider.env === null) return undefined;
  return Object.entries(provider.env).find(
    ([, value]) => typeof value === "string" && value.length > 0,
  )?.[0];
}
