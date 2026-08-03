import type { UsageStatus } from '#/rpc';
import {
  addUsage,
  calculateCost,
  type ModelCostRates,
  type TokenUsage,
} from '@pythoughts/kosong';

import type { Agent } from '..';

export type UsageRecordScope = 'session' | 'turn';

function copyUsage(usage: TokenUsage): TokenUsage {
  return { ...usage };
}

export class UsageRecorder {
  private readonly byModel: Record<string, TokenUsage> = {};
  private currentTurn: TokenUsage | undefined;
  private totalCostUsd: number | undefined;
  private totalCostUnknown = false;

  constructor(protected readonly agent?: Agent) {}

  beginTurn(): void {
    this.currentTurn = undefined;
  }

  endTurn(): void {
    this.currentTurn = undefined;
  }

  record(
    model: string,
    usage: TokenUsage,
    scope: UsageRecordScope = 'session',
    rates: ModelCostRates | undefined = this.resolveCostRates(model),
  ): void {
    this.agent?.records.logRecord({
      type: 'usage.record',
      model,
      usage,
      usageScope: scope,
    });
    const current = this.byModel[model];
    this.byModel[model] = current === undefined ? copyUsage(usage) : addUsage(current, usage);

    if (scope === 'turn') {
      this.currentTurn =
        this.currentTurn === undefined ? copyUsage(usage) : addUsage(this.currentTurn, usage);
    }
    const costUsd = calculateCost(usage, rates);
    if (costUsd !== undefined) {
      this.totalCostUsd = (this.totalCostUsd ?? 0) + costUsd;
    } else if (hasTokenUsage(usage)) {
      this.totalCostUnknown = true;
    }
    this.agent?.emitStatusUpdated();
  }

  data(): UsageStatus {
    const byModel = this.byModelSnapshot();
    const hasByModel = Object.keys(byModel).length > 0;
    const currentTurn = this.currentTurn;
    return {
      byModel: hasByModel ? byModel : undefined,
      total: hasByModel ? totalUsage(byModel) : undefined,
      currentTurn: currentTurn === undefined ? undefined : copyUsage(currentTurn),
      totalCostUsd: this.totalCostUnknown ? undefined : this.totalCostUsd,
    };
  }

  status(): UsageStatus | undefined {
    const status = this.data();
    if (
      status.byModel === undefined &&
      status.total === undefined &&
      status.currentTurn === undefined
    ) {
      return undefined;
    }
    return status;
  }

  private byModelSnapshot(): Record<string, TokenUsage> {
    return Object.fromEntries(
      Object.entries(this.byModel).map(([model, usage]) => [model, copyUsage(usage)]),
    );
  }

  private resolveCostRates(model: string): ModelCostRates | undefined {
    try {
      return this.agent?.modelProvider?.resolveProviderConfig(model).modelCapabilities.cost;
    } catch {
      return undefined;
    }
  }
}

function hasTokenUsage(usage: TokenUsage): boolean {
  return Object.values(usage).some((tokens) => tokens > 0);
}

function totalUsage(byModel: Record<string, TokenUsage>): TokenUsage | undefined {
  let total: TokenUsage | undefined;
  for (const usage of Object.values(byModel)) {
    total = total === undefined ? copyUsage(usage) : addUsage(total, usage);
  }
  return total;
}
