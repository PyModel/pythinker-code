export interface TaskOutputViewModel {
  readonly taskId: string;
  readonly title: string;
  readonly lines: readonly string[];
  readonly follow: boolean;
  readonly complete: boolean;
}

export interface TaskOutputModelOptions {
  readonly taskId: string;
  readonly title: string;
  readonly complete?: boolean;
}

export type TaskOutputKeyEvent =
  | { readonly kind: 'up' }
  | { readonly kind: 'down' }
  | { readonly kind: 'page-up' }
  | { readonly kind: 'page-down' }
  | { readonly kind: 'home' }
  | { readonly kind: 'end' }
  | { readonly kind: 'close' };

export type TaskOutputKeyResult =
  | { readonly type: 'consumed' }
  | { readonly type: 'close' };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class TaskOutputModel {
  private readonly options: TaskOutputModelOptions;
  private lines: readonly string[] = [];
  private scrollTop = 0;
  private follow = true;
  private complete: boolean;
  private lastViewportRows = 0;

  constructor(options: TaskOutputModelOptions) {
    this.options = options;
    this.complete = options.complete ?? false;
  }

  setOutput(fullOutput: string): void {
    this.lines = fullOutput.split('\n');
    const maxScroll = this.maxScroll(this.lastViewportRows);

    if (this.follow) {
      this.scrollTop = maxScroll;
      return;
    }

    this.scrollTop = clamp(this.scrollTop, 0, maxScroll);
  }

  setComplete(complete: boolean): void {
    this.complete = complete;
  }

  handleKey(event: TaskOutputKeyEvent): TaskOutputKeyResult {
    const maxScroll = this.maxScroll(this.lastViewportRows);

    switch (event.kind) {
      case 'up':
        this.scrollTop = clamp(this.scrollTop - 1, 0, maxScroll);
        this.follow = false;
        return { type: 'consumed' };
      case 'down':
        this.scrollTop = clamp(this.scrollTop + 1, 0, maxScroll);
        this.follow = this.scrollTop === maxScroll;
        return { type: 'consumed' };
      case 'page-up': {
        const step = Math.max(this.lastViewportRows - 1, 1);
        this.scrollTop = clamp(this.scrollTop - step, 0, maxScroll);
        this.follow = false;
        return { type: 'consumed' };
      }
      case 'page-down': {
        const step = Math.max(this.lastViewportRows - 1, 1);
        this.scrollTop = clamp(this.scrollTop + step, 0, maxScroll);
        this.follow = this.scrollTop === maxScroll;
        return { type: 'consumed' };
      }
      case 'home':
        this.scrollTop = 0;
        this.follow = false;
        return { type: 'consumed' };
      case 'end':
        this.scrollTop = maxScroll;
        this.follow = true;
        return { type: 'consumed' };
      case 'close':
        return { type: 'close' };
    }
  }

  toViewModel(viewportRows: number): TaskOutputViewModel {
    this.lastViewportRows = viewportRows;
    const maxScroll = this.maxScroll(viewportRows);
    this.scrollTop = clamp(this.scrollTop, 0, maxScroll);

    if (this.follow) {
      this.scrollTop = maxScroll;
    }

    return {
      taskId: this.options.taskId,
      title: this.options.title,
      lines: this.lines.slice(this.scrollTop, this.scrollTop + Math.max(viewportRows, 0)),
      follow: this.follow,
      complete: this.complete,
    };
  }

  private maxScroll(viewportRows: number): number {
    return Math.max(0, this.lines.length - Math.max(viewportRows, 1));
  }
}
