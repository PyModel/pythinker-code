/**
 * Terminal rendering of the Pythinker robot mark.
 * Derived from apps/pythinker-web/public/pythinker_animated.svg and the
 * installer logo art in apps/pythinker-web/public/install.sh.
 */

import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';

/** Brand palette sampled from pythinker_animated.svg. */
export const PYTHINKER_LOGO_COLORS = {
  body: '#213853',
  bodyMid: '#495F7C',
  face: '#F9F2F5',
  faceDim: '#DFDCDF',
  accent: '#8CA0F5',
  accentDeep: '#7B8CE8',
  /** Antenna bulb — coral, so the head's highlight reads against the
   *  periwinkle brand rather than blending into it. Kept separate from
   *  `ear` so the two can diverge without touching the shared accent. */
  antenna: '#EE9983',
  /** Side ears — coral, matching the antenna bulb. */
  ear: '#EE9983',
  eye: '#AFE3F1',
  eyeRing: '#3A506D',
} as const;

/** Plain-text robot mark — five rows, fixed layout. */
export const PYTHINKER_LOGO_LINES = [
  '      ●',
  '      │',
  '  ▛▀▀▀▀▀▀▀▜',
  ' ◖█ ◉   ◉ █◗',
  '  ▙▄▄▄≡▄▄▄▟',
] as const;

export const PYTHINKER_LOGO_WIDTH = Math.max(
  ...PYTHINKER_LOGO_LINES.map((row) => visibleWidth(row)),
);

/** Row/column of each eye on the face line — matches install.sh / install.ps1 grid. */
export const LOGO_EYE_ROW = 3;
export const LOGO_LEFT_EYE_COL = 4;
export const LOGO_RIGHT_EYE_COL = 8;

/** Antenna bulb cell on row 0. */
export const LOGO_ANTENNA_ROW = 0;
export const LOGO_ANTENNA_COL = 6;

/** Antenna spin frames — half-shaded circles read as a clockwise rotation. */
export const ANTENNA_SPINNER_FRAMES = ['◐', '◓', '◑', '◒'] as const;

/** Eye phases from the installer `_blink_eyes` / `Blink-Eye` sequence. */
export type EyeBlinkPhase = 'open' | 'glance' | 'closed' | 'open-shine';

export interface LogoEyeBlinkState {
  readonly left: EyeBlinkPhase;
  readonly right: EyeBlinkPhase;
}

export const LOGO_EYES_OPEN: LogoEyeBlinkState = { left: 'open', right: 'open' };

/** Bright flash tone used when an eye opens — installer `$SHINE`. */
export const PYTHINKER_LOGO_EYE_SHINE = '#FFFFFF';

type LogoStyler = (text: string) => string;

function segment(line: string, ranges: Array<[number, number, LogoStyler]>): string {
  let out = '';
  let cursor = 0;
  for (const [start, end, style] of ranges) {
    if (cursor < start) {
      out += line.slice(cursor, start);
    }
    out += style(line.slice(start, end));
    cursor = end;
  }
  if (cursor < line.length) {
    out += line.slice(cursor);
  }
  return out;
}

function body(text: string): string {
  return chalk.hex(PYTHINKER_LOGO_COLORS.body)(text);
}

function face(text: string): string {
  return chalk.hex(PYTHINKER_LOGO_COLORS.face)(text);
}

function antenna(text: string): string {
  return chalk.hex(PYTHINKER_LOGO_COLORS.antenna)(text);
}

function ear(text: string): string {
  return chalk.hex(PYTHINKER_LOGO_COLORS.ear)(text);
}

function eye(text: string): string {
  return chalk.hex(PYTHINKER_LOGO_COLORS.eye)(text);
}

function eyeShine(text: string): string {
  return chalk.hex(PYTHINKER_LOGO_EYE_SHINE)(text);
}

function eyeGlyphStyle(phase: EyeBlinkPhase): LogoStyler {
  switch (phase) {
    case 'glance':
    case 'open-shine':
      return eyeShine;
    case 'closed':
      return eye;
    case 'open':
      return eye;
  }
}

function eyeGlyphChar(phase: EyeBlinkPhase): string {
  return phase === 'closed' ? '─' : '◉';
}

/** Paint the face row with per-eye blink phases (installer `_blink_eyes` design). */
export function renderPythinkerLogoEyeRow(state: LogoEyeBlinkState): string {
  if (state.left === 'open' && state.right === 'open') {
    return renderPythinkerLogoLine(LOGO_EYE_ROW);
  }

  const plain = PYTHINKER_LOGO_LINES[LOGO_EYE_ROW];
  const chars = Array.from(plain);

  const placeEye = (col: number, phase: EyeBlinkPhase): void => {
    if (phase === 'glance') {
      chars[col - 1] = eyeGlyphChar(phase);
      if (col < chars.length) chars[col] = ' ';
      return;
    }
    chars[col] = eyeGlyphChar(phase);
  };

  placeEye(LOGO_LEFT_EYE_COL, state.left);
  placeEye(LOGO_RIGHT_EYE_COL, state.right);
  const line = chars.join('');

  const ranges: Array<[number, number, LogoStyler]> = [
    [1, 2, ear],
    [2, 3, body],
    [10, 11, body],
    [11, 12, ear],
  ];

  const stampEye = (col: number, phase: EyeBlinkPhase): void => {
    const glyph = eyeGlyphChar(phase);
    const at = phase === 'glance' ? col - 1 : col;
    const end = at + glyph.length;
    ranges.push([at, end, eyeGlyphStyle(phase)]);
  };

  stampEye(LOGO_LEFT_EYE_COL, state.left);
  stampEye(LOGO_RIGHT_EYE_COL, state.right);

  ranges.sort((a, b) => a[0] - b[0]);
  return segment(line, ranges);
}

/** Paint the antenna row with a spinner frame in place of the static bulb. */
export function renderPythinkerLogoAntennaRow(frameIndex: number): string {
  const frame =
    ANTENNA_SPINNER_FRAMES[frameIndex % ANTENNA_SPINNER_FRAMES.length] ?? '●';
  const chars = Array.from(PYTHINKER_LOGO_LINES[LOGO_ANTENNA_ROW]);
  chars[LOGO_ANTENNA_COL] = frame;
  const line = chars.join('');
  return segment(line, [
    [LOGO_ANTENNA_COL, LOGO_ANTENNA_COL + frame.length, antenna],
  ]);
}

export function renderPythinkerLogoWithEyes(
  state: LogoEyeBlinkState = LOGO_EYES_OPEN,
  antennaFrame?: number,
): string[] {
  return PYTHINKER_LOGO_LINES.map((_, index) => {
    if (index === LOGO_EYE_ROW) return renderPythinkerLogoEyeRow(state);
    if (index === LOGO_ANTENNA_ROW && antennaFrame !== undefined) {
      return renderPythinkerLogoAntennaRow(antennaFrame);
    }
    return renderPythinkerLogoLine(index);
  });
}

/** Paint one logo row with SVG-accurate brand colors. */
export function renderPythinkerLogoLine(index: number): string {
  switch (index) {
    case 0:
      return segment(PYTHINKER_LOGO_LINES[0], [[6, 7, antenna]]);
    case 1:
      return segment(PYTHINKER_LOGO_LINES[1], [[6, 7, body]]);
    case 2:
      return segment(PYTHINKER_LOGO_LINES[2], [
        [2, 3, body],
        [3, 10, face],
        [10, 11, body],
      ]);
    case 3:
      return segment(PYTHINKER_LOGO_LINES[3], [
        [1, 2, ear],
        [2, 3, body],
        [4, 5, eye],
        [8, 9, eye],
        [10, 11, body],
        [11, 12, ear],
      ]);
    case 4:
      return segment(PYTHINKER_LOGO_LINES[4], [
        [2, 3, body],
        [3, 6, body],
        [6, 7, face],
        [7, 10, body],
        [10, 11, body],
      ]);
    default:
      return PYTHINKER_LOGO_LINES[index] ?? '';
  }
}

export function renderPythinkerLogo(): string[] {
  return PYTHINKER_LOGO_LINES.map((_, index) => renderPythinkerLogoLine(index));
}

function padColored(text: string, targetWidth: number): string {
  const vis = visibleWidth(text);
  if (vis >= targetWidth) return text;
  return text + ' '.repeat(targetWidth - vis);
}

export interface WelcomeHeaderSideText {
  eyebrow: string;
  title: string;
  tagline: string;
  prompt: string;
}

function resolveSideTextRows(sideText: WelcomeHeaderSideText): string[] {
  const slots = [sideText.eyebrow, sideText.title, sideText.tagline, sideText.prompt];
  const firstSlot = sideText.eyebrow;
  const sideRows = Array<string>(PYTHINKER_LOGO_LINES.length).fill('');
  const content = slots.filter((text) => text.length > 0);
  if (content.length === 0) {
    return sideRows;
  }

  const welcomeCopyLayout =
    firstSlot.length === 0 &&
    content.length === 3 &&
    slots.slice(1).every((text) => text.length > 0);

  const startRow = welcomeCopyLayout
    ? PYTHINKER_LOGO_LINES.length - content.length
    : firstSlot.length > 0
      ? 0
      : Math.max(0, Math.floor((PYTHINKER_LOGO_LINES.length - content.length) / 2));

  for (let index = 0; index < content.length; index++) {
    sideRows[startRow + index] = content[index]!;
  }

  return sideRows;
}

export function buildLogoHeaderRows(
  textWidth: number,
  sideText: WelcomeHeaderSideText,
  colorLogoLine: (index: number, plain: string) => string,
  gap = '  ',
): string[] {
  const sideRows = resolveSideTextRows(sideText);
  const rows: string[] = [];

  for (let index = 0; index < PYTHINKER_LOGO_LINES.length; index++) {
    const plainLogoLine = PYTHINKER_LOGO_LINES[index];
    if (plainLogoLine === undefined) continue;
    const logo = padColored(
      colorLogoLine(index, plainLogoLine),
      PYTHINKER_LOGO_WIDTH,
    );
    const text = truncateToWidth(sideRows[index] ?? '', textWidth, '…');
    rows.push(logo + gap + text);
  }

  return rows;
}
