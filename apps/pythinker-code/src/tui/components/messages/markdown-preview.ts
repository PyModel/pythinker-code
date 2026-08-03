import {
  Markdown,
  truncateToWidth,
  visibleWidth,
  type Component,
  type DefaultTextStyle,
} from '@earendil-works/pi-tui';

import {
  createPythinkerMarkdownTheme,
  createPythinkerThinkingMarkdownTheme,
  currentTheme,
} from '#/tui/theme';

type Prefix = string | (() => string);

export interface MarkdownPreviewOptions {
  readonly firstPrefix: Prefix;
  readonly continuationPrefix: Prefix;
  readonly tailRows?: number;
  readonly appearance?: 'default' | 'dim' | 'thinking';
}

export class MarkdownPreviewComponent implements Component {
  private markdown: Markdown;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;
  private palette = currentTheme.palette;

  constructor(
    private text: string,
    private readonly options: MarkdownPreviewOptions,
  ) {
    this.markdown = this.createMarkdown();
  }

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.markdown.setText(text);
    this.clearCache();
  }

  invalidate(): void {
    this.palette = currentTheme.palette;
    this.markdown = this.createMarkdown();
    this.clearCache();
  }

  render(width: number): string[] {
    if (this.palette !== currentTheme.palette) {
      this.invalidate();
    }

    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return [''];
    if (this.cachedWidth === safeWidth && this.cachedLines !== undefined) {
      return this.cachedLines;
    }

    const firstPrefix = this.resolvePrefix(this.options.firstPrefix);
    const continuationPrefix = this.resolvePrefix(this.options.continuationPrefix);
    const prefixWidth = Math.max(visibleWidth(firstPrefix), visibleWidth(continuationPrefix));
    const contentWidth = Math.max(1, safeWidth - prefixWidth);
    const rendered = this.text.length > 0 ? this.markdown.render(contentWidth) : [''];
    const tailRows = this.options.tailRows;
    const visibleRows =
      tailRows !== undefined && rendered.length > tailRows
        ? rendered.slice(rendered.length - tailRows)
        : rendered;
    const lines = visibleRows.map((line, index) =>
      truncateToWidth(
        `${index === 0 ? firstPrefix : continuationPrefix}${line}`,
        safeWidth,
        '…',
      ),
    );

    this.cachedWidth = safeWidth;
    this.cachedLines = lines;
    return lines;
  }

  private createMarkdown(): Markdown {
    const appearance = this.options.appearance ?? 'default';
    const defaultTextStyle: DefaultTextStyle | undefined =
      appearance === 'thinking'
        ? {
            color: (text) => currentTheme.fg('textDim', text),
            italic: true,
          }
        : appearance === 'dim'
          ? { color: (text) => currentTheme.fg('textDim', text) }
          : undefined;
    const theme =
      appearance === 'thinking'
        ? createPythinkerThinkingMarkdownTheme()
        : createPythinkerMarkdownTheme();
    return new Markdown(this.text, 0, 0, theme, defaultTextStyle);
  }

  private resolvePrefix(prefix: Prefix): string {
    return typeof prefix === 'function' ? prefix() : prefix;
  }

  private clearCache(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
