import { useCallback, useEffect, useState } from "react";
import { IconExternalLink, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { bridge } from "@/services";
import type { ConfigInfo } from "shared/types";

export function ConfigFileSection() {
  const [info, setInfo] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(() => {
    setLoading(true);
    setError(undefined);
    bridge
      .getConfigInfo()
      .then(setInfo)
      .catch((error: unknown) => setError(error instanceof Error ? error.message : String(error)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && info === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
        <IconLoader2 className="size-3.5 animate-spin" />
        Reading config file…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium">Config File</h2>
        <Button variant="outline" size="sm" className="h-6 text-xs" onClick={load} disabled={loading}>
          {loading ? <IconLoader2 className="size-3 mr-1 animate-spin" /> : <IconRefresh className="size-3 mr-1" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {info === null ? (
        // A load error with no result means the state is unknown — the error
        // banner above is the whole story, so do not claim the file is missing.
        error === undefined && <p className="text-xs text-muted-foreground text-center py-10">No config file was found.</p>
      ) : info.path === null || !info.exists ? (
        <p className="text-xs text-muted-foreground text-center py-10">No config file was found.</p>
      ) : (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <code className="text-[11px] font-mono text-muted-foreground truncate flex-1" title={info.path}>
              {info.path}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs shrink-0"
              onClick={() => info.path && void bridge.openFile(info.path)}
            >
              <IconExternalLink className="size-3 mr-1" />
              Open in editor
            </Button>
          </div>
          <pre className="text-[11px] font-mono bg-code-block border border-border rounded p-3 overflow-auto max-h-[60vh] whitespace-pre">
            {info.content ?? ""}
          </pre>
        </>
      )}
    </div>
  );
}
