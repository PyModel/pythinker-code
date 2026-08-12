import { sep } from 'node:path';

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui';
import chalk from 'chalk';

import type { FooterStatus } from '#/tui/runtime/footer/footer-model';
import { currentTheme } from '#/tui/theme';
import { themeFromHexChannels } from '#/tui/theme/terminal-background';
import { effortColorToken, shortEffortLabel } from '#/tui/utils/thinking-levels';
import { sessionAccentHex } from '#/tui/utils/session-accent';

export type StatusBarStatus = Pick<
  FooterStatus,
  | 'model'
  | 'thinkingLevel'
  | 'cwd'
  | 'homeDir'
  | 'permissionMode'
  | 'planMode'
  | 'fastMode'
  | 'dynamicWorkflowMode'
> & {
  readonly extras: readonly string[];
  readonly sessionKey: string;
};

export class StatusBarComponent implements Component {
  private status: StatusBarStatus | undefined;

  update(status: StatusBarStatus): void {
    this.status = status;
  }

  render(width: number): string[] {
    const status = this.status;
    if (status === undefined) return [];

    const modelChip = chip(
      `${currentTheme.fg('text', status.model)}${currentTheme.fg('textDim', ' · ')}${currentTheme.fg(
        effortColorToken(status.thinkingLevel),
        shortEffortLabel(status.thinkingLevel),
      )}`,
    );
    let modesChip = renderModesChip(status);
    const extraChips = status.extras.map((extra) =>
      chip(currentTheme.fg('textDim', extra)),
    );
    let cwdChip: string | undefined = chip(
      currentTheme.fg('textDim', shortenCwd(status.cwd, status.homeDir)),
    );
    const left = (): string =>
      [modelChip, modesChip, ...extraChips]
        .filter((item): item is string => item !== undefined)
        .join(' ');
    const fullGapWidth =
      width - visibleWidth(left()) - (cwdChip === undefined ? 1 : visibleWidth(cwdChip) + 2);

    let line: string;
    if (fullGapWidth > 0) {
      const background = currentTheme.color('background');
      const mode = themeFromHexChannels(
        background.slice(1, 3),
        background.slice(3, 5),
        background.slice(5, 7),
      );
      const gap = chalk.hex(sessionAccentHex(status.sessionKey, mode))('─'.repeat(fullGapWidth));
      line = cwdChip === undefined ? `${left()} ${gap}` : `${left()} ${gap} ${cwdChip}`;
    } else {
      line = `${left()}${cwdChip === undefined ? '' : ` ${cwdChip}`}`;
      while (visibleWidth(line) > width && extraChips.length > 0) {
        extraChips.pop();
        line = `${left()}${cwdChip === undefined ? '' : ` ${cwdChip}`}`;
      }
      if (visibleWidth(line) > width && modesChip !== undefined) {
        modesChip = undefined;
        line = `${left()}${cwdChip === undefined ? '' : ` ${cwdChip}`}`;
      }
      if (visibleWidth(line) > width && cwdChip !== undefined) {
        cwdChip = undefined;
        line = left();
      }
    }

    return [truncateToWidth(line, Math.max(0, width))];
  }

  invalidate(): void {}
}

function chip(content: string): string {
  return currentTheme.bg('surfaceHighlight', ` ${content} `);
}

function renderModesChip(status: StatusBarStatus): string | undefined {
  const modes: string[] = [];
  if (status.planMode) modes.push(currentTheme.fg('modePlan', 'plan'));
  if (status.permissionMode === 'auto') modes.push(currentTheme.fg('modePermission', 'auto'));
  if (status.permissionMode === 'yolo') modes.push(currentTheme.fg('modeAutoAccept', 'yolo'));
  if (status.fastMode) modes.push(currentTheme.fg('modeFast', '↯ fast'));
  if (status.dynamicWorkflowMode) modes.push(currentTheme.fg('accent', 'workflow'));
  return modes.length === 0 ? undefined : chip(modes.join(' '));
}

function shortenCwd(cwd: string, homeDir: string | null): string {
  if (homeDir === null || homeDir.length === 0) return cwd;
  if (cwd === homeDir) return '~';
  return cwd.startsWith(`${homeDir}${sep}`) ? `~${cwd.slice(homeDir.length)}` : cwd;
}
