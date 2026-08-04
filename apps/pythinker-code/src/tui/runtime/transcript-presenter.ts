/**
 * Converts transcript entry lifecycle events into deterministic scrollback commits.
 */

/** The lifecycle phase represented by a transcript commit. */
export type ScrollbackPhase = 'start' | 'progress' | 'final';

/** A single ordered transcript record ready to be committed to scrollback. */
export interface TranscriptCommit<Body> {
  readonly key: string;
  readonly entryId: string;
  readonly turnId?: string;
  readonly phase: ScrollbackPhase;
  readonly body: Body;
}

interface LiveEntry {
  readonly status: 'live';
  readonly turnId?: string;
  acceptedText: string;
  progressCount: number;
}

interface FinalizedEntry {
  readonly status: 'finalized';
}

type EntryState = LiveEntry | FinalizedEntry;

/**
 * Tracks transcript entry lifecycles and emits at most one deterministic commit per call.
 */
export class TranscriptPresenter<Body> {
  private readonly entries = new Map<string, EntryState>();

  /**
   * Finalizes a previously unseen entry in a single commit.
   */
  append(
    entryId: string,
    body: Body,
    turnId?: string,
  ): readonly TranscriptCommit<Body>[] {
    if (this.entries.has(entryId)) {
      return [];
    }

    this.entries.set(entryId, { status: 'finalized' });
    return [
      this.createCommit(entryId, `${entryId}:final`, 'final', body, turnId),
    ];
  }

  /**
   * Starts a previously unseen live entry.
   */
  begin(
    entryId: string,
    body: Body,
    turnId?: string,
  ): readonly TranscriptCommit<Body>[] {
    if (this.entries.has(entryId)) {
      return [];
    }

    const entry: LiveEntry = turnId === undefined
      ? {
          status: 'live',
          acceptedText: '',
          progressCount: 0,
        }
      : {
          status: 'live',
          turnId,
          acceptedText: '',
          progressCount: 0,
        };
    this.entries.set(entryId, entry);
    return [
      this.createCommit(entryId, `${entryId}:start`, 'start', body, turnId),
    ];
  }

  /**
   * Accepts a strict prefix-extension and emits only its newly appended suffix.
   */
  update(
    entryId: string,
    fullText: string,
    makeBody: (delta: string) => Body,
  ): readonly TranscriptCommit<Body>[] {
    const entry = this.entries.get(entryId);
    if (
      entry?.status !== 'live'
      || !fullText.startsWith(entry.acceptedText)
      || fullText.length <= entry.acceptedText.length
    ) {
      return [];
    }

    const delta = fullText.slice(entry.acceptedText.length);
    const progressCount = entry.progressCount;
    entry.acceptedText = fullText;
    entry.progressCount += 1;

    return [
      this.createCommit(
        entryId,
        `${entryId}:progress:${progressCount}`,
        'progress',
        makeBody(delta),
        entry.turnId,
      ),
    ];
  }

  /**
   * Finalizes a live entry exactly once.
   */
  complete(entryId: string, body: Body): readonly TranscriptCommit<Body>[] {
    const entry = this.entries.get(entryId);
    if (entry?.status !== 'live') {
      return [];
    }

    this.entries.set(entryId, { status: 'finalized' });
    return [
      this.createCommit(entryId, `${entryId}:final`, 'final', body, entry.turnId),
    ];
  }

  /**
   * Drops all entry state and per-entry progress counters.
   */
  reset(): void {
    this.entries.clear();
  }

  /**
   * Reports whether no entries are currently live.
   */
  idle(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.status === 'live') {
        return false;
      }
    }

    return true;
  }

  private createCommit(
    entryId: string,
    key: string,
    phase: ScrollbackPhase,
    body: Body,
    turnId?: string,
  ): TranscriptCommit<Body> {
    if (turnId === undefined) {
      return { key, entryId, phase, body };
    }

    return { key, entryId, turnId, phase, body };
  }
}
