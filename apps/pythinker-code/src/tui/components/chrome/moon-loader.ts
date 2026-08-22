import { Text, visibleWidth } from '@pymodel/pi-tui';
import type { TUI } from '@pymodel/pi-tui';

import {
  BRAILLE_SPINNER_FRAMES,
  BRAILLE_SPINNER_INTERVAL_MS,
  formatThinkingSpinnerLabel,
} from '#/tui/constant/rendering';
import { currentTheme } from '#/tui/theme';
import { shimmerText } from '#/tui/utils/shimmer';

export type SpinnerStyle = 'moon' | 'braille';

export interface MoonLoaderOptions {
  readonly verbLabels?: boolean;
}

export class MoonLoader extends Text {
  private currentFrame = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly ui: TUI;
  private readonly frames: string[];
  private readonly interval: number;
  private colorFn?: (s: string) => string;
  private label: string;
  private useVerbLabels = false;
  private displayText = '';
  // Inline text used when the spinner is embedded into another line (e.g. the
  // agent-dynamic_workflow progress status line). It intentionally excludes the tip: the
  // tip is only rendered when the loader sits on its own row in the activity
  // pane, otherwise it would get squeezed against whatever follows the inline
  // spinner (like the dynamic_workflow progress bar).
  private inlineText = '';
  private tip = '';
  private availableWidth = 0;

  constructor(
    ui: TUI,
    style: SpinnerStyle = 'moon',
    colorFn?: (s: string) => string,
    label = '',
    options?: MoonLoaderOptions,
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
      this.updateDisplay();
    }, this.interval);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  dispose(): void {
    this.stop();
  }

  setLabel(label: string): void {
    this.useVerbLabels = false;
    this.label = label;
    this.updateDisplay();
  }

  setVerbLabels(enabled: boolean): void {
    this.useVerbLabels = enabled;
    if (enabled) this.label = formatThinkingSpinnerLabel();
    this.updateDisplay();
  }

  setColorFn(colorFn: (s: string) => string): void {
    this.colorFn = colorFn;
    this.updateDisplay();
  }

  setTip(tip: string): void {
    this.tip = tip;
    this.updateDisplay();
  }

  setAvailableWidth(width: number): void {
    if (this.availableWidth === width) return;
    this.availableWidth = width;
    this.updateDisplay();
  }

  renderInline(): string {
    return this.inlineText;
  }

  private updateDisplay(): void {
    if (this.useVerbLabels) this.label = formatThinkingSpinnerLabel();
    const frame = this.frames[this.currentFrame]!;
    const coloredFrame = this.colorFn ? this.colorFn(frame) : frame;
    const renderedLabel = this.useVerbLabels
      ? shimmerText(this.label, {
          baseToken: 'primary',
          shimmerToken: 'primaryShimmer',
        })
      : this.label;
    const baseText = renderedLabel ? `${coloredFrame} ${renderedLabel}` : coloredFrame;
    this.inlineText = baseText;
    let text = baseText;
    if (this.tip) {
      const withTip = baseText + currentTheme.fg('textDim', this.tip);
      if (this.availableWidth === 0 || visibleWidth(withTip) <= this.availableWidth) {
        text = withTip;
      }
    }
    this.displayText = text;
    this.setText(this.displayText);
    this.ui.requestRender();
  }
}
