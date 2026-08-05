/*
 * Writes transcript commits into terminal scrollback, above the live footer.
 *
 * With the renderer in `capture-stdout` mode, plain writes to the sink are
 * captured and placed above the footer as immutable history. The writer holds
 * no view state on purpose: once a commit's text has been written it can never
 * be revised, which is the property the whole split-footer design depends on.
 */

import type { TranscriptCommit } from '../transcript-presenter';

/** Receives fully-rendered scrollback text. Normally `process.stdout.write`. */
export type ScrollbackSink = (text: string) => void;

export interface StaticWriterOptions<Body> {
  readonly sink: ScrollbackSink;
  /** Renders a commit body to its final text. Called once per written commit. */
  readonly render: (body: Body) => string;
}

export class StaticWriter<Body> {
  private readonly sink: ScrollbackSink;
  private readonly render: (body: Body) => string;
  private readonly written = new Set<string>();

  constructor(options: StaticWriterOptions<Body>) {
    this.sink = options.sink;
    this.render = options.render;
  }

  /**
   * Writes a commit to scrollback, ignoring one whose key was already written.
   *
   * The presenter is already single-emission per key; this guard makes the
   * writer safe on its own, so a replayed or re-delivered commit cannot
   * duplicate history.
   *
   * @returns True when the commit was written, false when it was a duplicate.
   */
  write(commit: TranscriptCommit<Body>): boolean {
    if (this.written.has(commit.key)) {
      return false;
    }

    this.written.add(commit.key);
    this.sink(`${this.render(commit.body)}\n`);
    return true;
  }

  /** Writes every commit in order, skipping duplicates. */
  writeAll(commits: readonly TranscriptCommit<Body>[]): number {
    let count = 0;
    for (const commit of commits) {
      if (this.write(commit)) {
        count += 1;
      }
    }

    return count;
  }

  /** Forgets written keys, for a session reset that clears the screen. */
  reset(): void {
    this.written.clear();
  }
}
