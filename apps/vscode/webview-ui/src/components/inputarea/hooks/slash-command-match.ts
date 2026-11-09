import type { SlashCommandInfo } from "shared/legacy-sdk";

export const NO_MATCH = Number.POSITIVE_INFINITY;

function isSubsequence(text: string, query: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      qi++;
    }
  }
  return qi === query.length;
}

/** Separators are noise while typing: `researchwriting` should still find `skill:research-writing`. */
function letters(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function matchesAnyWordPrefix(text: string, query: string): boolean {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => word.startsWith(query));
}

/**
 * Lower is a better match, `NO_MATCH` means the command is filtered out.
 *
 * Only the command name is matched. A description is prose — matching it pulls
 * in commands that have nothing to do with what was typed (`/sk` reaching
 * `/yolo` because its description happens to contain those letters), and the
 * user cannot tell why they are listed.
 */
export function scoreCommand(command: SlashCommandInfo, query: string): number {
  const name = command.name.toLowerCase();
  const q = query.toLowerCase();
  if (name.startsWith(q)) {
    return 0;
  }
  // A namespaced skill (`skill:research-writing`) should also match on the part
  // the user is actually thinking of, not only on its full prefix.
  if (matchesAnyWordPrefix(name, q)) {
    return 1;
  }
  if (name.includes(q)) {
    return 2;
  }
  // Forgiving tier: skipped letters and dropped separators still match.
  return isSubsequence(letters(name), letters(q)) ? 3 : NO_MATCH;
}

/** Commands that match `query`, best match first. An empty query keeps the original order. */
export function rankSlashCommands(
  commands: readonly SlashCommandInfo[],
  query: string,
): SlashCommandInfo[] {
  if (!query) {
    return [...commands];
  }
  return commands
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry) => entry.score !== NO_MATCH)
    .toSorted((left, right) => left.score - right.score)
    .map((entry) => entry.command);
}
