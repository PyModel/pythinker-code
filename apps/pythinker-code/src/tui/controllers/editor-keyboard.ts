import { Editor, parseKey } from '@earendil-works/pi-tui';
import {
  coerceEffortForModel,
  effortLevelsForModel,
  type Session,
} from '@pythoughts/pythinker-code-sdk';

import { ClipboardMediaError, readClipboardMedia } from '#/utils/clipboard/clipboard-image';
import { parseImageMeta } from '#/utils/image/image-mime';
import { editInExternalEditor, resolveEditorCommand } from '#/utils/process/external-editor';

import {
  CTRL_C_HINT,
  CTRL_D_HINT,
  EXIT_CONFIRM_WINDOW_MS,
  LLM_NOT_SET_MESSAGE,
} from '../constant/pythinker-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { ImageAttachmentStore } from '../utils/image-attachment-store';
import type { AppState, PendingExit } from '../types';
import type { TUIState } from '../tui-state';
import type { FooterEvent } from '../runtime/footer/footer-model';
import type { BtwPanelController } from './btw-panel';
import type { FooterActionId } from '#/tui/components/chrome/footer';
import {
  defaultKeybindings,
  KeybindingResolver,
  type ParsedKeybinding,
} from '#/tui/keybindings';
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';

function effectiveContextBindings(
  bindings: readonly ParsedKeybinding[],
  context: 'Chat' | 'Footer',
): readonly ParsedKeybinding[] {
  const winners = new Map<string, ParsedKeybinding>();
  for (const binding of bindings) {
    if (binding.context === context || binding.context === 'Global') {
      winners.set(`${binding.context}\0${binding.chord.join('\0')}`, binding);
    }
  }
  return [...winners.values()];
}

export interface EditorKeyboardHost {
  state: TUIState;
  session: Session | undefined;
  cancelInFlight: (() => void) | undefined;

  handleUserInput(text: string): void;
  readonly btwPanelController: BtwPanelController;
  steerMessage(session: Session, input: string[]): void;
  recallLastQueued(): string | undefined;
  showError(msg: string): void;
  showNotice(title: string, detail?: string): void;
  setAppState(patch: Partial<AppState>): void;
  dispatchFooter(event: FooterEvent): void;
  track(event: string, props?: Record<string, unknown>): void;
  updateEditorBorderHighlight(text?: string): void;
  updateQueueDisplay(): void;
  toggleToolOutputExpansion(): void;
  hideSessionPicker(): void;
  showInputHistoryPicker(): Promise<void>;
  showMessageActions(): void;
  stop(exitCode?: number): Promise<void>;
  clearQueuedMessages(): void;
  setExternalEditorRunning(running: boolean): void;
  openFooterAction(id: FooterActionId): void;
  canFocusFooter(): boolean;
}

export class EditorKeyboardController {
  private pendingExit: PendingExit | null = null;
  private footerKeybindings = new KeybindingResolver([]);
  private historyNextKeybindings = new KeybindingResolver([]);
  private footerBindings: readonly ParsedKeybinding[] = [];
  private historyNextBindings: readonly ParsedKeybinding[] = [];

  constructor(
    private readonly host: EditorKeyboardHost,
    private readonly imageStore: ImageAttachmentStore,
  ) {
    this.setKeybindings(defaultKeybindings());
  }

  install(): void {
    const { host } = this;
    const editor = host.state.editor;

    host.state.ui.addInputListener((data) => this.handleFooterInput(data));

    editor.onSubmit = (text: string) => {
      host.handleUserInput(text);
    };

    editor.onChange = (text: string) => {
      if (this.pendingExit) this.clearPendingExit();
      host.updateEditorBorderHighlight(text);
    };

    editor.onCtrlC = () => {
      if (host.cancelInFlight !== undefined) {
        const cancel = host.cancelInFlight;
        host.cancelInFlight = undefined;
        this.clearPendingExit();
        cancel();
        return;
      }

      if (host.btwPanelController.cancelRunning()) {
        this.clearPendingExit();
        return;
      }
      if (host.btwPanelController.closeOrCancel()) {
        this.clearPendingExit();
        return;
      }

      if (host.state.appState.isCompacting) {
        this.clearPendingExit();
        this.cancelCurrentCompaction();
        return;
      }

      if (host.state.appState.streamingPhase !== 'idle') {
        this.clearPendingExit();

        if (editor.getText().length > 0) {
          editor.setText('');
          return;
        }

        this.cancelCurrentStream();
        return;
      }

      if (this.pendingExit?.kind === 'ctrl-c') {
        this.clearPendingExit();
        void host.stop();
        return;
      }

      if (editor.getText().length > 0) {
        editor.setText('');
      }
      this.armPendingExit('ctrl-c', CTRL_C_HINT);
    };

    editor.onCtrlD = () => {
      if (this.pendingExit?.kind === 'ctrl-d') {
        this.clearPendingExit();
        void host.stop();
        return;
      }
      this.armPendingExit('ctrl-d', CTRL_D_HINT);
    };

    editor.onRedraw = () => {
      host.state.ui.requestRender();
    };

    editor.onEscape = () => {
      if (this.pendingExit) this.clearPendingExit();
      if (host.state.activeDialog === 'session-picker') {
        host.hideSessionPicker();
        return;
      }
      if (host.btwPanelController.closeOrCancel()) {
        return;
      }
      if (host.state.appState.isCompacting) {
        this.cancelCurrentCompaction();
        return;
      }
      if (host.state.appState.streamingPhase !== 'idle') {
        this.cancelCurrentStream();
      }
    };

    editor.onOpenExternalEditor = () => {
      host.track('shortcut_editor');
      void this.openExternalEditor();
    };

    editor.onSearchHistory = () => {
      host.track('shortcut_history_search');
      void host.showInputHistoryPicker();
    };

    editor.onMessageActions = () => {
      host.track('shortcut_message_actions');
      host.showMessageActions();
    };

    editor.onToggleToolExpand = () => {
      host.track('shortcut_expand');
      host.toggleToolOutputExpansion();
    };

    editor.onCtrlS = () => {
      if (host.state.appState.streamingPhase === 'idle' || host.state.appState.isCompacting) return;
      const text = editor.getText().trim();
      const queuedTexts = host.state.queuedMessages.map((m) => m.text);
      host.clearQueuedMessages();

      const parts: string[] = [];
      for (const q of queuedTexts) {
        const trimmed = q.trim();
        if (trimmed.length > 0) parts.push(trimmed);
      }
      if (text.length > 0) parts.push(text);

      if (parts.length > 0) {
        editor.setText('');
        const session = host.session;
        if (host.state.appState.model.trim().length === 0 || session === undefined) {
          host.showError(LLM_NOT_SET_MESSAGE);
        } else {
          host.steerMessage(session, parts);
        }
      }
      host.updateQueueDisplay();
      host.state.ui.requestRender();
    };

    editor.onCycleEffort = () => {
      void this.cycleThinkingEffort();
    };

    editor.onUndo = () => {
      host.track('undo');
    };

    editor.onInsertNewline = () => {
      host.track('shortcut_newline');
    };

    editor.onTextPaste = () => {
      host.track('shortcut_paste', { kind: 'text' });
    };

    editor.onCommand = (command) => {
      host.handleUserInput(`/${command}`);
    };

    editor.onUpArrowEmpty = () => {
      if (host.btwPanelController.scroll('up')) return true;
      if (host.state.appState.streamingPhase === 'idle' && !host.state.appState.isCompacting) return false;
      const recalled = host.recallLastQueued();
      if (recalled !== undefined) {
        editor.setText(recalled);
        host.updateQueueDisplay();
        host.state.ui.requestRender();
        return true;
      }
      return false;
    };

    editor.onDownArrowEmpty = () => host.btwPanelController.scroll('down');

    editor.onPasteImage = async () => this.handleClipboardImagePaste();
  }

  setKeybindings(bindings: readonly ParsedKeybinding[]): void {
    this.footerBindings = effectiveContextBindings(bindings, 'Footer').filter(
      (binding) => binding.action === null || binding.action.startsWith('footer:'),
    );
    this.historyNextBindings = effectiveContextBindings(bindings, 'Chat').filter(
      (binding) => binding.action === null || binding.action === 'history:next',
    );
    this.resetFooterKeybindings();
  }

  clearPendingExit(): void {
    if (!this.pendingExit) return;
    clearTimeout(this.pendingExit.timer);
    this.host.dispatchFooter({ type: 'transient-hint.updated', hint: null });
    this.pendingExit = null;
  }

  private armPendingExit(kind: 'ctrl-c' | 'ctrl-d', hint: string): void {
    this.clearPendingExit();
    this.host.dispatchFooter({ type: 'transient-hint.updated', hint });

    const timer = setTimeout(() => {
      if (this.pendingExit?.timer === timer) {
        this.clearPendingExit();
        this.host.state.ui.requestRender();
      }
    }, EXIT_CONFIRM_WINDOW_MS);

    this.pendingExit = { kind, timer };
    this.host.state.ui.requestRender();
  }

  private cancelCurrentStream(): void {
    void this.host.session?.cancel();
  }

  /** Ctrl-T / Shift-Tab: cycle the thinking effort to the current model's next level (wraps). */
  private async cycleThinkingEffort(): Promise<void> {
    const { host } = this;
    const alias = host.state.appState.model;
    if (alias.trim().length === 0) {
      host.showError(LLM_NOT_SET_MESSAGE);
      return;
    }
    const model = host.state.appState.availableModels[alias];
    const levels = effortLevelsForModel(model);
    if (levels.length <= 1) {
      host.showNotice(`${alias} does not offer selectable thinking effort levels.`);
      return;
    }
    const current = coerceEffortForModel(model, host.state.appState.thinkingLevel);
    const next = levels[(levels.indexOf(current) + 1) % levels.length]!;
    try {
      await host.session?.setThinking(next);
    } catch (error) {
      host.showError(`Failed to set thinking effort: ${formatErrorMessage(error)}`);
      return;
    }
    host.setAppState({ thinkingLevel: next });
    host.track('thinking_toggle', { enabled: next !== 'off', effort: next });
    // No transcript notice: the footer already shows the new level live, and
    // rapid cycling would stack a line per keypress in the chat history.
  }

  private cancelCurrentCompaction(): void {
    const session = this.host.session;
    if (session === undefined) return;
    void session.cancelCompaction().catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.host.showError(`Failed to cancel compaction: ${message}`);
    });
  }

  private handleFooterInput(data: string): { consume: boolean } | undefined {
    const { host } = this;
    const { footer } = host.state;
    if (!host.canFocusFooter()) {
      footer.clearSelection();
      this.resetFooterKeybindings();
      return undefined;
    }
    if (footer.selectedActionId() !== null) {
      if (data === '\u001B') {
        footer.clearSelection();
        return { consume: true };
      }
      if (
        this.dispatchKeybindings(this.footerKeybindings, data, ['Footer'], {
          'footer:up': () => footer.selectPrevious(),
          'footer:down': () => footer.selectNext(),
          'footer:next': () => footer.selectNext(),
          'footer:previous': () => footer.selectPrevious(),
          'footer:openSelected': () => {
            const action = footer.selectedActionId();
            footer.clearSelection();
            if (action !== null) host.openFooterAction(action);
          },
          'footer:clearSelection': () => footer.clearSelection(),
        })
      ) {
        return { consume: true };
      }
      if (isPrintableChar(printableChar(data))) {
        footer.clearSelection();
        return undefined;
      }
      return undefined;
    }

    let historyNext = false;
    const handled = this.dispatchKeybindings(this.historyNextKeybindings, data, ['Chat'], {
      'history:next': () => {
        historyNext = true;
      },
    });
    if (handled && !historyNext) return { consume: true };
    if (!historyNext || !host.canFocusFooter()) {
      return undefined;
    }

    Editor.prototype.handleInput.call(host.state.editor, '\u001B[B');
    if (host.state.editor.getText().length === 0) footer.selectFirst();
    return { consume: true };
  }

  private resetFooterKeybindings(): void {
    this.footerKeybindings = new KeybindingResolver(this.footerBindings);
    this.historyNextKeybindings = new KeybindingResolver(this.historyNextBindings);
  }

  private dispatchKeybindings(
    resolver: KeybindingResolver,
    data: string,
    contexts: Parameters<KeybindingResolver['dispatchKeyId']>[1],
    handlers: Parameters<KeybindingResolver['dispatchKeyId']>[2],
  ): boolean {
    const keyId = parseKey(data);
    return keyId === undefined || keyId === data
      ? resolver.dispatchKeyId(data, contexts, handlers)
      : resolver.dispatch(data, contexts, handlers);
  }

  private async handleClipboardImagePaste(): Promise<boolean> {
    let media;
    try {
      media = await readClipboardMedia();
    } catch (error) {
      if (error instanceof ClipboardMediaError) {
        this.host.showError(error.message);
        return true;
      }
      return false;
    }
    if (media === null) return false;

    if (media.kind === 'video') {
      const attachment = this.imageStore.addVideo(media.mimeType, media.sourcePath, media.filename);
      this.host.state.editor.insertTextAtCursor?.(`${attachment.placeholder} `);
      this.host.state.ui.requestRender();
      this.host.track('shortcut_paste', { kind: 'video' });
      return true;
    }

    const meta = parseImageMeta(media.bytes);
    if (meta === null) return false;
    const attachment = this.imageStore.addImage(media.bytes, meta.mime, meta.width, meta.height);
    this.host.state.editor.insertTextAtCursor?.(`${attachment.placeholder} `);
    this.host.state.ui.requestRender();
    this.host.track('shortcut_paste', { kind: 'image' });
    return true;
  }

  private async openExternalEditor(): Promise<void> {
    const { state } = this.host;
    if (state.externalEditorRunning) return;
    const cmd = resolveEditorCommand(state.appState.editorCommand);
    if (cmd === undefined) {
      this.host.showError('No editor configured. Set $VISUAL / $EDITOR, or run /editor <command>.');
      return;
    }
    this.host.setExternalEditorRunning(true);
    const seed = state.editor.getExpandedText?.() ?? state.editor.getText();
    state.ui.stop();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    try {
      const result = await editInExternalEditor(seed, cmd);
      if (result !== undefined) {
        state.editor.setText(result.replaceAll('\r\n', '\n').replace(/\n$/, ''));
      }
    } catch (error) {
      const msg = formatErrorMessage(error);
      this.host.showError(`External editor failed: ${msg}`);
    } finally {
      if (typeof process.stdin.pause === 'function') {
        process.stdin.pause();
      }
      state.ui.start();
      state.ui.setFocus(state.editor);
      state.ui.requestRender(true);
      this.host.setExternalEditorRunning(false);
    }
  }
}
