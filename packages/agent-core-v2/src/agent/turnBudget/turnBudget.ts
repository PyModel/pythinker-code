import { createDecorator } from '#/_base/di/instantiation';

export interface IAgentTurnBudgetService {
  readonly _serviceBrand: undefined;
}

export const IAgentTurnBudgetService =
  createDecorator<IAgentTurnBudgetService>('agentTurnBudgetService');

export const TURN_BUDGET_COMPLETION_THRESHOLD = 0.9;
export const TURN_BUDGET_DIMINISHING_MIN_DELTA_TOKENS = 500;
export const TURN_BUDGET_MAX_DIMINISHING_CONTINUATIONS = 3;

export function turnBudgetNudgeText(pct: number, used: number, budget: number): string {
  return `Stopped at ${pct}% of token target (${used} / ${budget}). Keep working - do not summarize.`;
}
