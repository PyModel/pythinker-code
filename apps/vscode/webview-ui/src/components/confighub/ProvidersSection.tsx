import { useEffect, useMemo, useState } from "react";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconKey,
  IconLoader2,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { bridge } from "@/services";
import { cn } from "@/lib/utils";
import type {
  CatalogProviderSummary,
  ConfiguredProvider,
  ProvidersView,
} from "shared/types";

const KEY_SOURCE_LABEL: Record<ConfiguredProvider["keySource"], string> = {
  config: "Key in config.toml",
  env: "Key from environment",
  oauth: "Signed in",
  none: "No key configured",
};

export function ProvidersSection() {
  const [view, setView] = useState<ProvidersView>({ providers: [], defaultModel: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | undefined>();

  useEffect(() => {
    setLoading(true);
    setError(undefined);
    bridge
      .getProviders()
      .then(setView)
      .catch((error: unknown) => setError(messageOf(error)))
      .finally(() => setLoading(false));
  }, []);

  const remove = async (providerId: string) => {
    setDeleteTarget(undefined);
    setError(undefined);
    try {
      setView(await bridge.removeProvider(providerId));
    } catch (error) {
      setError(messageOf(error));
    }
  };

  return (
    <>
      {addOpen ? (
        <AddProviderPanel
          onClose={() => setAddOpen(false)}
          onAdded={(next) => {
            setView(next);
            setAddOpen(false);
          }}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium">Model Providers</h2>
            <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setAddOpen(true)}>
              <IconPlus className="size-3 mr-1" />
              Add
            </Button>
          </div>

          {error && (
            <div className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Providers live in <code className="text-brand">~/.pythinker-code/config.toml</code>, the same file the
            CLI reads. Anything added here works in the terminal too.
          </p>

          {loading && view.providers.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
              <IconLoader2 className="size-3.5 animate-spin" />
              Reading config.toml…
            </div>
          ) : view.providers.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <p className="text-xs text-muted-foreground">No providers configured yet.</p>
              <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setAddOpen(true)}>
                <IconPlus className="size-3 mr-1" />
                Add your first provider
              </Button>
            </div>
          ) : (
            view.providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                defaultModel={view.defaultModel}
                onRemove={() => setDeleteTarget(provider.id)}
              />
            ))
          )}
        </div>
      )}

      <AlertDialog open={deleteTarget !== undefined} onOpenChange={(open) => !open && setDeleteTarget(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its models disappear from the model picker, in the extension and in the CLI. The API key is deleted
              from config.toml.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && void remove(deleteTarget)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProviderRow({
  provider,
  defaultModel,
  onRemove,
}: {
  provider: ConfiguredProvider;
  defaultModel: string | null;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-border/60 bg-muted/20">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          <IconChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")} />
          <span className="text-xs font-medium truncate min-w-8">{provider.id}</span>
          <span className="text-[10px] text-muted-foreground truncate max-[340px]:hidden">
            {provider.host ?? provider.type}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 whitespace-nowrap max-[300px]:hidden">
            {provider.models.length} model{provider.models.length === 1 ? "" : "s"}
          </span>
        </button>
        <span
          title={provider.keySource === "env" ? provider.apiKeyEnvVar : KEY_SOURCE_LABEL[provider.keySource]}
          className={cn(
            "flex items-center gap-1 text-[10px] shrink-0",
            provider.keySource === "none" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          <IconKey className="size-3 shrink-0" />
          <span className="whitespace-nowrap max-[420px]:hidden">
            {provider.keySource === "env" ? provider.apiKeyEnvVar : KEY_SOURCE_LABEL[provider.keySource]}
          </span>
        </span>
        <button onClick={onRemove} className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove">
          <IconTrash className="size-3" />
        </button>
      </div>

      {expanded && (
        <div className="px-2.5 pb-2 space-y-0.5 border-t border-border/40 pt-1.5">
          {provider.baseUrl && (
            <div className="text-[10px] text-muted-foreground font-mono truncate">{provider.baseUrl}</div>
          )}
          {provider.models.map((model) => (
            <div key={model} className="flex items-center gap-1.5 text-[11px]">
              {model === defaultModel && <IconCheck className="size-3 text-brand shrink-0" />}
              <span className={cn("font-mono truncate", model === defaultModel ? "text-brand" : "text-muted-foreground")}>
                {model}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddProviderPanel({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (view: ProvidersView) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CatalogProviderSummary | undefined>();
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    bridge
      .getProviderCatalog()
      .then(setCatalog)
      .catch((error: unknown) => setError(messageOf(error)))
      .finally(() => setLoading(false));
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return catalog;
    return catalog.filter(
      (entry) => entry.name.toLowerCase().includes(needle) || entry.id.toLowerCase().includes(needle),
    );
  }, [catalog, query]);

  const submit = async () => {
    if (selected === undefined) return;
    setSaving(true);
    setError(undefined);
    try {
      onAdded(
        await bridge.addCatalogProvider({
          providerId: selected.id,
          apiKey: apiKey.trim(),
          defaultModel,
        }),
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setSaving(false);
    }
  };

  const canSubmit = selected !== undefined && apiKey.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" className="size-6" onClick={onClose} aria-label="Back">
          <IconArrowLeft className="size-3.5" />
        </Button>
        <h2 className="text-xs font-medium">{selected === undefined ? "Choose a provider" : `Connect ${selected.name}`}</h2>
      </div>

      <div className="space-y-3">
        {error && (
          <div className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {selected === undefined ? (
          <>
            <div className="relative">
              <IconSearch className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search providers…"
                className="h-7 text-xs pl-7"
              />
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
                <IconLoader2 className="size-3.5 animate-spin" />
                Loading the models.dev catalog…
              </div>
            ) : (
              <div className="space-y-0.5">
                {matches.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => {
                      setSelected(entry);
                      setDefaultModel(undefined);
                      // A key typed for one provider must not be submittable
                      // under another provider's id.
                      setApiKey("");
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-muted/60 text-left"
                  >
                    <span className="text-xs flex-1 truncate">{entry.name}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {entry.models.length} model{entry.models.length === 1 ? "" : "s"}
                    </span>
                  </button>
                ))}
                {matches.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">No provider matches “{query}”.</p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">API key</Label>
              <Input
                autoFocus
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                className="h-7 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Stored in config.toml in plain text, as the CLI does.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                Default model <span className="text-muted-foreground/70">(optional)</span>
              </Label>
              <div className="space-y-0.5 max-h-64 overflow-y-auto rounded border border-border/60 p-1">
                {selected.models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setDefaultModel(defaultModel === model.id ? undefined : model.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-muted/60",
                      defaultModel === model.id && "bg-brand/15",
                    )}
                  >
                    <IconCheck
                      className={cn("size-3 shrink-0", defaultModel === model.id ? "text-brand" : "opacity-0")}
                    />
                    <span className="text-[11px] flex-1 truncate">{model.name}</span>
                    {model.thinking && <span className="text-[10px] text-muted-foreground">thinking</span>}
                    {model.maxContextTokens !== undefined && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {Math.round(model.maxContextTokens / 1000)}k
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                All {selected.models.length} models are imported either way. Leave this unset to keep your current
                default.
              </p>
            </div>
          </>
        )}
      </div>

      {selected !== undefined && (
        <div className="flex items-center justify-between gap-2 pt-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => {
              setSelected(undefined);
              setApiKey("");
            }}
          >
            Back
          </Button>
          <Button size="sm" className="h-6 text-xs" disabled={!canSubmit || saving} onClick={() => void submit()}>
            {saving && <IconLoader2 className="size-3 mr-1 animate-spin" />}
            Add provider
          </Button>
        </div>
      )}
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
