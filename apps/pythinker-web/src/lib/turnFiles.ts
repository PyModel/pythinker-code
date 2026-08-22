import type { ChatTurn, DiffViewLine } from '../types';
import { turnBlocks } from '../components/chatTurnRendering';
import { diffStats } from './diffLines';
import { buildEditDiffLines, extractEditPath } from './toolDiff';
import { normalizeToolName } from './toolMeta';

export interface TurnFileChange {
  path: string;
  added: number;
  removed: number;
  hasWrite: boolean;
  statsIncomplete: boolean;
  diff: DiffViewLine[] | null;
}

function normalizedPathKey(path: string): string {
  const value = path.replaceAll('\\', '/');
  let prefix = '';
  let rest = value;
  let caseInsensitive = false;
  const unc = /^\/\/([^/]+\/[^/]+)(\/|$)/.exec(value);
  if (unc) {
    prefix = `//${unc[1]!.toLowerCase()}/`;
    rest = value.slice(unc[0].length - (unc[0].endsWith('/') ? 1 : 0));
    caseInsensitive = true;
  } else if (/^[a-zA-Z]:\//.test(value)) {
    prefix = `${value[0]!.toLowerCase()}:/`;
    rest = value.slice(3);
    caseInsensitive = true;
  } else if (value.startsWith('/')) {
    prefix = '/';
    rest = value.slice(1);
  }
  const absolute = prefix !== '';
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts.at(-1) !== '..') parts.pop();
      else if (!absolute) parts.push(part);
    } else {
      parts.push(part);
    }
  }
  const key = prefix + parts.join('/');
  return caseInsensitive ? key.toLowerCase() : key;
}

function offsetDiff(base: DiffViewLine[], next: DiffViewLine[]): DiffViewLine[] {
  let oldOffset = 0;
  let newOffset = 0;
  for (const line of base) {
    if (line.oldNo !== undefined) oldOffset = Math.max(oldOffset, line.oldNo);
    if (line.newNo !== undefined) newOffset = Math.max(newOffset, line.newNo);
  }
  return next.map((line) => ({
    ...line,
    oldNo: line.oldNo === undefined ? undefined : line.oldNo + oldOffset,
    newNo: line.newNo === undefined ? undefined : line.newNo + newOffset,
  }));
}

export function turnFileChanges(turn: ChatTurn): TurnFileChange[] {
  const changes = new Map<string, TurnFileChange>();
  for (const block of turnBlocks(turn)) {
    if (block.kind !== 'tool' || block.tool.status === 'error') continue;
    const kind = normalizeToolName(block.tool.name);
    if (kind !== 'edit' && kind !== 'multi_edit' && kind !== 'write') continue;
    const path = extractEditPath(block.tool.arg);
    if (!path) continue;
    const hasWrite = kind === 'write';
    const diff = hasWrite ? null : buildEditDiffLines(block.tool);
    const stats = diff ? diffStats(diff) : { added: 0, removed: 0 };
    const statsIncomplete = hasWrite || diff === null;
    const key = normalizedPathKey(path);
    const current = changes.get(key);
    if (!current) {
      changes.set(key, {
        path,
        ...stats,
        hasWrite,
        statsIncomplete,
        diff,
      });
      continue;
    }
    current.added += stats.added;
    current.removed += stats.removed;
    current.hasWrite ||= hasWrite;
    current.statsIncomplete ||= statsIncomplete;
    if (current.diff !== null && diff !== null) {
      current.diff = [
        ...current.diff,
        { type: 'hunk', text: '···' },
        ...offsetDiff(current.diff, diff),
      ];
    } else {
      current.diff = null;
    }
  }
  return [...changes.values()];
}
