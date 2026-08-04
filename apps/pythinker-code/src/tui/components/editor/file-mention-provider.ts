import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import {
  CombinedAutocompleteProvider,
  fuzzyMatch,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  type SlashCommand,
} from '@earendil-works/pi-tui';

import { findSlashAutocompleteContext } from './slash-autocomplete-context';

const PATH_DELIMITERS = new Set([' ', '\t', '"', "'", '=']);
const TRAILING_PROSE_PUNCTUATION = new Set([
  ',',
  '.',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '>',
  '"',
  "'",
  '`',
]);
const MAX_FALLBACK_SCAN = 2000;
const MAX_FALLBACK_SUGGESTIONS = 50;

export interface SlashAutocompleteCommand extends SlashCommand {
  readonly aliases?: readonly string[];
}

interface FsMentionCandidate {
  readonly path: string;
  readonly isDirectory: boolean;
}

/**
 * Pythinker wrapper around pi-tui's combined autocomplete provider.
 *
 * File / folder mention behavior uses pi-tui's fd-backed provider when fd is
 * available. While managed fd is downloading (or when it is unavailable), a
 * small filesystem fallback keeps basic `@` file and folder completion usable.
 * Ordinary path completion is still handled by pi-tui's readdir-backed path
 * completer. This wrapper also keeps Pythinker-specific slash-command guards.
 */
export class FileMentionProvider implements AutocompleteProvider {
  private readonly inner: CombinedAutocompleteProvider;

  constructor(
    private readonly slashCommands: SlashAutocompleteCommand[],
    private readonly workDir: string,
    private readonly fdPath: string | null,
  ) {
    // Build an expanded list that includes alias entries so that
    // inner's argument completion can find commands by alias too.
    const expanded: SlashAutocompleteCommand[] = [];
    for (const cmd of slashCommands) {
      expanded.push(cmd);
      for (const alias of cmd.aliases ?? []) {
        expanded.push({ ...cmd, name: alias });
      }
    }
    this.inner = new CombinedAutocompleteProvider(expanded, workDir, fdPath);
  }

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const currentLine = lines[cursorLine] ?? '';
    const textBeforeCursor = currentLine.slice(0, cursorCol);

    const atPrefix = extractAtPrefix(textBeforeCursor);
    if (atPrefix !== null) {
      if (this.fdPath === null) {
        return getFsMentionSuggestions(this.workDir, atPrefix, options.signal);
      }
      try {
        return await this.inner.getSuggestions(lines, cursorLine, cursorCol, options);
      } catch {
        // If fd fails to spawn unexpectedly, keep @ completion usable.
        return getFsMentionSuggestions(this.workDir, atPrefix, options.signal);
      }
    }

    const slashContext = findSlashAutocompleteContext(currentLine, cursorCol);
    if (slashContext !== null && !shouldPreferForcedRootPath(textBeforeCursor, options.force)) {
      if (slashContext.kind === 'name') {
        const suggestions = getSlashCommandNameSuggestions(this.slashCommands, slashContext.prefix);
        if (suggestions !== null) {
          return suggestions;
        }
        if (options.force !== true) {
          return null;
        }
      }

      if (
        options.force !== true &&
        slashContext.prefix.trim().length === 0 &&
        currentLine.slice(cursorCol).trimStart().length > 0
      ) {
        return null;
      }

      const command = findSlashAutocompleteCommand(this.slashCommands, slashContext.commandName);
      if (command?.getArgumentCompletions !== undefined) {
        const items = await command.getArgumentCompletions(slashContext.prefix);
        if (Array.isArray(items) && items.length > 0) {
          return {
            items,
            prefix: slashContext.prefix,
          };
        }
      }
      if (options.force !== true) {
        return null;
      }
    }

    try {
      return await this.inner.getSuggestions(lines, cursorLine, cursorCol, options);
    } catch {
      return null;
    }
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    const currentLine = lines[cursorLine] ?? '';
    const slashContext = findSlashAutocompleteContext(currentLine, cursorCol);
    if (slashContext !== null && slashContext.prefix === prefix) {
      const nextLines = [...lines];
      if (slashContext.kind === 'name') {
        const before = currentLine.slice(0, slashContext.commandStart);
        const completionEnd = trimTrailingProsePunctuation(currentLine, cursorCol, slashContext.commandEnd);
        const after = currentLine.slice(completionEnd);
        const separator = shouldInsertSlashCommandSeparator(after) ? ' ' : '';
        nextLines[cursorLine] = `${before}/${item.value}${separator}${after}`;
        return {
          lines: nextLines,
          cursorLine,
          cursorCol: before.length + item.value.length + separator.length + 1,
        };
      }

      const before = currentLine.slice(0, slashContext.replaceStart);
      const completionEnd = trimTrailingProsePunctuation(currentLine, cursorCol, slashContext.replaceEnd);
      const after = currentLine.slice(completionEnd);
      nextLines[cursorLine] = `${before}${item.value}${after}`;
      return {
        lines: nextLines,
        cursorLine,
        cursorCol: before.length + item.value.length,
      };
    }
    return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }
}

function extractAtPrefix(text: string): string | null {
  let tokenStart = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (PATH_DELIMITERS.has(text[i] ?? '')) {
      tokenStart = i + 1;
      break;
    }
  }
  if (text[tokenStart] !== '@') return null;
  return text.slice(tokenStart);
}

function getFsMentionSuggestions(
  workDir: string,
  atPrefix: string,
  signal: AbortSignal,
): AutocompleteSuggestions | null {
  if (signal.aborted) return null;

  const query = atPrefix.slice(1);
  const candidates = collectFsMentionCandidates(workDir, signal);
  if (candidates.length === 0 || signal.aborted) return null;

  const ranked = rankFsMentionCandidates(candidates, query).slice(0, MAX_FALLBACK_SUGGESTIONS);
  if (ranked.length === 0) return null;

  return {
    prefix: atPrefix,
    items: ranked.map(toMentionItem),
  };
}

function collectFsMentionCandidates(workDir: string, signal: AbortSignal): FsMentionCandidate[] {
  const result: FsMentionCandidate[] = [];
  const stack = [''];

  while (stack.length > 0 && result.length < MAX_FALLBACK_SCAN) {
    if (signal.aborted) break;
    const relativeDir = stack.pop() ?? '';
    const absoluteDir = relativeDir.length === 0 ? workDir : join(workDir, relativeDir);
    let entries;
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (signal.aborted || result.length >= MAX_FALLBACK_SCAN) break;
      if (entry.name === '.git') continue;

      const relativePath = normalizePath(relativeDir.length === 0 ? entry.name : join(relativeDir, entry.name));
      const isSymlink = entry.isSymbolicLink();
      let isDirectory = entry.isDirectory();
      if (!isDirectory && isSymlink) {
        try {
          isDirectory = statSync(join(workDir, relativePath)).isDirectory();
        } catch {
          // Broken symlink or permission error — keep it as a file candidate.
        }
      }

      result.push({ path: relativePath, isDirectory });
      if (isDirectory && !isSymlink) {
        stack.push(relativePath);
      }
    }
  }

  return result;
}

function rankFsMentionCandidates(
  candidates: readonly FsMentionCandidate[],
  query: string,
): FsMentionCandidate[] {
  const lowerQuery = query.toLowerCase();
  const scored: Array<{ candidate: FsMentionCandidate; score: number }> = [];

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, lowerQuery);
    if (score > 0) scored.push({ candidate, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.candidate.isDirectory !== b.candidate.isDirectory) {
      return a.candidate.isDirectory ? -1 : 1;
    }
    return a.candidate.path.localeCompare(b.candidate.path);
  });

  return scored.map((entry) => entry.candidate);
}

function scoreCandidate(candidate: FsMentionCandidate, lowerQuery: string): number {
  if (lowerQuery.length === 0) {
    const depthPenalty = candidate.path.split('/').length - 1;
    return (candidate.isDirectory ? 120 : 100) - depthPenalty;
  }

  const lowerPath = candidate.path.toLowerCase();
  const lowerBase = basename(candidate.path).toLowerCase();
  let score = 0;
  if (lowerBase === lowerQuery) score = 100;
  else if (lowerBase.startsWith(lowerQuery)) score = 80;
  else if (lowerBase.includes(lowerQuery)) score = 50;
  else if (lowerPath.includes(lowerQuery)) score = 30;
  if (candidate.isDirectory && score > 0) score += 10;
  return score;
}

function toMentionItem(candidate: FsMentionCandidate): AutocompleteItem {
  const valuePath = candidate.isDirectory ? `${candidate.path}/` : candidate.path;
  const value = valuePath.includes(' ') ? `@"${valuePath}"` : `@${valuePath}`;
  const label = `${basename(candidate.path)}${candidate.isDirectory ? '/' : ''}`;
  return {
    value,
    label,
    description: valuePath,
  };
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function shouldPreferForcedRootPath(
  textBeforeCursor: string,
  force: boolean | undefined,
): boolean {
  return force === true && textBeforeCursor.trim() === '/';
}

function trimTrailingProsePunctuation(line: string, cursorCol: number, tokenEnd: number): number {
  let nextEnd = tokenEnd;
  while (nextEnd > cursorCol && TRAILING_PROSE_PUNCTUATION.has(line[nextEnd - 1] ?? '')) {
    nextEnd -= 1;
  }
  return nextEnd;
}

function shouldInsertSlashCommandSeparator(after: string): boolean {
  const nextChar = after[0];
  if (nextChar === undefined) return false;
  if (nextChar === ' ' || nextChar === '\t') return false;
  return !TRAILING_PROSE_PUNCTUATION.has(nextChar);
}

function getSlashCommandNameSuggestions(
  slashCommands: readonly SlashAutocompleteCommand[],
  prefix: string,
): AutocompleteSuggestions | null {
  const tokens = prefix
    .slice(1)
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);

  type SlashMatch = {
    readonly cmd: SlashAutocompleteCommand;
    readonly score: number;
    readonly viaAlias: boolean;
    readonly label: string;
  };

  const matches: SlashMatch[] = [];
  for (const cmd of slashCommands) {
    const nameScore = scoreTokens(tokens, cmd.name);
    if (nameScore !== null) {
      matches.push({ cmd, score: nameScore, viaAlias: false, label: cmd.name });
      continue;
    }

    const aliases = cmd.aliases ?? [];
    let bestAliasScore: number | null = null;
    for (const alias of aliases) {
      const aliasScore = scoreTokens(tokens, alias);
      if (aliasScore !== null && (bestAliasScore === null || aliasScore < bestAliasScore)) {
        bestAliasScore = aliasScore;
      }
    }
    if (bestAliasScore !== null) {
      matches.push({
        cmd,
        score: bestAliasScore,
        viaAlias: true,
        label: `${cmd.name} (${aliases.join(', ')})`,
      });
    }
  }

  matches.sort((a, b) => a.score - b.score || Number(a.viaAlias) - Number(b.viaAlias));
  if (matches.length === 0) return null;
  return {
    items: matches.map((match) => ({
      value: match.cmd.name,
      label: match.label,
      description: formatSlashCommandDescription(match.cmd),
    })),
    prefix,
  };
}

function findSlashAutocompleteCommand(
  slashCommands: readonly SlashAutocompleteCommand[],
  name: string,
): SlashAutocompleteCommand | undefined {
  return slashCommands.find((command) => command.name === name || command.aliases?.includes(name));
}

/**
 * All tokens must fuzzy-match `text`; returns the summed score, or null when
 * any token misses. An empty token list matches everything with score 0.
 * Mirrors pi-tui fuzzyFilter's token semantics — keep in sync if it changes.
 */
function scoreTokens(tokens: readonly string[], text: string): number | null {
  let score = 0;
  for (const token of tokens) {
    const m = fuzzyMatch(token, text);
    if (!m.matches) return null;
    score += m.score;
  }
  return score;
}

/**
 * Mirrors CombinedAutocompleteProvider's description rendering so the
 * intercepted name completion keeps showing the argument hint.
 */
function formatSlashCommandDescription(cmd: SlashAutocompleteCommand): string | undefined {
  const desc = cmd.description ?? '';
  const full = cmd.argumentHint
    ? desc
      ? `${cmd.argumentHint} — ${desc}`
      : cmd.argumentHint
    : desc;
  return full || undefined;
}
