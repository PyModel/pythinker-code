import { createDecorator } from '#/_base/di/instantiation';

/**
 * Continues a turn toward a configured output-token target by injecting
 * continuation nudges while progress holds, stopping on diminishing returns.
 */
export interface IAgentTurnBudgetService {
  readonly _serviceBrand: undefined;
}

export const IAgentTurnBudgetService =
  createDecorator<IAgentTurnBudgetService>('agentTurnBudgetService');

/** Fraction of the configured token target a turn must reach before stopping naturally. */
export const TURN_BUDGET_COMPLETION_THRESHOLD = 0.9;
/** Per-step output-token delta below which a step counts as low-progress. */
export const TURN_BUDGET_DIMINISHING_MIN_DELTA_TOKENS = 500;
/** Continuations after which consecutive low-progress deltas stop the turn. */
export const TURN_BUDGET_MAX_DIMINISHING_CONTINUATIONS = 3;

/** Builds the meta nudge injected before each budget continuation. */
export function turnBudgetNudgeText(pct: number, used: number, budget: number): string {
  return `Stopped at ${pct}% of token target (${used} / ${budget}). Keep working - do not summarize.`;
}
