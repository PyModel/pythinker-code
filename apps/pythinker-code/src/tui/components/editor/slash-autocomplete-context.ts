interface VisibleRange {
  readonly start: number;
  readonly end: number;
}

export interface SlashAutocompleteContext {
  readonly kind: 'name' | 'args';
  readonly commandStart: number;
  readonly commandEnd: number;
  readonly commandName: string;
  readonly prefix: string;
  readonly replaceStart: number;
  readonly replaceEnd: number;
  readonly argumentStart?: number;
}

const SLASH_BOUNDARY_CHARS = new Set([' ', '\t', '"', "'", '`', '(', '[', '{', '<']);

export function findSlashAutocompleteContext(
  line: string,
  cursorCol: number,
): SlashAutocompleteContext | null {
  const clampedCursor = Math.max(0, Math.min(cursorCol, line.length));

  for (let i = clampedCursor - 1; i >= 0; i -= 1) {
    if (line[i] !== '/') continue;
    if (!isSlashBoundary(line[i - 1])) continue;

    const commandStart = i;
    const commandEnd = findTokenEnd(line, commandStart);
    const commandName = line.slice(commandStart + 1, commandEnd);
    if (commandName.includes('/')) continue;

    if (clampedCursor <= commandEnd) {
      return {
        kind: 'name',
        commandStart,
        commandEnd,
        commandName,
        prefix: line.slice(commandStart, clampedCursor),
        replaceStart: commandStart,
        replaceEnd: commandEnd,
      };
    }

    const argumentStart = commandEnd + 1;
    return {
      kind: 'args',
      commandStart,
      commandEnd,
      commandName,
      prefix: line.slice(argumentStart, clampedCursor),
      replaceStart: argumentStart,
      replaceEnd: findTokenEnd(line, clampedCursor),
      argumentStart,
    };
  }

  return null;
}

export function getSlashHighlightRanges(line: string, cursorCol: number): VisibleRange[] {
  const context = findSlashAutocompleteContext(line, cursorCol);
  if (context === null) return [];

  const ranges: VisibleRange[] = [{ start: context.commandStart, end: context.commandEnd }];
  if (context.commandName === 'goal') {
    ranges.push(...goalCommandPathRanges(line, context.commandEnd));
  }
  return ranges;
}

function goalCommandPathRanges(line: string, commandEnd: number): VisibleRange[] {
  const nextRange = readTokenRange(line, commandEnd);
  if (nextRange === null || line.slice(nextRange.start, nextRange.end) !== 'next') {
    return [];
  }
  const ranges = [nextRange];
  const manageRange = readTokenRange(line, nextRange.end);
  if (manageRange !== null && line.slice(manageRange.start, manageRange.end) === 'manage') {
    ranges.push(manageRange);
  }
  return ranges;
}

function readTokenRange(line: string, start: number): VisibleRange | null {
  let tokenStart = start;
  while (tokenStart < line.length && isTokenSpace(line[tokenStart])) tokenStart += 1;
  if (tokenStart >= line.length) return null;
  return {
    start: tokenStart,
    end: findTokenEnd(line, tokenStart),
  };
}

function findTokenEnd(line: string, start: number): number {
  let end = start;
  while (end < line.length && !isTokenSpace(line[end])) end += 1;
  return end;
}

function isSlashBoundary(ch: string | undefined): boolean {
  return ch === undefined || SLASH_BOUNDARY_CHARS.has(ch);
}

function isTokenSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}
