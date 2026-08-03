export type MigrationPhase = 'ask1' | 'ask2' | 'progress' | 'result';

export interface MigrationStepStatus {
  readonly config: 'pending' | 'done';
  readonly mcp: 'pending' | 'done';
  readonly 'user-history': 'pending' | 'done';
  readonly sessions: 'pending' | 'done';
}

export interface MigrationPhaseViewModel {
  readonly phase: MigrationPhase;
  readonly selectedIndex: number;
  readonly progressDone: number;
  readonly progressTotal: number;
  readonly stepStatus: MigrationStepStatus;
  readonly migrationFailed: boolean;
  readonly migrationFailureReason: string | undefined;
}

type MigrationStepKey = keyof MigrationStepStatus;
type MigrationStepState = Record<MigrationStepKey, 'pending' | 'done'>;

export class MigrationPhaseModel {
  private phase: MigrationPhase;
  private selectedIndex = 0;
  private progressDone = 0;
  private progressTotal = 0;
  private readonly stepStatus: MigrationStepState = {
    config: 'pending',
    mcp: 'pending',
    'user-history': 'pending',
    sessions: 'pending',
  };
  private migrationFailed = false;
  private migrationFailureReason: string | undefined;

  constructor(initialPhase?: MigrationPhase) {
    this.phase = initialPhase ?? 'ask1';
  }

  moveUp(): void {
    if (this.phase === 'ask1' || this.phase === 'ask2') {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    }
  }

  moveDown(optionCount: number): void {
    if (this.phase === 'ask1' || this.phase === 'ask2') {
      this.selectedIndex = Math.min(optionCount - 1, this.selectedIndex + 1);
    }
  }

  advanceToAsk2(): void {
    this.phase = 'ask2';
    this.selectedIndex = 0;
  }

  enterProgress(): void {
    this.phase = 'progress';
  }

  reportStep(msg: string): void {
    const key = msg.replace(/ done$/, '');
    switch (key) {
      case 'config':
      case 'mcp':
      case 'user-history':
      case 'sessions':
        this.stepStatus[key] = 'done';
        break;
    }
  }

  reportSessionProgress(done: number, total: number): void {
    this.progressDone = done;
    this.progressTotal = total;
  }

  showResult(): void {
    this.phase = 'result';
  }

  showFailure(reason: string | undefined): void {
    this.migrationFailed = true;
    this.migrationFailureReason = reason;
    this.phase = 'result';
  }

  toViewModel(): MigrationPhaseViewModel {
    return {
      phase: this.phase,
      selectedIndex: this.selectedIndex,
      progressDone: this.progressDone,
      progressTotal: this.progressTotal,
      stepStatus: {
        config: this.stepStatus.config,
        mcp: this.stepStatus.mcp,
        'user-history': this.stepStatus['user-history'],
        sessions: this.stepStatus.sessions,
      },
      migrationFailed: this.migrationFailed,
      migrationFailureReason: this.migrationFailureReason,
    };
  }
}

export function formatMigrationFailureReason(error: unknown): string | undefined {
  let reason: string | undefined;
  if (error instanceof Error) {
    reason = error.message !== '' ? error.message : error.name;
  } else if (typeof error === 'string') {
    reason = error;
  } else if (typeof error === 'object' && error !== null) {
    const maybeMessage = (error as { readonly message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage !== '') {
      reason = maybeMessage;
    }
  }
  if (reason === undefined) {
    switch (typeof error) {
      case 'number':
      case 'boolean':
      case 'bigint':
        reason = `${error}`;
        break;
      case 'symbol':
        reason =
          error.description !== undefined ? `Symbol(${error.description})` : 'Symbol rejection';
        break;
      case 'function':
        reason = error.name !== '' ? `Function ${error.name}` : 'Function rejection';
        break;
      case 'object':
        if (error !== null) reason = 'Object rejection';
        break;
      case 'undefined':
        break;
      case 'string':
        break;
    }
  }
  const trimmed = reason?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
