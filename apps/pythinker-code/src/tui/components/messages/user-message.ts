/**
 * Renders a user message in the transcript.
 */

import {
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from '@pymodel/pi-tui';

import { ImageThumbnail } from '#/tui/components/media/image-thumbnail';
import { USER_MESSAGE_BULLET } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ImageAttachment } from '#/tui/utils/image-attachment-store';
import { findInlineSkillTokens } from '#/tui/utils/inline-skill-tokens';
import { markOsc133Zone } from '#/tui/utils/osc133';
import { isRenderCacheEnabled } from '#/tui/utils/render-cache';

export function firstContentLineIndex(lines: string[]): number {
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === '') first++;
  return first;
}

export function userMessageLineHeights(text: string, width: number, bullet?: string): number[] {
  const marker = bullet ?? USER_MESSAGE_BULLET;
  const contentWidth = Math.max(1, width - visibleWidth(marker));
  const lines = text.split(/\r?\n/);
  return lines
    .slice(firstContentLineIndex(lines))
    .map((line) => wrapTextWithAnsi(line.replaceAll('\t', '   '), contentWidth).length);
}

export class UserMessageComponent implements Component {
  private text: string;
  private readonly bullet?: string;
  private readonly skillNames?: readonly string[];
  private spacerComponent: Spacer;
  private imageThumbnails: ImageThumbnail[];

  private renderCache: { width: number; lines: string[] } | undefined;

  constructor(
    text: string,
    images?: ImageAttachment[],
    bullet?: string,
    skillNames?: readonly string[],
  ) {
    this.text = text;
    this.bullet = bullet;
    this.skillNames = skillNames;
    this.spacerComponent = new Spacer(1);
    this.imageThumbnails = images?.map((img) => new ImageThumbnail(img)) ?? [];
  }

  private markRenderDirty(): void {
    this.renderCache = undefined;
  }

  colorText(
    text: string,
    paint: (segment: string) => string = (segment) => currentTheme.boldFg('roleUser', segment),
  ): string {
    const names = this.skillNames;
    if (names === undefined || names.length === 0) {
      return paint(text);
    }
    const known = new Set(names.map(normalizeSkillTokenName));
    const tokens = findInlineSkillTokens(text, {
      isKnownSkill: (commandName) => known.has(normalizeSkillTokenName(commandName)),
      includeLeading: true,
    });
    if (tokens.length === 0) {
      return paint(text);
    }
    const segments: string[] = [];
    let cursor = 0;
    for (const token of tokens) {
      if (token.start > cursor) {
        segments.push(paint(text.slice(cursor, token.start)));
      }
      segments.push(currentTheme.boldFg('primary', text.slice(token.start, token.end)));
      cursor = token.end;
    }
    if (cursor < text.length) {
      segments.push(paint(text.slice(cursor)));
    }
    return segments.join('');
  }

  invalidate(): void {
    this.markRenderDirty();
    for (const img of this.imageThumbnails) {
      img.invalidate?.();
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth <= 0) return [''];

    if (
      isRenderCacheEnabled() &&
      this.renderCache !== undefined &&
      this.renderCache.width === safeWidth
    ) {
      return this.renderCache.lines;
    }

    const marker = this.bullet ?? USER_MESSAGE_BULLET;
    const isRoleMessage = marker.length > 0;
    const bullet = isRoleMessage ? currentTheme.boldFg('roleUser', marker) : '';
    const bulletWidth = visibleWidth(bullet);
    const contentWidth = Math.max(1, safeWidth - bulletWidth);

    const lines: string[] = [];

    // Spacer
    for (const line of this.spacerComponent.render(safeWidth)) {
      lines.push(line);
    }

    // Text is re-dyed from the current theme; invalidate() (theme change) clears
    // the render cache so the new colours are picked up on the next render.
    const paint = isRoleMessage
      ? (segment: string) => currentTheme.fg('textStrong', segment)
      : (segment: string) => segment;
    const textLines = new Text(this.colorText(this.text, paint), 0, 0).render(contentWidth);
    for (let i = 0; i < textLines.length; i++) {
      const prefix = i === 0 ? bullet : ' '.repeat(bulletWidth);
      const line = prefix + textLines[i];
      lines.push(
        isRoleMessage
          ? currentTheme.bg(
              'surfaceHighlight',
              line + ' '.repeat(Math.max(0, safeWidth - visibleWidth(line))),
            )
          : line,
      );
    }

    // Images — indented to align with text after the bullet
    for (const thumbnail of this.imageThumbnails) {
      const imageLines = thumbnail.render(contentWidth);
      for (const line of imageLines) {
        lines.push(' '.repeat(bulletWidth) + line);
      }
    }

    const rendered = markOsc133Zone(
      lines.map((line) => {
        // Inline image sequences (Kitty / iTerm2) carry their own placement
        // information and have zero visible width, but pi-tui's truncateToWidth
        // treats the embedded base64 payload as visible text and would chop the
        // escape sequence in half, leaving garbage like "0m...". Skip truncation
        // for those lines; the image itself already respects maxWidthCells.
        if (isImageLine(line)) return line;
        return truncateToWidth(line, safeWidth, '…');
      }),
    );
    if (isRenderCacheEnabled()) {
      this.renderCache = { width: safeWidth, lines: rendered };
    }
    return rendered;
  }
}

function normalizeSkillTokenName(name: string): string {
  return name.startsWith('skill:') ? name.slice('skill:'.length) : name;
}

function isImageLine(line: string): boolean {
  return line.includes('\u001B_G') || line.includes('\u001B]1337;File=');
}

/**
 * Invisible turn-boundary marker for replay. Some replayed records start a
 * new turn without anything to show — the goal driver's synthetic
 * continuation prompt is model-facing and never rendered live — but the
 * transcript still needs a mounted boundary component so step/assistant
 * folding (and window trimming) can find the turn edges. Renders zero lines.
 */
export class ReplayTurnBoundaryComponent implements Component {
  invalidate(): void {}
  render(_width: number): string[] {
    return [];
  }
}
