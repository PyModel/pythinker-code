import chalk from 'chalk';
import { truncateToWidth, visibleWidth } from '@pymodel/pi-tui';

export function paintHoverRow(line: string, width: number, background: string): string {
  const clipped = truncateToWidth(line, width);
  const padding = ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
  return chalk.bgHex(background)(clipped + padding);
}
