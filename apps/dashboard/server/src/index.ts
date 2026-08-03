import { PYTHINKER_CODE_HOME, resolveHost, resolveDashboardAuthToken } from './config';
import { startDashboardServer } from './start';
import { formatStartupBanner } from './startup-banner';

async function main(): Promise<void> {
  const host = resolveHost();
  const authToken = resolveDashboardAuthToken(host);
  const { port } = await startDashboardServer({ host, authToken });
  process.stdout.write(
    formatStartupBanner({ authToken, host, pythinkerCodeHome: PYTHINKER_CODE_HOME, port }),
  );
}

try {
  await main();
} catch (error: unknown) {
  process.stderr.write(
    `[dashboard-server] fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
}
