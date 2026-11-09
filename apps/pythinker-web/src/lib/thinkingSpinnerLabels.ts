/** Live activity labels: one shown at a time, rotating on a fixed cadence. */
export const THINKING_SPINNER_LABELS = [
  // Pythinking family
  'pythinking',
  'pyreasoning',
  'pypondering',
  'pyplanning',
  'pyiterating',
  'pyorchestrating',
  // Polished weird
  'reasonating',
  'pondercrafting',
  'neuroning',
  'logic-weaving',
  // Developer-chaotic
  'rubber-duckoning',
  'token-wrangling',
  'bug-whispering',
  'stack-divining',
  'gizmo-tinkering',
] as const;

export const THINKING_SPINNER_LABEL_INTERVAL_MS = 60_000;

export function getThinkingSpinnerLabel(nowMs: number = Date.now()): string {
  const index =
    Math.floor(nowMs / THINKING_SPINNER_LABEL_INTERVAL_MS) % THINKING_SPINNER_LABELS.length;
  return THINKING_SPINNER_LABELS[index] ?? THINKING_SPINNER_LABELS[0];
}

export function formatThinkingSpinnerLabel(nowMs: number = Date.now()): string {
  return `${getThinkingSpinnerLabel(nowMs)}…`;
}
