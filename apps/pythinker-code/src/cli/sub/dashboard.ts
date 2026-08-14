/**
 * `pythinker dashboard` sub-command.
 *
 * CLI glue only: resolves the pythinker home, starts the in-process session
 * dashboard server (auto-picking a free port by default), prints the URL,
 * optionally opens the browser (with an optional session deep-link), then
 * waits for Ctrl-C and shuts the server down. The dashboard server itself
 * lives in `@pymodel/dashboard-server`.
 */

import type { Command } from 'commander';

import { createCliTelemetryBootstrap } from '#/cli/telemetry';
import { openUrl } from '#/utils/open-url';

interface WritableLike {
  write(chunk: string): boolean;
}

export interface StartedDashboardServer {
  readonly port: number;
  readonly host: string;
  readonly url: string;
  readonly close: () => Promise<void>;
}

export interface StartDashboardServerArgs {
  readonly homeDir: string;
  readonly port: number;
  readonly host?: string;
  readonly webAsset?: { gzipped: Uint8Array };
}

export interface DashboardDeps {
  readonly getHomeDir: () => string;
  readonly startDashboardServer: (opts: StartDashboardServerArgs) => Promise<StartedDashboardServer>;
  readonly openUrl: (url: string) => Promise<void>;
  readonly waitForShutdown: () => Promise<void>;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
}

export interface DashboardOptions {
  readonly open: boolean;
  readonly port?: number;
  readonly host?: string;
  readonly sessionId?: string;
}

export async function handleDashboard(deps: DashboardDeps, opts: DashboardOptions): Promise<void> {
  const homeDir = deps.getHomeDir();

  // Lazily load the embedded single-file SPA so normal `pythinker` startup never
  // pays for it. The module is generated at build time (prebuild). When running
  // from source without a build — e.g. tests — the generated value module is
  // absent and the dynamic import throws; in that case the server falls back to
  // its own static `public/` directory.
  let webAsset: { gzipped: Uint8Array } | undefined;
  try {
    const { DASHBOARD_WEB_GZIP_B64 } = await import('#/generated/dashboard-web-asset');
    if (DASHBOARD_WEB_GZIP_B64.length > 0) {
      webAsset = { gzipped: new Uint8Array(Buffer.from(DASHBOARD_WEB_GZIP_B64, 'base64')) };
    }
  } catch {
    // Embedded asset not generated in this context — fall back to filesystem.
  }

  let server: StartedDashboardServer;
  try {
    server = await deps.startDashboardServer({
      homeDir,
      port: opts.port ?? 0,
      ...(opts.host === undefined ? {} : { host: opts.host }),
      ...(webAsset === undefined ? {} : { webAsset }),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    deps.stderr.write(`Failed to start pythinker dashboard: ${msg}\n`);
    return deps.exit(1);
  }

  const target =
    opts.sessionId === undefined
      ? server.url
      : `${server.url}sessions/${encodeURIComponent(opts.sessionId)}`;

  deps.stdout.write(`pythinker dashboard is running at ${server.url}\n`);
  deps.stdout.write('Press Ctrl-C to stop.\n');

  if (opts.open) {
    try {
      await deps.openUrl(target);
    } catch {
      deps.stderr.write(`Could not open a browser; visit ${target} manually.\n`);
    }
  }

  await deps.waitForShutdown();
  await server.close();
}

export function registerDashboardCommand(parent: Command, overrides?: Partial<DashboardDeps>): void {
  parent
    .command('dashboard')
    .description('Launch the session dashboard in your browser.')
    .option('--port <number>', 'Port to bind. Default: auto-pick a free port.')
    .option('--host <host>', 'Host to bind. Default: 127.0.0.1.')
    .option('--no-open', 'Do not open the browser automatically.')
    .argument('[sessionId]', 'Open directly to this session.')
    .action(
      async (
        sessionId: string | undefined,
        options: { port?: string; host?: string; open?: boolean },
      ) => {
        const port = options.port === undefined ? undefined : Number.parseInt(options.port, 10);
        await handleDashboard(createDefaultDashboardDeps(overrides), {
          open: options.open !== false,
          ...(port === undefined || Number.isNaN(port) ? {} : { port }),
          ...(options.host === undefined ? {} : { host: options.host }),
          ...(sessionId === undefined ? {} : { sessionId }),
        });
      },
    );
}

function createDefaultDashboardDeps(overrides: Partial<DashboardDeps> = {}): DashboardDeps {
  return {
    getHomeDir: overrides.getHomeDir ?? (() => createCliTelemetryBootstrap().homeDir),
    startDashboardServer:
      overrides.startDashboardServer ??
      (async (opts) => {
        // Dynamic import keeps the dashboard server (and Hono) out of the hot path.
        const { startDashboardServer } = await import('@pymodel/dashboard-server/start');
        return startDashboardServer(opts);
      }),
    // `openUrl` is a synchronous fire-and-forget; adapt it to the async dep.
    openUrl:
      overrides.openUrl ??
      (async (url: string) => {
        openUrl(url);
      }),
    waitForShutdown: overrides.waitForShutdown ?? waitForSigint,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    exit: overrides.exit ?? ((code: number) => process.exit(code)),
  };
}

function waitForSigint(): Promise<void> {
  return new Promise<void>((resolve) => {
    const onSig = (): void => {
      process.off('SIGINT', onSig);
      resolve();
    };
    process.on('SIGINT', onSig);
  });
}
