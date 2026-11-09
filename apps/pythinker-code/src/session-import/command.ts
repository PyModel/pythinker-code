import { setTelemetryContext, track, withTelemetryContext } from '@pymodel/pythinker-telemetry';
import { createPythinkerHarness, type TelemetryClient } from '@pymodel/pythinker-code-sdk';
import { ProcessTerminal, TuiMainScreen } from '@pymodel/pi-tui';
import type { Command } from 'commander';

import { createCliTelemetryBootstrap } from '#/cli/telemetry';
import { createPythinkerCodeHostIdentity } from '#/cli/version';

import { importBudget, importSessions, scanImportableSessions, sourceHomes } from './run-import';
import { ImportSessionsScreenComponent } from './screen';

export function registerImportSessionsCommand(
  parent: Command,
  run: () => Promise<number> = runImportSessionsCommand,
): void {
  parent
    .command('import-sessions')
    .description('Import recent Claude Code and Codex sessions into Pythinker Code.')
    .action(async () => {
      process.exitCode = await run();
    });
}

/** `pythinker import-sessions`: show only the import page in a bare terminal UI, then exit. */
export async function runImportSessionsCommand(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('pythinker import-sessions needs an interactive terminal.\n');
    return 1;
  }
  const telemetry: TelemetryClient = { track, withContext: withTelemetryContext, setContext: setTelemetryContext };
  const harness = createPythinkerHarness({
    homeDir: createCliTelemetryBootstrap().homeDir,
    identity: createPythinkerCodeHostIdentity(),
    telemetry,
  });
  try {
    const pythinkerHome = harness.homeDir;
    const budget = importBudget(await harness.getConfig().catch(() => ({})));
    const now = Date.now();
    const homes = sourceHomes();
    const ui = new TuiMainScreen(new ProcessTerminal());
    await new Promise<void>((resolve) => {
      const screen = new ImportSessionsScreenComponent({
        now,
        scan: () => scanImportableSessions({ pythinkerHome, ...homes, now }),
        run: (candidates, hooks) => importSessions(candidates, { pythinkerHome, ...budget, now, ...hooks }),
        requestRender: () => {
          ui.requestRender();
        },
        onClose: () => {
          resolve();
        },
      });
      ui.addChild(screen);
      ui.setFocus(screen);
      ui.start();
    });
    ui.stop();
    return 0;
  } finally {
    await harness.close();
  }
}
