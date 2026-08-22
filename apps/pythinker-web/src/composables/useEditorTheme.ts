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

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

function readTokens(): ThemeTokens {
  return {
    bg: cssVar('--p-bg', '#ffffff'),
    surface: cssVar('--color-surface', '#fafbfc'),
    text: cssVar('--color-text', '#14171c'),
    textMuted: cssVar('--color-text-muted', '#6b7280'),
    line: cssVar('--color-line', '#e7eaee'),
    accent: cssVar('--color-accent', '#1783ff'),
    accentSoft: cssVar('--p-accent-soft', 'rgba(23,131,255,.14)'),
    selection: cssVar('--p-selection', 'rgba(23,131,255,.18)'),
    danger: cssVar('--color-danger', '#c0392b'),
    warning: cssVar('--color-warning', '#a9610a'),
    success: cssVar('--color-success', '#0e7a38'),
  };
}

function defineTheme(monaco: MonacoModule, dark: boolean): void {
  const t = readTokens();
  monaco.editor.defineTheme(dark ? EDITOR_THEME_DARK : EDITOR_THEME_LIGHT, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: t.textMuted.replace('#', ''), fontStyle: 'italic' },
      { token: 'string', foreground: t.success.replace('#', '') },
      { token: 'keyword', foreground: t.accent.replace('#', '') },
      { token: 'number', foreground: t.warning.replace('#', '') },
      { token: 'type', foreground: t.accent.replace('#', '') },
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
