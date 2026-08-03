/**
 * A buffer the vim layer operates on. Line/column, not absolute offset,
 * matching both vim's mental model and CustomEditor's line-oriented API.
 */
export interface VimBuffer {
  readonly lines: readonly string[];
  readonly line: number;
  readonly column: number;
}

export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL';

export type VisualKind = 'char' | 'line';

export interface Position {
  readonly line: number;
  readonly column: number;
}

/** The supported line-local find command variants. */
export type FindType = 'f' | 'F' | 't' | 'T';

export type Operator = 'delete' | 'change' | 'yank';

export type TextObjScope = 'inner' | 'around';

/** NORMAL-mode command parser state. Each variant names exactly what input it awaits. */
export type CommandState =
  | { readonly type: 'idle' }
  | { readonly type: 'count'; readonly digits: string }
  | { readonly type: 'find'; readonly find: FindType; readonly count: number }
  | { readonly type: 'g'; readonly count: number }
  | { readonly type: 'operator'; readonly op: Operator; readonly count: number }
  | {
      readonly type: 'operatorCount';
      readonly op: Operator;
      readonly count: number;
      readonly digits: string;
    }
  | {
      readonly type: 'operatorFind';
      readonly op: Operator;
      readonly count: number;
      readonly find: FindType;
    }
  | {
      readonly type: 'operatorTextObj';
      readonly op: Operator;
      readonly count: number;
      readonly scope: TextObjScope;
    }
  | { readonly type: 'visualTextObj'; readonly scope: TextObjScope }
  | { readonly type: 'operatorG'; readonly op: Operator; readonly count: number };

/** What INSERT mode needs to remember so a change can be dot-repeated. */
export interface InsertEntry {
  /** The command that opened INSERT, replayed by `.`; null for an untracked entry. */
  readonly pendingRepeat: RepeatSpec | null;
  /**
   * Buffer contents when INSERT was entered. The editor owns insertion, so
   * Escape recovers typed text by comparing the current buffer with this copy.
   */
  readonly snapshotLines: readonly string[];
  readonly snapshotCursor: Position;
}

/** A replayable command. Structured, never raw keystrokes. */
export type RepeatSpec =
  | {
      readonly kind: 'operator';
      readonly op: Operator;
      readonly count: number;
      readonly target: RepeatTarget;
      readonly insertedText: string | null;
    }
  | { readonly kind: 'simple'; readonly key: string; readonly count: number }
  | {
      readonly kind: 'visual';
      readonly op: Operator;
      readonly visual: VisualKind;
      readonly lineSpan: number;
      readonly columnSpan: number;
      readonly insertedText: string | null;
    }
  | {
      readonly kind: 'insert';
      /** One of i I a A o O, which determines the replay insertion point. */
      readonly key: string;
      readonly count: number;
      readonly insertedText: string | null;
    };

export type RepeatTarget =
  | { readonly kind: 'motion'; readonly key: string; readonly char?: string }
  | {
      readonly kind: 'textObject';
      readonly scope: TextObjScope;
      readonly object: string;
    }
  | { readonly kind: 'line' };

/** Complete state for the pure vim state machine. */
export type VimState =
  | { readonly mode: 'INSERT'; readonly entry: InsertEntry }
  | { readonly mode: 'NORMAL'; readonly command: CommandState }
  | {
      readonly mode: 'VISUAL';
      readonly kind: VisualKind;
      readonly anchor: Position;
      readonly command: CommandState;
    };

/** State that survives across commands. */
export interface PersistentState {
  readonly lastFind: { readonly type: FindType; readonly char: string } | null;
  /**
   * Column vertical motions aim for. `null` uses the cursor's current column;
   * positive infinity preserves end-of-line movement across lines.
   */
  readonly desiredColumn: number | null;
  /**
   * The unnamed register. Linewise content keeps its trailing newline
   * semantics through `registerIsLinewise` rather than embedding a newline.
   */
  readonly register: string;
  readonly registerIsLinewise: boolean;
  readonly lastChange: RepeatSpec | null;
}
