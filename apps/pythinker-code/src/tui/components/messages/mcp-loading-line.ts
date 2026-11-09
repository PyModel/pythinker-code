import { Text } from '@pymodel/pi-tui';
import type { TUI } from '@pymodel/pi-tui';

import { STATUS_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';

const BLINK_INTERVAL_MS = 500;

/** Transient "Loading MCP: a, b" row with the same blinking bullet as running tools. */
export class McpLoadingLine extends Text {
  private blinkOn = true;
  private names: readonly string[];
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly ui: TUI,
    names: readonly string[],
  ) {
    super('', 1, 0);
    this.names = names;
    this.refresh();
    this.timer = setInterval(() => {
      this.blinkOn = !this.blinkOn;
      this.refresh();
    }, BLINK_INTERVAL_MS);
  }

  setNames(names: readonly string[]): void {
    this.names = names;
    this.refresh();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  private refresh(): void {
    const bullet = this.blinkOn ? currentTheme.fg('text', STATUS_BULLET) : '  ';
    const label = currentTheme.fg('textMuted', `Loading MCP: ${this.names.join(', ')}`);
    this.setText(`${bullet}${label}`);
    this.ui.requestRender();
  }
}
