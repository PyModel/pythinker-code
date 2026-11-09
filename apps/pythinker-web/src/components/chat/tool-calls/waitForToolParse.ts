// Pure parser for the WaitFor tool card. Kept separate from the SFC so the
// wait-result decoding is unit-testable without a DOM.
//
// Wire shape (emitted by the agent engine's WaitFor tool):
//   tool.arg            : JSON { task_id?, timeout_ms? } — task_id is optional
//                         ("wait for any background task" when absent).
//   tool.output         : a timeline of lines. Header fields first, then
//                         optional `[finished]` / `[completed_during_wait]` /
//                         `[still_running]` sections:
//                           wait_status: completed | timed_out | no_tasks
//                           waited_ms: <number>
//                           task_id: <id>            (the task that was waited on)
//                           [finished]               (completed only)
//                           status: completed|failed|killed|timed_out|lost
//                           description: <one-line summary>
//                           ...
//                           [completed_during_wait]  (tasks that ended meanwhile)
//                           task_id: <id>
//                           description: <one-line summary>
//                           ...
//                           [still_running]          (tasks still running after
//                           active_background_tasks: <count>   the wait ended)
//                           task_id: <id>
//                           description: <one-line summary>
//   A `timed_out` wait is NOT an error — the tool says so itself — so the card
//   renders it in the warning tone.

export type WaitForStatus = 'completed' | 'timed_out' | 'no_tasks';

export interface WaitForView {
  readonly status: WaitForStatus;
  readonly waitedMs: number;
  /** The task the wait was for (from the header `task_id` field). */
  readonly taskId?: string;
  /** Outcome of the finished task — `[finished]` section `status` field. */
  readonly finishedStatus?: string;
  readonly finishedDescription?: string;
  /** Number of tasks that finished during the wait, beyond the main one. */
  readonly extraCount: number;
  /** Number of background tasks still running when the wait ended. */
  readonly runningCount: number;
  /** Up to three `description:` samples of the still-running tasks. */
  readonly runningSamples: readonly string[];
}

const RUNNING_SAMPLES = 3;

function field(text: string, name: string): string | undefined {
  const match = new RegExp(`^${name}: (.+)$`, 'm').exec(text);
  return match?.[1];
}

function countField(text: string, name: string): number {
  const value = Number(field(text, name) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function section(output: string, name: string): string | undefined {
  const match = new RegExp(`^\\[${name}\\]$`, 'm').exec(output);
  if (match === null) return undefined;
  const rest = output.slice(match.index + match[0].length);
  const next = /^\[/m.exec(rest);
  return (next === null ? rest : rest.slice(0, next.index)).trim();
}

function countOccurrences(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function sampleDescriptions(stillRunning: string, runningCount: number): readonly string[] {
  const descriptions = [...stillRunning.matchAll(/^description: (.+)$/gm)].map((match) =>
    match[1] ?? '',
  );
  return descriptions.slice(0, Math.min(RUNNING_SAMPLES, runningCount));
}

export function parseWaitForOutput(output: string[] | undefined): WaitForView | undefined {
  if (!output || output.length === 0) return undefined;
  const text = output.join('\n');
  const status = field(text, 'wait_status');
  if (status !== 'completed' && status !== 'timed_out' && status !== 'no_tasks') return undefined;
  const waitedMs = Number(field(text, 'waited_ms') ?? 0);
  const finished = section(text, 'finished');
  const duringWait = section(text, 'completed_during_wait');
  const stillRunning = section(text, 'still_running');
  const runningCount = stillRunning === undefined ? 0 : countField(stillRunning, 'active_background_tasks');
  return {
    status,
    waitedMs: Number.isFinite(waitedMs) ? waitedMs : 0,
    taskId: field(text, 'task_id'),
    finishedStatus: finished === undefined ? undefined : field(finished, 'status'),
    finishedDescription: finished === undefined ? undefined : field(finished, 'description'),
    extraCount: duringWait === undefined ? 0 : countOccurrences(duringWait, /^task_id: /gm),
    runningCount,
    runningSamples: stillRunning === undefined ? [] : sampleDescriptions(stillRunning, runningCount),
  };
}