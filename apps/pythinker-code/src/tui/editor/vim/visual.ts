import type { OperatorRange } from './operators';
import type { Position, VisualKind } from './types';

function precedes(first: Position, second: Position): boolean {
  return first.line < second.line
    || (first.line === second.line && first.column <= second.column);
}

/**
 * Converts visual-mode endpoints to the operator range model.
 * Charwise visual mode includes both endpoints.
 */
export function selectionRange(
  anchor: Position,
  cursor: Position,
  kind: VisualKind,
): OperatorRange {
  if (kind === 'line') {
    return {
      kind: 'linewise',
      startLine: Math.min(anchor.line, cursor.line),
      startColumn: 0,
      endLine: Math.max(anchor.line, cursor.line),
      endColumn: 0,
    };
  }

  const start = precedes(anchor, cursor) ? anchor : cursor;
  const end = precedes(anchor, cursor) ? cursor : anchor;
  return {
    kind: 'charwise-inclusive',
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column,
  };
}
