import { Text, truncateToWidth, type Component } from '@earendil-works/pi-tui';

import { MESSAGE_INDENT } from '#/tui/constant/rendering';
import { FAILURE_MARK, STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';
import type { BackgroundAgentStatusData } from '#/tui/types';

export class BackgroundAgentStatusComponent implements Component {
  constructor(private readonly data: BackgroundAgentStatusData) {}

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    // Only the bullet carries the status. A background task is ambient — it is
    // not what the user asked for — so the wording stays dim and the eye picks
    // the line out by colour of the dot alone, never by a fully coloured line.
    const bulletTone: keyof ColorPalette =
      this.data.phase === 'started'
        ? 'textDim'
        : this.data.phase === 'completed'
          ? 'success'
          : 'error';

    const bullet =
      this.data.phase === 'failed'
        ? currentTheme.fg(bulletTone, FAILURE_MARK)
        : currentTheme.fg(bulletTone, STATUS_BULLET);
    const text =
      currentTheme.fg('textDim', this.data.headline) +
      (this.data.detail !== undefined && this.data.detail.length > 0
        ? currentTheme.fg('textDim', ` (${this.data.detail})`)
        : '');

    const textComponent = new Text(text, 0, 0);
    const contentWidth = Math.max(1, safeWidth - MESSAGE_INDENT.length);
    const contentLines = textComponent.render(contentWidth);
    return [
      '',
      ...contentLines.map((line, index) => (index === 0 ? bullet : MESSAGE_INDENT) + line),
    ].map((line) => truncateToWidth(line, safeWidth, '…'));
  }
}
