/**
 * Host-side activity counters for the status bar and view badge. Streams are
 * counted around the StreamChat handler; approvals and questions are counted
 * in the reverse-RPC controller. No `vscode` import on purpose: the runtime
 * files that call in here run under plain-node vitest.
 */

export interface ActivityStatus {
  readonly activeStreams: number;
  readonly pendingApprovals: number;
}

type ActivityListener = (status: ActivityStatus) => void;

let activeStreams = 0;
let pendingApprovals = 0;
const listeners = new Set<ActivityListener>();

export function getActivity(): ActivityStatus {
  return { activeStreams, pendingApprovals };
}

export function onActivityChange(listener: ActivityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function trackStream(delta: number): void {
  activeStreams = Math.max(0, activeStreams + delta);
  fire();
}

export function trackApprovals(delta: number): void {
  if (delta === 0) return;
  pendingApprovals = Math.max(0, pendingApprovals + delta);
  fire();
}

function fire(): void {
  const status = getActivity();
  for (const listener of listeners) listener(status);
}
