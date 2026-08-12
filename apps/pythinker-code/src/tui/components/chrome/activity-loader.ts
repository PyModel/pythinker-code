import { Text } from '@earendil-works/pi-tui';
import type { TUI } from '@earendil-works/pi-tui';

import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  formatThinkingSpinnerLabel,
} from '#/tui/constant/rendering';
import { shimmerText } from '#/tui/utils/shimmer';

export interface ActivityLoaderOptions {
  readonly verbLabels?: boolean;
}

export class ActivityLoader extends Text {
  private currentFrame = 0;
  private animationFrame = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private ui: TUI;
  private frames: string[];
  private interval: number;
  private colorFn?: (s: string) => string;
  private label: string;
  private useVerbLabels = false;
  private displayText = '';

  constructor(
    ui: TUI,
    colorFn?: (s: string) => string,
    label: string = '',
    options?: ActivityLoaderOptions,
  ) {
    super('', 1, 0);
    this.ui = ui;
    this.frames = [...BRAILLE_SPINNER_FRAMES];
    this.interval = BRAILLE_SPINNER_INTERVAL_MS;
    this.colorFn = colorFn;
    this.useVerbLabels = options?.verbLabels ?? false;
    this.label = this.useVerbLabels ? formatThinkingSpinnerLabel() : label;
    this.start();
  }

  start(): void {
    this.updateDisplay();
    this.intervalId = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.animationFrame += 1;
      this.updateDisplay();
    }, this.interval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setLabel(label: string): void {
    this.useVerbLabels = false;
    this.label = label;
    this.updateDisplay();
  }

  setVerbLabels(enabled: boolean): void {
    this.useVerbLabels = enabled;
    if (enabled) {
      this.label = formatThinkingSpinnerLabel();
    }
    this.updateDisplay();
  }

  setColorFn(colorFn: (s: string) => string): void {
    this.colorFn = colorFn;
    this.updateDisplay();
  }

  renderInline(): string {
    return this.displayText;
  }

  private updateDisplay(): void {
    if (this.useVerbLabels) {
      this.label = formatThinkingSpinnerLabel();
    }
    const frame = this.frames[this.currentFrame]!;
    const coloredFrame = this.colorFn ? this.colorFn(frame) : frame;
    const label = this.useVerbLabels
      ? shimmerText(this.label, {
          baseToken: 'primary',
          shimmerToken: 'primaryShimmer',
        })
      : this.label;
    this.displayText = label ? `${coloredFrame} ${label}` : coloredFrame;
    this.setText(this.displayText);
    this.ui.requestRender();
  }
}
