export interface CompactionResult {
  summary: string;
  startIndex?: number;
  compactedCount: number;
  tokensBefore: number;
  tokensAfter: number;
}

export type CompactionSource = 'manual' | 'auto';
export type PartialCompactionDirection = 'from' | 'up_to';

export interface PartialCompactionSelection {
  readonly promptFromEnd: number;
  readonly direction: PartialCompactionDirection;
}

export interface CompactionBeginData {
  instruction?: string;
  selection?: PartialCompactionSelection;
  source: CompactionSource;
}
