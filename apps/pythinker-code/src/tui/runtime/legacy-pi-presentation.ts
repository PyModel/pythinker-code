import type { TUIState } from '../tui-state';
import type { TuiPresentation } from './contracts';
import type { FooterViewModel } from './footer/footer-model';

export class LegacyPiPresentation implements TuiPresentation {
  constructor(private readonly state: TUIState) {}

  start(_onResize: () => void): void {
    this.state.ui.start();
  }

  stop(): void {
    this.state.ui.stop();
  }

  drainInput(): Promise<void> {
    return this.state.terminal.drainInput();
  }

  setTerminalTitle(title: string): void {
    this.state.terminal.setTitle(title);
  }

  setTerminalProgress(active: boolean): void {
    this.state.terminal.setProgress(active);
  }

  writeTerminalControl(sequence: string): void {
    this.state.terminal.write(sequence);
  }

  getComposerText(): string {
    return this.state.editor.getText();
  }

  setComposerText(text: string): void {
    this.state.editor.setText(text);
  }

  focusComposer(): void {
    this.state.ui.setFocus(this.state.editor);
  }

  addComposerHistory(text: string): void {
    this.state.editor.addToHistory(text);
  }

  updateFooter(viewModel: FooterViewModel): void {
    this.state.footer.setViewModel(viewModel);
    this.state.ui.requestRender();
  }

  notifyIdle(): void {
    this.state.ui.requestRender();
  }
}
