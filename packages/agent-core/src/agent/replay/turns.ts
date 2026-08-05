import type { AgentReplayRecord } from '../../rpc/resumed';

/**
 * A replay record starts a new turn when it is a user-role message from an
 * actual user action. Model-facing user messages continue the current turn,
 * except for goal continuations: the goal driver counts each continuation as
 * a distinct work round, so replay trimming must do the same.
 */
export function isAgentReplayUserTurnRecord(record: AgentReplayRecord): boolean {
  if (record.type !== 'message') return false;
  const { message } = record;
  if (message.role !== 'user') return false;
  switch (message.origin?.kind) {
    case undefined:
    case 'user':
      return true;
    case 'skill_activation':
      return message.origin.trigger === 'user-slash';
    case 'background_task':
    case 'compaction_summary':
    case 'cron_job':
    case 'cron_missed':
    case 'hook_result':
    case 'injection':
    case 'retry':
      return false;
    case 'system_trigger':
      return message.origin.name === 'goal_continuation';
  }
}

/**
 * Keep only the most recent `maxTurns` replay turns. Omitting the limit keeps
 * the original replay reference; zero or a negative value returns no records.
 */
export function limitAgentReplayByTurns(
  records: readonly AgentReplayRecord[],
  maxTurns?: number,
): readonly AgentReplayRecord[] {
  if (maxTurns === undefined) return records;
  if (maxTurns <= 0) return [];
  const turnStarts = records.flatMap((record, index) =>
    isAgentReplayUserTurnRecord(record) ? [index] : [],
  );
  if (turnStarts.length <= maxTurns) return records;
  return records.slice(turnStarts[turnStarts.length - maxTurns]);
}
