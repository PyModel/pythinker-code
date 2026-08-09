import * as vscode from "vscode";

/**
 * Editor and terminal entry points that push context into the chat input.
 * All inserts go through the existing insertMention flow — no new webview
 * protocol.
 */
export interface ChatContextDeps {
  /** Insert an @file mention into the open webviews; false when no webview can mention the file. */
  insertMention(documentUri: vscode.Uri, selection: vscode.Selection): Promise<boolean>;
  /** Append plain text to the chat input of the open webviews. */
  insertText(text: string): void;
  logError(message: string, error: unknown): void;
}

const OUTSIDE_WORKDIR_WARNING = "The active file is outside the selected working directory.";

class PythinkerCodeActionProvider implements vscode.CodeActionProvider {
  // Built at registration time: the VSIX audit imports this bundle with an
  // empty `vscode` stub, so module-load code must not touch vscode members.
  static metadata(): vscode.CodeActionProviderMetadata {
    return { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };
  }

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const editor = vscode.window.activeTextEditor;
    const selection =
      editor?.document === document && !editor.selection.isEmpty ? editor.selection : undefined;
    const diagnosticRange = context.diagnostics.reduce<vscode.Range | undefined>(
      (union, diagnostic) => (union ? union.union(diagnostic.range) : diagnostic.range),
      undefined,
    );
    const target = selection ?? diagnosticRange;
    if (!target) return [];

    const addAction = new vscode.CodeAction("Add to Pythinker", vscode.CodeActionKind.QuickFix);
    addAction.command = {
      command: "pythinker.addToChat",
      title: "Add to Pythinker",
      arguments: [document.uri, target],
    };
    const actions = [addAction];

    if (diagnosticRange) {
      const fixAction = new vscode.CodeAction("Fix with Pythinker", vscode.CodeActionKind.QuickFix);
      fixAction.command = {
        command: "pythinker.fixWithPythinker",
        title: "Fix with Pythinker",
        arguments: [document.uri, diagnosticRange, [...context.diagnostics]],
      };
      actions.push(fixAction);
    }
    return actions;
  }
}

export function registerChatContext(deps: ChatContextDeps): vscode.Disposable[] {
  const insertMention = async (uri: vscode.Uri, range: vscode.Range): Promise<void> => {
    await vscode.commands.executeCommand("pythinker.webview.focus");
    if (!(await deps.insertMention(uri, new vscode.Selection(range.start, range.end)))) {
      await vscode.window.showWarningMessage(OUTSIDE_WORKDIR_WARNING);
    }
  };

  return [
    vscode.languages.registerCodeActionsProvider(
      "*",
      new PythinkerCodeActionProvider(),
      PythinkerCodeActionProvider.metadata(),
    ),

    vscode.commands.registerCommand(
      "pythinker.addToChat",
      (uri: vscode.Uri, range: vscode.Range) => insertMention(uri, range),
    ),

    vscode.commands.registerCommand(
      "pythinker.fixWithPythinker",
      async (uri: vscode.Uri, range: vscode.Range, diagnostics: vscode.Diagnostic[]) => {
        const problems = diagnostics.map((diagnostic) => diagnostic.message.trim()).join("; ");
        await vscode.commands.executeCommand("pythinker.webview.focus");
        deps.insertText(`Fix these problems: ${problems}`);
        await insertMention(uri, range);
      },
    ),

    vscode.commands.registerCommand("pythinker.addTerminalSelection", async () => {
      // Clipboard round-trip: workbench.action.terminal.copySelection is the
      // only way to read the terminal selection, so save and restore the
      // user's clipboard around it. A sentinel distinguishes "no selection"
      // (copySelection is a no-op) from a selection that happens to equal the
      // old clipboard content.
      const previousClipboard = await vscode.env.clipboard.readText();
      const sentinel = `__pythinker_no_selection_${Date.now()}__`;
      let selection = "";
      try {
        await vscode.env.clipboard.writeText(sentinel);
        await vscode.commands.executeCommand("workbench.action.terminal.copySelection");
        selection = (await vscode.env.clipboard.readText()).trim();
      } catch (error) {
        deps.logError("Unable to read the terminal selection", error);
      } finally {
        await vscode.env.clipboard.writeText(previousClipboard);
      }
      if (!selection || selection === sentinel) return;
      await vscode.commands.executeCommand("pythinker.webview.focus");
      deps.insertText(`Terminal output:\n\`\`\`\n${selection}\n\`\`\``);
    }),
  ];
}
