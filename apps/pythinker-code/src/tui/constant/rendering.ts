// Continuation indent for transcript rows that use a two-cell leading marker.
export const MESSAGE_INDENT = '  ';

// Outer left/right padding applied to the transcript, panels, and the
// statusline so the chrome's left edge lines up with the input box's
// interior (the `>` prompt). The editor itself stays at column 0 — its
// vertical borders are the visual anchor everything else aligns against.
export const CHROME_GUTTER = 1;

// Shared preview caps used by thinking, tool results, and shell snippets.
export const RESULT_PREVIEW_LINES = 3;
export const THINKING_PREVIEW_LINES = 2;
export const COMMAND_PREVIEW_LINES = 10;

// Animation frames are shared by the login/update loaders and live thinking.
export const BRAILLE_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
export const BRAILLE_SPINNER_INTERVAL_MS = 80;

// Pulse cadence for the calm running-bullet toggle on in-flight Bash tools.
export const BASH_STATUS_PULSE_INTERVAL_MS = 800;

/**
 * Layout values and observed execution stages for Dynamic Workflow.
 * The protocol emits no task-percent event, so these never predict time remaining.
 */
export const DYNAMIC_WORKFLOW_RENDERING = {
  frameMinWidth: 21,
  frameHorizontalInset: 4,
  memberProgressMinWidth: 60,
  memberProgressWidth: 8,
  /** Least width of the lifecycle STATE column in member rows. */
  stateColumnWidth: 6,
  /** Cadence for the live aggregate-label shimmer. */
  aggregateShimmerFrameMs: BRAILLE_SPINNER_INTERVAL_MS,
  /** Thin-arc frames for a running row; all rows share one clock. */
  progressFrames: ['◜', '◝', '◞', '◟'],
  /** Arc cadence in milliseconds. */
  progressFrameMs: 120,
  /** Least room the task keeps before the detail may claim any of the row. */
  memberTaskMinWidth: 12,
  /** Share of the free row the task may take before the detail gets the rest. */
  memberTaskShare: 0.6,
  /** Below this the detail is dropped: a few clipped characters say nothing. */
  memberDetailMinWidth: 8,
  /**
   * Least shared task prefix worth eliding. A short prefix costs about as much
   * to mark as it frees, so only a preamble long enough to have been clipping
   * the part that names the row is dropped.
   */
  memberTaskSharedPrefixMinWidth: 16,
  /**
   * Upper bound on one buffered output line. A model may stream a single line
   * with no newline in it at all, so this is the only thing that stops the
   * buffered text from growing for as long as the agent runs.
   */
  memberLatestMaxChars: 512,
} as const;

/** Live activity labels: one shown at a time, rotating on a fixed cadence. */
export const THINKING_SPINNER_LABELS = [
  // Clear and informative
  'thinking',
  'reasoning',
  'exploring',
  'planning',
  'connecting',
  'refining',
  'verifying',
  'untangling',
  'pattern-finding',
  'clue-chasing',

  // Pythinker signature
  'pythinking',

  // Technical and constructive
  'architecting',
  'bootstrapping',
  'calculating',
  'coalescing',
  'composing',
  'computing',
  'crafting',
  'crystallizing',
  'deciphering',
  'elucidating',
  'forging',
  'harmonizing',
  'hashing',
  'incubating',
  'inferring',
  'orchestrating',
  'processing',
  'synthesizing',
  'unravelling',

  // Polished playful
  'brewing',
  'cerebrating',
  'cogitating',
  'concocting',
  'cultivating',
  'hatching',
  'marinating',
  'noodling',
  'percolating',
  'pondering',
  'puzzling',
  'recombobulating',
  'reticulating',
  'tinkering',

  // Developer-chaotic
  'token-taming',
  'bug-whispering',
  'rubber-ducking',
  'stack-divining',
  'logic-weaving',
  'thread-pulling',
  'syntax-sleuthing',
  'gizmo-tinkering',

  // Rare whimsical moments
  'booping',
  'moonwalking',
  'quantumizing',
  'razzle-dazzling',
  'vibing',
  'whirring',
  'zigzagging',
] as const;

export const THINKING_SPINNER_LABEL_INTERVAL_MS = 12_000;

const LIVE_INTENT_MAX_LENGTH = 120;
// Keep in sync with packages/agent-core/src/loop/tool-intent.ts.
// oxlint-disable-next-line no-control-regex -- wire text must not retain terminal escape sequences.
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\|$))/gu;
const CONTROL_CHARACTER = /\p{Cc}/gu;
let liveIntent: string | undefined;

export function setLiveIntent(text: string | undefined): void {
  if (text === undefined) {
    liveIntent = undefined;
    return;
  }
  const normalized = text
    .replaceAll(ANSI_ESCAPE, '')
    .replaceAll(CONTROL_CHARACTER, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
  liveIntent =
    Array.from(normalized).slice(0, LIVE_INTENT_MAX_LENGTH).join('').trimEnd() || undefined;
}

/** Rotating thinking label for the given wall-clock moment; falls back to the first label. */
export function getThinkingSpinnerLabel(nowMs: number = Date.now()): string {
  const index =
    Math.floor(nowMs / THINKING_SPINNER_LABEL_INTERVAL_MS) %
    THINKING_SPINNER_LABELS.length;

  return THINKING_SPINNER_LABELS[index] ?? THINKING_SPINNER_LABELS[0];
}

/** Thinking label plus an ellipsis, for the thinking block header. */
export function formatThinkingSpinnerLabel(nowMs: number = Date.now()): string {
  return `${liveIntent ?? getThinkingSpinnerLabel(nowMs)}…`;
}
