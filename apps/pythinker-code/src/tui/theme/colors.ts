/**
 * Color palette definitions for dark and light themes.
 *
 * `darkColors` / `lightColors` are the semantic `ColorPalette` consumed by
 * every UI component via the global Theme singleton. Each token holds its hex
 * value directly — see the per-token docs on `ColorPalette` for what each one
 * controls.
 *
 * Light palette values are tuned for ≥ 4.5:1 contrast against #FFFFFF
 * for text tokens and ≥ 3:1 for chrome (border / large text), matching
 * WCAG AA.
 */

// Each token below documents where it is actually consumed, so theme authors
// know what changing it affects. "Widely" means the token is read across most
// dialogs/messages rather than in one specific place.
export interface ColorPalette {
  // ── Brand ──
  /** Dominant interactive/brand colour: links & inline code, the selected item
   *  in nearly every dialog, the focused editor border, plan/"running" badges,
   *  spinners. The most widely used token. */
  primary: string;
  /** Secondary highlight: approval "▶" prefix, device-code box, image
   *  placeholder, BTW / queue panes, custom-registry import. */
  accent: string;

  // ── Shimmer ──
  /** Brighter primary pulse for future spinner and running-state animations. */
  primaryShimmer: string;
  /** Brighter accent pulse for future device-code and queue-pane animations. */
  accentShimmer: string;
  /** Brighter warning pulse for future stale-state and attention animations. */
  warningShimmer: string;
  /** Brighter border pulse for future focused-panel border animations. */
  borderShimmer: string;
  /** Brighter dim-text pulse for future thinking and status animations. */
  textDimShimmer: string;

  // ── Text ──
  /** Default body text: dialog bodies, todo titles, footer model label,
   *  markdown headings, tool/read output, and assistant-side message bullets
   *  (assistant / tool / agent / read) plus markdown list bullets. */
  text: string;
  /** Emphasised text: input dialogs, status messages, high-signal tool names, user transcript text. */
  textStrong: string;
  /** Secondary, dimmed text (the most widely used dim shade): thinking blocks,
   *  hints, descriptions, completed todos, markdown quotes, and the footer
   *  status bar (cwd path, git badge). */
  textDim: string;
  /** Faintest text: counters, scroll info, descriptions, markdown link URLs,
   *  code-block borders. */
  textMuted: string;

  // ── Surface ──
  /** Borders: pane & editor borders, markdown horizontal rule. */
  border: string;
  /** Focus / attention border — currently only the approval panel. */
  borderFocus: string;

  // ── State ──
  /** Success: ✓ marks, "enabled", completed states. */
  success: string;
  /** Warning: auto/yolo badges, stale markers, plan-mode hint. */
  warning: string;
  /** Error: error messages, failed tool output. */
  error: string;

  // ── Effort heat ──
  /** Low thinking effort; colors the editor effort dot. */
  effortLow: string;
  /** Medium thinking effort; colors the editor effort dot. */
  effortMedium: string;
  /** High thinking effort; colors the editor effort dot. */
  effortHigh: string;
  /** Extra-high thinking effort; colors the editor effort dot. */
  effortXHigh: string;
  /** Maximum thinking effort; colors the editor effort dot. */
  effortMax: string;

  // ── Diff (all consumed by components/media/diff-preview.ts) ──
  /** Added lines. */
  diffAdded: string;
  /** Removed lines. */
  diffRemoved: string;
  /** Added lines — intra-line changed words (bold). */
  diffAddedStrong: string;
  /** Removed lines — intra-line changed words (bold). */
  diffRemovedStrong: string;
  /** Line-number gutter (also approval panel/preview). */
  diffGutter: string;
  /** Meta / hunk headers. */
  diffMeta: string;
  /** De-emphasised added context lines in future expanded diff hunks. */
  diffAddedDimmed: string;
  /** De-emphasised removed context lines in future expanded diff hunks. */
  diffRemovedDimmed: string;

  // ── Roles ──
  /** User-accent hue for skill-activation names and future user-specific accents.
   *  Assistant/thinking/status bullets reuse text/textDim. */
  roleUser: string;

  // ── Workflow ──
  /** Coral title used by the Dynamic Workflow mission-control frame. */
  workflowTitle: string;

  // ── Agent identity ──
  /** Red identity used by the first future agent in Dynamic Workflow progress and grouped output. */
  agentRed: string;
  /** Orange identity used by the second future agent in Dynamic Workflow progress and grouped output. */
  agentOrange: string;
  /** Yellow identity used by the third future agent in Dynamic Workflow progress and grouped output. */
  agentYellow: string;
  /** Green identity used by the fourth future agent in Dynamic Workflow progress and grouped output. */
  agentGreen: string;
  /** Cyan identity used by the fifth future agent in Dynamic Workflow progress and grouped output. */
  agentCyan: string;
  /** Blue identity used by the sixth future agent in Dynamic Workflow progress and grouped output. */
  agentBlue: string;
  /** Purple identity used by the seventh future agent in Dynamic Workflow progress and grouped output. */
  agentPurple: string;
  /** Pink identity used by the eighth future agent in Dynamic Workflow progress and grouped output. */
  agentPink: string;

  // ── Rainbow ──
  /** Red spectrum stop for future keyword and gradient highlighting. */
  rainbowRed: string;
  /** Orange spectrum stop for future keyword and gradient highlighting. */
  rainbowOrange: string;
  /** Yellow spectrum stop for future keyword and gradient highlighting. */
  rainbowYellow: string;
  /** Green spectrum stop for future keyword and gradient highlighting. */
  rainbowGreen: string;
  /** Blue spectrum stop for future keyword and gradient highlighting. */
  rainbowBlue: string;
  /** Indigo spectrum stop for future keyword and gradient highlighting. */
  rainbowIndigo: string;
  /** Violet spectrum stop for future keyword and gradient highlighting. */
  rainbowViolet: string;

  // ── Mode identity ──
  /** Auto-accept badge colour for the future mode-specific status treatment. */
  modeAutoAccept: string;
  /** Plan badge colour for the future mode-specific status treatment. */
  modePlan: string;
  /** Permission badge colour for the future mode-specific status treatment. */
  modePermission: string;
  /** Fast badge colour for the future mode-specific status treatment. */
  modeFast: string;

  // ── Background surfaces ──
  // Active `/model` provider and `AskUserQuestion` tabs use `selectionBg` for the
  // background and `inverseText` for the foreground. Keep this pair at 4.5:1
  // contrast or higher.
  // The runtime validates six-digit hex syntax for each color, but it does not
  // enforce or repair color contrast.
  /** Assumed terminal background against which future themed surfaces are tuned. */
  background: string;
  /** Foreground for active `/model` provider and `AskUserQuestion` tabs; pair with
   *  `selectionBg` at 4.5:1 contrast or higher. */
  inverseText: string;
  /** Background for active `/model` provider and `AskUserQuestion` tabs; pair with
   *  `inverseText` at 4.5:1 contrast or higher. */
  selectionBg: string;
  /** Subtle fill for highlighted rows and message surfaces, including user transcript rows. */
  surfaceHighlight: string;

  // ── Progress ──
  /** Filled segment of the Dynamic Workflow aggregate progress line. */
  progressFill: string;
  /** Static head of the Dynamic Workflow aggregate progress track. */
  progressHead: string;
  /** Empty segment of the Dynamic Workflow aggregate progress line. */
  progressEmpty: string;
}

export const darkColors: ColorPalette = {
  /* Slightly darker periwinkle used for selection, menus, and focus on dark terminals. */
  primary: '#BBC6FF',
  accent: '#7B8CE8',

  primaryShimmer: '#F4F5FF',
  accentShimmer: '#AAB7FF',
  warningShimmer: '#FFD474',
  borderShimmer: '#848CA8',
  textDimShimmer: '#B6B9C7',

  text: '#E0E0E0',
  textStrong: '#F5F5F5',
  textDim: '#888888',
  textMuted: '#6B6B6B',

  border: '#5A5A5A',
  borderFocus: '#E8A838',

  success: '#4EC87E',
  warning: '#E8A838',
  error: '#E85454',

  effortLow: '#E8A838',
  effortMedium: '#F08C46',
  effortHigh: '#EF6666',
  effortXHigh: '#FF7A7A',
  effortMax: '#FFF0E8',

  diffAdded: '#4EC87E',
  diffRemoved: '#E85454',
  diffAddedStrong: '#7AD99B',
  diffRemovedStrong: '#F08585',
  diffGutter: '#6B6B6B',
  diffMeta: '#888888',
  diffAddedDimmed: '#57966F',
  diffRemovedDimmed: '#B55E68',

  roleUser: '#FFCB6B',

  workflowTitle: '#EE9983',

  agentRed: '#E2697D',
  agentOrange: '#E2B069',
  agentYellow: '#BAE269',
  agentGreen: '#69E273',
  agentCyan: '#69E2CE',
  agentBlue: '#699CE2',
  agentPurple: '#9269E2',
  agentPink: '#E269D8',

  rainbowRed: '#E96E63',
  rainbowOrange: '#E9B163',
  rainbowYellow: '#DEE963',
  rainbowGreen: '#63E96E',
  rainbowBlue: '#639BE9',
  rainbowIndigo: '#6E63E9',
  rainbowViolet: '#C763E9',

  modeAutoAccept: '#66D49A',
  modePlan: '#A9B8FF',
  modePermission: '#D99AF0',
  modeFast: '#FFB45E',

  background: '#000000',
  inverseText: '#FFFFFF',
  selectionBg: '#344274',
  surfaceHighlight: '#1C2238',

  progressFill: '#25764A',
  progressHead: '#4EC87E',
  progressEmpty: '#D9DEE8',
};

export const lightColors: ColorPalette = {
  /* Darker periwinkle for ≥3:1 contrast on light terminal backgrounds. */
  primary: '#4A5BC4',
  accent: '#5566CC',

  primaryShimmer: '#263BA8',
  accentShimmer: '#3F4DB5',
  warningShimmer: '#6F4700',
  borderShimmer: '#4F567A',
  textDimShimmer: '#222A4A',

  text: '#1A1A1A',
  textStrong: '#1A1A1A',
  textDim: '#454545',
  textMuted: '#5F5F5F',

  border: '#737373',
  borderFocus: '#92660A',

  success: '#0E7A38',
  warning: '#92660A',
  error: '#B91C1C',

  effortLow: '#8A5A00',
  effortMedium: '#9A4A00',
  effortHigh: '#B42318',
  effortXHigh: '#991B1B',
  effortMax: '#7F1D1D',

  diffAdded: '#0E7A38',
  diffRemoved: '#B91C1C',
  diffAddedStrong: '#0E7A38',
  diffRemovedStrong: '#B91C1C',
  diffGutter: '#737373',
  diffMeta: '#5F5F5F',
  diffAddedDimmed: '#316A48',
  diffRemovedDimmed: '#8D4852',

  roleUser: '#9A4A00',

  workflowTitle: '#9C261C',

  agentRed: '#9D2539',
  agentOrange: '#9D6B25',
  agentYellow: '#759D25',
  agentGreen: '#259D2F',
  agentCyan: '#259D89',
  agentBlue: '#25579D',
  agentPurple: '#4D259D',
  agentPink: '#9D2593',

  rainbowRed: '#9C261C',
  rainbowOrange: '#9C671C',
  rainbowYellow: '#919C1C',
  rainbowGreen: '#1C9C26',
  rainbowBlue: '#1C519C',
  rainbowIndigo: '#261C9C',
  rainbowViolet: '#7C1C9C',

  modeAutoAccept: '#26704C',
  modePlan: '#4A5BC4',
  modePermission: '#7A3C96',
  modeFast: '#9A570F',

  background: '#FFFFFF',
  inverseText: '#0B1020',
  selectionBg: '#C9D1FA',
  surfaceHighlight: '#E8EBFC',

  progressFill: '#3B9A65',
  progressHead: '#0E7A38',
  progressEmpty: '#6B7280',
};

/** Built-in palette choice, resolved from terminal background detection. */
export type ResolvedTheme = 'dark' | 'light';

/** Synchronous palette lookup for built-in themes only. */
export function getBuiltInPalette(resolved: ResolvedTheme): ColorPalette {
  return resolved === 'dark' ? darkColors : lightColors;
}
