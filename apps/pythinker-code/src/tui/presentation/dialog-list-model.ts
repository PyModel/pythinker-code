export interface DialogRow {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly current?: boolean;
}

export interface DialogViewModel {
  readonly title: string;
  readonly rows: readonly DialogRow[];
  readonly selectedIndex: number;
  readonly query?: string;
  readonly hint?: string;
}

export interface DialogListOptions {
  readonly title: string;
  readonly rows: readonly DialogRow[];
  readonly pageSize?: number;
  readonly emptyHint?: string;
}

export type DialogListKeyEvent =
  | { readonly kind: 'up' }
  | { readonly kind: 'down' }
  | { readonly kind: 'home' }
  | { readonly kind: 'end' }
  | { readonly kind: 'page-up' }
  | { readonly kind: 'page-down' }
  | { readonly kind: 'enter' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'char'; readonly char: string };

export type DialogListKeyResult =
  | { readonly type: 'consumed' }
  | { readonly type: 'cancel' }
  | { readonly type: 'select'; readonly row: DialogRow };

const DEFAULT_PAGE_SIZE = 8;
const DEFAULT_EMPTY_HINT = 'No matches';

function isOrderedSubsequence(token: string, value: string): boolean {
  let tokenIndex = 0;

  for (const character of value) {
    if (character === token[tokenIndex]) {
      tokenIndex += 1;
      if (tokenIndex === token.length) {
        return true;
      }
    }
  }

  return false;
}

function firstEnabledIndex(rows: readonly DialogRow[]): number {
  const index = rows.findIndex((row) => !row.disabled);
  return index === -1 ? 0 : index;
}

export class DialogListModel {
  private readonly options: DialogListOptions;
  private readonly pageSize: number;
  private query = '';
  private selectedIndex: number;

  constructor(options: DialogListOptions) {
    this.options = options;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.selectedIndex = firstEnabledIndex(this.filteredRows());
  }

  toViewModel(): DialogViewModel {
    const rows = this.filteredRows();
    if (rows.length === 0) {
      return {
        title: this.options.title,
        rows,
        selectedIndex: 0,
        query: this.query || undefined,
        hint: this.options.emptyHint ?? DEFAULT_EMPTY_HINT,
      };
    }

    const page = Math.floor(this.selectedIndex / this.pageSize);
    const windowStart = page * this.pageSize;
    const windowEnd = Math.min(windowStart + this.pageSize, rows.length);

    return {
      title: this.options.title,
      rows: rows.slice(windowStart, windowEnd),
      selectedIndex: this.selectedIndex - windowStart,
      query: this.query || undefined,
      hint: undefined,
    };
  }

  handleKey(event: DialogListKeyEvent): DialogListKeyResult {
    const rows = this.filteredRows();

    switch (event.kind) {
      case 'up':
        this.move(rows, -1);
        return { type: 'consumed' };
      case 'down':
        this.move(rows, 1);
        return { type: 'consumed' };
      case 'home':
        this.selectedIndex = firstEnabledIndex(rows);
        return { type: 'consumed' };
      case 'end': {
        const lastEnabledIndex = rows.findLastIndex((row) => !row.disabled);
        this.selectedIndex = lastEnabledIndex === -1 ? Math.max(rows.length - 1, 0) : lastEnabledIndex;
        return { type: 'consumed' };
      }
      case 'page-up':
        this.movePage(rows, -1);
        return { type: 'consumed' };
      case 'page-down':
        this.movePage(rows, 1);
        return { type: 'consumed' };
      case 'char':
        this.query += event.char;
        this.resetSelection();
        return { type: 'consumed' };
      case 'backspace':
        if (this.query.length > 0) {
          this.query = this.query.slice(0, -1);
          this.resetSelection();
        }
        return { type: 'consumed' };
      case 'escape':
        if (this.query.length > 0) {
          this.query = '';
          this.resetSelection();
          return { type: 'consumed' };
        }
        return { type: 'cancel' };
      case 'enter': {
        const row = rows[this.selectedIndex];
        return row && !row.disabled ? { type: 'select', row } : { type: 'consumed' };
      }
    }
  }

  private filteredRows(): readonly DialogRow[] {
    const tokens = this.query
      .trim()
      .split(/\s+|\//)
      .filter(Boolean)
      .map((token) => token.toLowerCase());

    if (tokens.length === 0) {
      return this.options.rows;
    }

    return this.options.rows.filter((row) => {
      const searchableText = `${row.label} ${row.description ?? ''}`.toLowerCase();
      return tokens.every((token) => isOrderedSubsequence(token, searchableText));
    });
  }

  private move(rows: readonly DialogRow[], direction: -1 | 1): void {
    for (
      let index = this.selectedIndex + direction;
      index >= 0 && index < rows.length;
      index += direction
    ) {
      if (!rows[index]?.disabled) {
        this.selectedIndex = index;
        return;
      }
    }
  }

  private movePage(rows: readonly DialogRow[], direction: -1 | 1): void {
    if (rows.length === 0) {
      return;
    }

    const rawTarget = Math.min(
      Math.max(this.selectedIndex + direction * this.pageSize, 0),
      rows.length - 1,
    );

    if (!rows[rawTarget]?.disabled) {
      this.selectedIndex = rawTarget;
      return;
    }

    const primary = this.findEnabledFrom(rows, rawTarget + direction, direction);
    const fallbackDirection = direction === 1 ? -1 : 1;
    const fallback = this.findEnabledFrom(rows, rawTarget + fallbackDirection, fallbackDirection);
    const target = primary ?? fallback;
    if (target !== undefined) {
      this.selectedIndex = target;
    }
  }

  private findEnabledFrom(
    rows: readonly DialogRow[],
    startIndex: number,
    direction: -1 | 1,
  ): number | undefined {
    for (let index = startIndex; index >= 0 && index < rows.length; index += direction) {
      if (!rows[index]?.disabled) {
        return index;
      }
    }
    return undefined;
  }

  private resetSelection(): void {
    this.selectedIndex = firstEnabledIndex(this.filteredRows());
  }
}
