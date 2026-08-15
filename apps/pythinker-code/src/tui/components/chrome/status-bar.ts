import { sep } from 'node:path';

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui';
import chalk from 'chalk';

import type { StatusLineConfig } from '#/tui/config';
import {
  formatTokenSpeed,
  type FooterStatus,
} from '#/tui/runtime/footer/footer-model';
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
  | 'tokenSpeed'
  | 'tokenSpeedEstimated'
> & {
  readonly extras: readonly string[];
  /** The `extras` entry that carries the update notice, painted in `warning`. */
  readonly updateExtra?: string;
  readonly sessionKey: string;
  readonly statusLine: StatusLineConfig;
};

export class StatusBarComponent implements Component {
  private status: StatusBarStatus | undefined;

  update(status: StatusBarStatus): void {
    this.status = status;
  }

  render(width: number): string[] {
    const status = this.status;
    if (status === undefined) return [];

    const effortSuffix = status.statusLine.showEffort && status.thinkingLevel !== 'off'
      ? `${currentTheme.fg('textDim', ' · ')}${currentTheme.fg(
          effortColorToken(status.thinkingLevel),
          shortEffortLabel(status.thinkingLevel),
        )}`
      : '';
    const fastSuffix = status.statusLine.showModes && status.fastMode
      ? `${currentTheme.fg('textDim', ' · ')}${currentTheme.fg('modeFast', '↯ fast')}`
      : '';
    const speed = status.statusLine.showTokenSpeed ? formatTokenSpeed(status) : null;
    const modelChip = status.statusLine.showModel
      ? chip(
          `${currentTheme.fg('text', status.model)}${effortSuffix}${fastSuffix}${
            speed === null ? '' : currentTheme.fg('textDim', ` · ${speed}`)
          }`,
        )
      : undefined;
    let modesChip = status.statusLine.showModes ? renderModesChip(status) : undefined;
    const extraChips = status.extras.map((extra) =>
      chip(currentTheme.fg(extra === status.updateExtra ? 'warning' : 'textDim', extra)),
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
  if (status.permissionMode === 'yolo') modes.push(currentTheme.fg('error', 'yolo'));
  if (status.dynamicWorkflowMode) modes.push(currentTheme.fg('accent', 'workflow'));
  return modes.length === 0 ? undefined : chip(modes.join(' '));
}

function shortenCwd(cwd: string, homeDir: string | null): string {
  const path = homeDir !== null && homeDir.length > 0
    ? cwd === homeDir
      ? '~'
      : cwd.startsWith(`${homeDir}${sep}`)
        ? `~${cwd.slice(homeDir.length)}`
        : cwd
    : cwd;
  const segments = path.startsWith(`~${sep}`)
    ? path.slice(2).split(sep)
    : path.startsWith(sep)
      ? path.slice(1).split(sep)
      : [];
  return segments.length > 2 ? `…${sep}${segments.slice(-2).join(sep)}` : path;
}
