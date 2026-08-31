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
  /** Coral secondary highlight: approval "▶" prefix,
   *  device-code box, image placeholder, BTW / queue panes, custom-registry import. */
  accent: string;

  // ── Shimmer ──
  /** Brighter primary pulse for running-state animations. */
  primaryShimmer: string;
  /** Brighter accent pulse for attention animations. */
  accentShimmer: string;
  /** Brighter warning pulse for attention animations. */
  warningShimmer: string;
  /** Brighter border pulse for focused-panel animations. */
  borderShimmer: string;
  /** Brighter dim-text pulse for thinking and status animations. */
  textDimShimmer: string;

  // ── Text ──
  /** Default body text: dialog bodies, todo titles, tool/read output, and
   *  tool / agent / read message bullets. */
  text: string;
  /** Emphasised text: input dialogs, status messages, Markdown headings,
   *  transcript summary headings, user transcript text. */
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
  /** Background tint for a running tool card. */
  toolPendingBg: string;
  /** Legacy custom-theme token retained while successful tool cards stay unfilled. */
  toolSuccessBg: string;
  /** Background tint for a failed tool card. */
  toolErrorBg: string;

  // ── Effort heat ──
  /** Thinking effort off; grey prompt-area border. */
  effortOff: string;
  /** Low thinking effort; lighter grey prompt-area border. */
  effortLow: string;
  /** Medium thinking effort; near-white prompt-area border. */
  effortMedium: string;
  /** High thinking effort; light-blue prompt-area border. */
  effortHigh: string;
  /** Extra-high thinking effort; light-purple prompt-area border. */
  effortXHigh: string;
  /** Maximum thinking effort; gold prompt-area border. */
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
  /** De-emphasised added context lines in expanded diff hunks. */
  diffAddedDimmed: string;
  /** De-emphasised removed context lines in expanded diff hunks. */
  diffRemovedDimmed: string;

  // ── Roles ──
  /** User message bullet and skill-activation name. The one role colour with
   *  its own hue — assistant/thinking/status bullets use other semantic tokens. */
  roleUser: string;

  // ── Shell mode ──
  /** Shell mode (`!`): the `!` prompt symbol, bash-mode editor border, and the
   *  echoed `$ command` line. Defaults to primary cyan but stays separate so
   *  custom themes can distinguish it. */
  shellMode: string;

  // ── Workflow ──
  /** Coral title used by the Dynamic Workflow mission-control frame. */
  workflowTitle: string;

  // ── Agent identity ──
  /** Red identity used by the first agent in grouped workflow output. */
  agentRed: string;
  /** Orange identity used by the second agent in grouped workflow output. */
  agentOrange: string;
  /** Yellow identity used by the third agent in grouped workflow output. */
  agentYellow: string;
  /** Green identity used by the fourth agent in grouped workflow output. */
  agentGreen: string;
  /** Cyan identity used by the fifth agent in grouped workflow output. */
  agentCyan: string;
  /** Blue identity used by the sixth agent in grouped workflow output. */
  agentBlue: string;
  /** Purple identity used by the seventh agent in grouped workflow output. */
  agentPurple: string;
  /** Pink identity used by the eighth agent in grouped workflow output. */
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
  /** Auto-accept badge colour for mode-specific status treatment. */
  modeAutoAccept: string;
  /** Plan badge colour for mode-specific status treatment. */
  modePlan: string;
  /** Permission badge colour for mode-specific status treatment. */
  modePermission: string;
  /** Fast badge colour for mode-specific status treatment. */
  modeFast: string;

  // ── Background surfaces ──
  /** Assumed terminal background against which themed surfaces are tuned. */
  background: string;
  /** Foreground for active tabs; pair with `selectionBg` at 4.5:1 contrast or higher. */
  inverseText: string;
  /** Background for active tabs; pair with `inverseText` at 4.5:1 contrast or higher. */
  selectionBg: string;
  /** Subtle fill for highlighted rows and message surfaces. */
  surfaceHighlight: string;

  // ── Progress ──
  /** Active Dynamic Workflow progress bars and status labels. */
  progressFill: string;
  /** Leading highlight for active Dynamic Workflow progress. */
  progressHead: string;
  /** Empty segment of the Dynamic Workflow aggregate progress line. */
  progressEmpty: string;
}

export const darkColors: ColorPalette = {
  /* Clean cyan used for actions, links, menus, and focus on dark terminals. */
  primary: '#5FC3E8',
  accent: '#EE9983',

  primaryShimmer: '#A5E3F7',
  accentShimmer: '#FFC4B8',
  warningShimmer: '#FFD474',
  borderShimmer: '#848CA8',
  textDimShimmer: '#B6B9C7',

  text: '#E0E0E0',
  textStrong: '#F5F5F5',
  textDim: '#A3A3A3',
  textMuted: '#858585',

  border: '#5A5A5A',
  borderFocus: '#E8A838',

  success: '#4EC87E',
  warning: '#E8A838',
  error: '#E85454',
  toolPendingBg: '#1D2129',
  toolSuccessBg: '#14171B',
  toolErrorBg: '#291D1D',

  effortOff: '#8A8A8A',
  effortLow: '#B3B3B3',
  effortMedium: '#E8E8E8',
  effortHigh: '#6FA8DC',
  effortXHigh: '#A78BFA',
  effortMax: '#F2C744',

  diffAdded: '#4EC87E',
  diffRemoved: '#E85454',
  diffAddedStrong: '#7AD99B',
  diffRemovedStrong: '#F08585',
  diffGutter: '#6B6B6B',
  diffMeta: '#888888',
  diffAddedDimmed: '#57966F',
  diffRemovedDimmed: '#B55E68',

  roleUser: '#FFCB6B',
  shellMode: '#5FC3E8',

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
  modePlan: '#5FC3E8',
  modePermission: '#D99AF0',
  modeFast: '#FFB45E',

  background: '#000000',
  inverseText: '#FFFFFF',
  selectionBg: '#344274',
  surfaceHighlight: '#1C2238',

  progressFill: '#5FC3E8',
  progressHead: '#A5E3F7',
  progressEmpty: '#D9DEE8',
};

export const lightColors: ColorPalette = {
  /* Dark cyan for WCAG AA contrast on light terminal backgrounds. */
  primary: '#006A88',
  accent: '#9C261C',

  primaryShimmer: '#004B63',
  accentShimmer: '#7C1C12',
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
  toolPendingBg: '#E8EEF7',
  toolSuccessBg: '#F1F3F5',
  toolErrorBg: '#F9E9E9',

  effortOff: '#767676',
  effortLow: '#8C8C8C',
  effortMedium: '#404040',
  effortHigh: '#2E6FB8',
  effortXHigh: '#7048B6',
  effortMax: '#B8860B',

  diffAdded: '#0E7A38',
  diffRemoved: '#B91C1C',
  diffAddedStrong: '#0E7A38',
  diffRemovedStrong: '#B91C1C',
  diffGutter: '#737373',
  diffMeta: '#5F5F5F',
  diffAddedDimmed: '#316A48',
  diffRemovedDimmed: '#8D4852',

  roleUser: '#9A4A00',
  shellMode: '#006A88',

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
  modePlan: '#006A88',
  modePermission: '#7A3C96',
  modeFast: '#9A570F',

  background: '#FFFFFF',
  inverseText: '#0B1020',
  selectionBg: '#C9D1FA',
  surfaceHighlight: '#E8EBFC',

  progressFill: '#006A88',
  progressHead: '#004B63',
  progressEmpty: '#6B7280',
};

export type ResolvedTheme = 'dark' | 'light';

/** Synchronous palette lookup for built-in themes only. */
export function getBuiltInPalette(resolved: ResolvedTheme): ColorPalette {
  return resolved === 'dark' ? darkColors : lightColors;
}
