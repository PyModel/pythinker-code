import {
  STREAMING_ARGS_FIELD_RE,
  STREAMING_ARGS_PREVIEW_MAX_CHARS,
} from '#/tui/constant/streaming';
import type { TodoItem } from '#/tui/components/chrome/todo-panel';

// Generic error formatting lives in the SDK so non-TUI surfaces (login flows,
// CLI) share it; re-exported here for the TUI's existing importers.
export { formatErrorMessage, formatErrorPayload } from '@pymodel/pythinker-code-sdk';

export function appendStreamingArgsPreview(
  current: string | undefined,
  next: string | null | undefined,
): string {
  const existing = (current ?? '').slice(0, STREAMING_ARGS_PREVIEW_MAX_CHARS);
  if (next === null || next === undefined || next.length === 0) return existing;
  const remaining = STREAMING_ARGS_PREVIEW_MAX_CHARS - existing.length;
  if (remaining <= 0) return existing;
  return `${existing}${next.slice(0, remaining)}`;
}

function unescapeJsonString(s: string): string {
  return s.replaceAll(/\\(["\\/bfnrt])/g, (_, ch: string) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case '/':
        return '/';
      default:
        return ch;
    }
  });
}

export function parseStreamingArgs(argumentsText: string): Record<string, unknown> {
  const previewText = argumentsText.slice(0, STREAMING_ARGS_PREVIEW_MAX_CHARS);
  if (previewText.trim().length === 0) return {};
  if (
    argumentsText.length <= STREAMING_ARGS_PREVIEW_MAX_CHARS &&
    previewText.trimEnd().endsWith('}')
  ) {
    try {
      const parsed = JSON.parse(previewText) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through to partial scan
    }
  }
  const result: Record<string, unknown> = {};
  for (const match of previewText.matchAll(STREAMING_ARGS_FIELD_RE)) {
    const key = match[1];
    const rawValue = match[2];
    if (key === undefined || rawValue === undefined) continue;
    if (!(key in result)) {
      result[key] = unescapeJsonString(rawValue);
    }
  }
  return result;
}

export function argsRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

export function serializeToolResultOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  return JSON.stringify(output, null, 2);
}

export function normalizeTodoList(value: unknown): TodoItem[] {
  // Replay/live tool payloads can come from either TodoList or the older
  // TodoWrite-style contract; normalize both before the TUI renders them.
  if (!Array.isArray(value)) return [];
  const todos = value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const record = item as Record<string, unknown>;
    const title =
      typeof record['title'] === 'string' && record['title'].length > 0
        ? record['title']
        : typeof record['content'] === 'string' && record['content'].length > 0
          ? record['content']
          : undefined;
    if (title === undefined) return [];

    const rawStatus = record['status'];
    const status: TodoItem['status'] | undefined =
      rawStatus === 'completed'
        ? 'done'
        : rawStatus === 'pending' || rawStatus === 'in_progress' || rawStatus === 'done'
          ? rawStatus
          : undefined;
    if (status === undefined) return [];

    const activeForm =
      typeof record['activeForm'] === 'string' && record['activeForm'].length > 0
        ? record['activeForm']
        : undefined;
    return [{ title, activeForm, status }];
  });
  return todos.length > 0 && todos.every((todo) => todo.status === 'done') ? [] : todos;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
