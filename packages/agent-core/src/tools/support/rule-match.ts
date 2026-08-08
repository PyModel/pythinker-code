import {
  globMatch,
  pathGlobMatch,
  type PermissionPathMatchOptions,
} from './path-glob-match';

const GLOB_LITERAL_SPECIAL = /[\\*?[\]{}()!+@|]/g;

export function literalRulePattern(toolName: string, subject: string): string {
  return `${toolName}(${escapeRuleSubjectLiteral(subject)})`;
}

export function escapeRuleSubjectLiteral(subject: string): string {
  return subject.replace(GLOB_LITERAL_SPECIAL, '\\$&');
}

export function matchesGlobRuleSubject(ruleArgs: string, subject: string): boolean {
  return matchesGlobRuleSubjects(ruleArgs, [subject]);
}

/**
 * Matches a rule against several subjects for one call, so a tool can be gated
 * on more than the one thing it is named after — `Agent(reviewer)` on the
 * profile, `Agent(model:opus)` on the model the call asked for.
 *
 * Namespace every subject past the first (`model:<alias>`), or an existing rule
 * written for the primary subject silently starts matching the new one too.
 */
export function matchesGlobRuleSubjects(
  ruleArgs: string,
  subjects: readonly string[],
): boolean {
  return matchRuleSubjects(ruleArgs, subjects, (pattern, value) => globMatch(value, pattern));
}

/** The rule subject for a model a call explicitly asked its subagents to use. */
export function modelRuleSubject(modelAlias: string | undefined): readonly string[] {
  return modelAlias === undefined || modelAlias.trim().length === 0
    ? []
    : [`model:${modelAlias.trim()}`];
}

export function matchesPathRuleSubject(
  ruleArgs: string,
  subject: string,
  options?: PermissionPathMatchOptions,
): boolean {
  return matchRuleSubjects(ruleArgs, [subject], (pattern, value) =>
    pathGlobMatch(value, pattern, options),
  );
}

function matchRuleSubjects(
  ruleArgs: string,
  subjects: readonly string[],
  matchesPositivePattern: (pattern: string, subject: string) => boolean,
): boolean {
  if (ruleArgs.length === 0) return true;
  const negated = ruleArgs.startsWith('!');
  const positivePattern = negated ? ruleArgs.slice(1) : ruleArgs;
  const hit = subjects.some((subject) => matchesPositivePattern(positivePattern, subject));
  return negated ? !hit : hit;
}
