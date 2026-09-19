import type { Command } from 'commander';

import { pythinkerCodeOfficialInstallUrl } from '#/constant/app';
import { openUrl } from '#/utils/open-url';

export function registerInstallAppCommand(program: Command): void {
  program
    .command('install-app')
    .description('Print the Pythinker Code desktop app page and open it in your browser.')
    .action(() => {
      const url = pythinkerCodeOfficialInstallUrl();
      process.stdout.write(`${url}\n`);
      openUrl(url);
    });
}
