import { randomBytes } from 'node:crypto';

/** Matches a generated run id. Also the guard for a run id that arrives as tool input. */
const WORKFLOW_RUN_ID_PATTERN = /^wfr-[0-9a-z]{1,32}-[0-9a-z]{1,16}$/u;

export function isWorkflowRunId(value: string): boolean {
  return WORKFLOW_RUN_ID_PATTERN.test(value);
}

/** Timestamp plus crypto randomness, both lowercase — no character that means
 * anything to a filesystem or a shell. */
export function generateWorkflowRunId(): string {
  return `wfr-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
}
