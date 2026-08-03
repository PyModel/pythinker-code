const SHORTHAND_START_RE = /^\s*\+(\d+(?:\.\d+)?)\s*(k|m|b)\b/iu;
const SHORTHAND_END_RE = /\s\+(\d+(?:\.\d+)?)\s*(k|m|b)\s*[.!?]?\s*$/iu;
const VERBOSE_RE = /\b(?:use|spend)\s+(\d+(?:\.\d+)?)\s*(k|m|b)\s*tokens?\b/iu;

const MULTIPLIERS: Readonly<Record<string, number>> = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
};

export function parseTokenBudget(text: string): number | null {
  const match =
    text.match(SHORTHAND_START_RE) ?? text.match(SHORTHAND_END_RE) ?? text.match(VERBOSE_RE);
  if (match === null) return null;
  const budget = Number.parseFloat(match[1]!) * MULTIPLIERS[match[2]!.toLowerCase()]!;
  return Number.isFinite(budget) && budget > 0 ? budget : null;
}

export function tokenBudgetContinuationMessage(
  outputTokens: number,
  budget: number,
): string {
  const pct = Math.round((outputTokens / budget) * 100);
  const format = (value: number): string => new Intl.NumberFormat('en-US').format(value);
  return `Stopped at ${String(pct)}% of token target (${format(outputTokens)} / ${format(budget)}). Keep working — do not summarize.`;
}
