import type { TerminalSize } from './feature-matrix';

export interface SemanticFeatureFixture {
  readonly terminalSize: TerminalSize;
  readonly viewport: { readonly columns: number; readonly rows: number };
  readonly activeView: 'conversation';
  readonly focus: 'editor';
  readonly content: readonly string[];
  readonly ordering: readonly string[];
  readonly keyActions: readonly {
    readonly keys: string;
    readonly effect: string;
  }[];
}

export const LEGACY_FEATURE_FIXTURES: Readonly<Record<TerminalSize, SemanticFeatureFixture>> = {
  '80x24': {
    terminalSize: '80x24',
    viewport: { columns: 80, rows: 24 },
    activeView: 'conversation',
    focus: 'editor',
    content: ['welcome', 'user prompt', 'assistant response', 'completed tool summary', 'footer'],
    ordering: ['welcome', 'user', 'thinking', 'tool_call', 'assistant', 'status', 'editor', 'footer'],
    keyActions: [
      { keys: 'Enter', effect: 'submit editor text or accept the focused dialog choice' },
      { keys: 'Up', effect: 'recall input history when autocomplete is closed' },
      { keys: 'Ctrl+C', effect: 'clear input first, then request exit' },
    ],
  },
  '120x40': {
    terminalSize: '120x40',
    viewport: { columns: 120, rows: 40 },
    activeView: 'conversation',
    focus: 'editor',
    content: ['welcome and banner', 'user prompt', 'streamed assistant text', 'activity', 'footer'],
    ordering: ['welcome', 'banner', 'user', 'thinking', 'tool_call', 'assistant', 'editor', 'footer'],
    keyActions: [
      { keys: 'Tab', effect: 'advance autocomplete or structured-question focus' },
      { keys: 'Ctrl+O', effect: 'toggle thinking detail visibility' },
      { keys: 'Ctrl+G', effect: 'open the configured external editor' },
    ],
  },
  '200x60': {
    terminalSize: '200x60',
    viewport: { columns: 200, rows: 60 },
    activeView: 'conversation',
    focus: 'editor',
    content: ['welcome and banner', 'grouped tools', 'assistant response', 'queue pane', 'footer'],
    ordering: ['welcome', 'banner', 'user', 'grouped_tools', 'assistant', 'queue', 'editor', 'footer'],
    keyActions: [
      { keys: 'Shift+Tab', effect: 'move backward through structured-question focus' },
      { keys: 'Escape', effect: 'close the active dialog and restore editor focus' },
      { keys: 'Ctrl+D', effect: 'request exit when the editor is empty' },
    ],
  },
};
