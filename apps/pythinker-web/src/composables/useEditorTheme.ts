// apps/pythinker-web/src/composables/useEditorTheme.ts
// Bridges the app's design tokens (src/style.css) into two custom Monaco
// themes, `pythinker-light` / `pythinker-dark`. Token values are read from
// computed style at theme-build time so the editor always matches the live
// palette; themes are rebuilt whenever the color scheme flips (useIsDark).

import { watch } from 'vue';
import { useIsDark } from './useIsDark';

export const EDITOR_THEME_LIGHT = 'pythinker-light';
export const EDITOR_THEME_DARK = 'pythinker-dark';

type MonacoModule = typeof import('monaco-editor');

type ThemeTokens = {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  line: string;
  accent: string;
  accentSoft: string;
  selection: string;
  danger: string;
  warning: string;
  success: string;
};

/**
 * Normalizes a CSS color to the `#RRGGBB`/`#RRGGBBAA` form Monaco accepts.
 * Monaco matches every theme color against `/^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/`
 * and *throws* `Illegal value for token color` from `setTheme` on a miss, so an
 * `rgba(...)` design token takes the whole editor down rather than degrading.
 * Several palette tokens (`--p-selection`, `--color-text-muted`) are declared
 * as `rgba()`, so normalization has to happen before `defineTheme` sees them.
 * Anything unparseable falls back rather than reaching Monaco.
 */
export function toMonacoHex(value: string, fallback: string): string {
  const input = value.trim();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(input)) return input;
  if (/^#[0-9a-f]{3,4}$/i.test(input)) {
    return `#${Array.from(input.slice(1), (digit) => digit + digit).join('')}`;
  }
  const channels = /^rgba?\(([^)]*)\)$/i.exec(input);
  if (channels === null) return fallback;
  const parts = channels[1]!.split(/[\s,/]+/).filter((part) => part.length > 0);
  if (parts.length < 3 || parts.length > 4) return fallback;
  const bytes = parts.slice(0, 3).map((part) => channelByte(part, 255));
  const alpha = parts.length === 4 ? channelByte(parts[3]!, 1) : 255;
  if (bytes.some((byte) => byte === null) || alpha === null) return fallback;
  const hex = [...bytes, alpha === 255 ? null : alpha]
    .filter((byte): byte is number => byte !== null)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

/** One `rgb()` channel to a 0-255 byte; `scale` is the value meaning full. */
function channelByte(part: string, scale: number): number | null {
  const percent = part.endsWith('%');
  const raw = Number(percent ? part.slice(0, -1) : part);
  if (!Number.isFinite(raw)) return null;
  const ratio = percent ? raw / 100 : raw / scale;
  return Math.max(0, Math.min(255, Math.round(ratio * 255)));
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return toMonacoHex(value.length > 0 ? value : fallback, fallback);
}

function readTokens(): ThemeTokens {
  return {
    bg: cssVar('--p-bg', '#ffffff'),
    surface: cssVar('--color-surface', '#fafbfc'),
    text: cssVar('--color-text', '#14171c'),
    textMuted: cssVar('--color-text-muted', '#6b7280'),
    line: cssVar('--color-line', '#e7eaee'),
    accent: cssVar('--color-accent', '#1783ff'),
    accentSoft: cssVar('--p-accent-soft', '#1783ff24'),
    selection: cssVar('--p-selection', '#1783ff2e'),
    danger: cssVar('--color-danger', '#c0392b'),
    warning: cssVar('--color-warning', '#a9610a'),
    success: cssVar('--color-success', '#0e7a38'),
  };
}

/** Token rules take a bare 6-digit hex; Monaco discards any alpha pair. */
function tokenRuleColor(value: string): string {
  return value.slice(1, 7);
}

function defineTheme(monaco: MonacoModule, dark: boolean): void {
  const t = readTokens();
  monaco.editor.defineTheme(dark ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: tokenRuleColor(t.textMuted), fontStyle: 'italic' },
      { token: 'string', foreground: tokenRuleColor(t.success) },
      { token: 'keyword', foreground: tokenRuleColor(t.accent) },
      { token: 'number', foreground: tokenRuleColor(t.warning) },
      { token: 'type', foreground: tokenRuleColor(t.accent) },
    ],
    colors: {
      'editor.background': t.bg,
      'editor.foreground': t.text,
      'editorLineNumber.foreground': t.textMuted,
      'editorLineNumber.activeForeground': t.text,
      'editor.selectionBackground': t.selection,
      'editor.lineHighlightBackground': t.surface,
      'editorCursor.foreground': t.accent,
      'editorIndentGuide.background1': t.line,
      'editorIndentGuide.activeBackground1': t.textMuted,
      'editorWidget.background': t.surface,
      'editorWidget.border': t.line,
      'editorError.foreground': t.danger,
      'editorWarning.foreground': t.warning,
      'scrollbarSlider.background': t.accentSoft,
      'scrollbarSlider.hoverBackground': t.accentSoft,
      'scrollbarSlider.activeBackground': t.accent,
    },
  });
}

function applyCurrent(monaco: MonacoModule, dark: boolean): void {
  defineTheme(monaco, dark);
  monaco.editor.setTheme(dark ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT);
}

const isDark = useIsDark();
let themeReady: Promise<void> | null = null;

function ensureTheme(): Promise<void> {
  themeReady ??= import('monaco-editor').then((monaco) => {
    applyCurrent(monaco, isDark.value);
    watch(isDark, () => applyCurrent(monaco, isDark.value));
  });
  return themeReady;
}

/** Name of the pythinker theme matching the current color scheme. */
export function currentEditorThemeName(): string {
  return isDark.value ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT;
}

/**
 * Ensures the pythinker themes exist (and keep tracking scheme flips for the
 * app lifetime). Idempotent; resolves once the theme has been defined.
 */
export function useEditorTheme(): Promise<void> {
  return ensureTheme();
}
