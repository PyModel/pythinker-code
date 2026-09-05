export interface TokenUsage {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}

export function usageDelta(
  after: TokenUsage | undefined,
  before: TokenUsage | undefined,
): TokenUsage | undefined {
  if (after === undefined) return undefined;
  return {
    inputOther: Math.max(0, after.inputOther - (before?.inputOther ?? 0)),
    output: Math.max(0, after.output - (before?.output ?? 0)),
    inputCacheRead: Math.max(0, after.inputCacheRead - (before?.inputCacheRead ?? 0)),
    inputCacheCreation: Math.max(
      0,
      after.inputCacheCreation - (before?.inputCacheCreation ?? 0),
    ),
  };
}

export function inputTotal(usage: TokenUsage): number {
  return usage.inputOther + usage.inputCacheRead + usage.inputCacheCreation;
}

export function grandTotal(usage: TokenUsage): number {
  return inputTotal(usage) + usage.output;
}

export function emptyUsage(): TokenUsage {
  return {
    inputOther: 0,
    output: 0,
    inputCacheRead: 0,
    inputCacheCreation: 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputOther: a.inputOther + b.inputOther,
    output: a.output + b.output,
    inputCacheRead: a.inputCacheRead + b.inputCacheRead,
    inputCacheCreation: a.inputCacheCreation + b.inputCacheCreation,
  };
}
