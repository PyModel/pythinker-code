const VERIFICATION_PATTERN = /verif/iu;

export const VERIFICATION_NUDGE =
  '\n\nNOTE: You just closed three or more tasks without a verification step. Before the final response, use the Agent tool with subagent_type="verification" and pass the original request, changed files, approach, and plan path. Only that verifier should issue the final VERDICT.';

export function needsVerificationNudge(taskTitles: readonly string[]): boolean {
  return taskTitles.length >= 3 && !taskTitles.some((title) => VERIFICATION_PATTERN.test(title));
}
