import type { FooterViewModel } from './footer/footer-model';

export interface TuiPresentation {
  start(onResize: () => void): void;
  stop(): void;
  drainInput(): Promise<void>;
  setTerminalTitle(title: string): void;
  setTerminalProgress(active: boolean): void;
  writeTerminalControl(sequence: string): void;
  getComposerText(): string;
  setComposerText(text: string): void;
  focusComposer(): void;
  addComposerHistory(text: string): void;
  updateFooter(viewModel: FooterViewModel): void;
  notifyIdle(): void;
}
