import * as vscode from "vscode";

import { Events } from "../shared/bridge";
import { PythinkerWebviewProvider } from "./PythinkerWebviewProvider";
import { onSettingsChange, VSCodeSettings } from "./config/vscode-settings";
import { defaultPermissionMode } from "./runtime/permission-mode";
import { updateLoginContext } from "./utils/context";

let outputChannel: vscode.OutputChannel | undefined;
let provider: PythinkerWebviewProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("Pythinker Code");
  const remoteInfo = vscode.env.remoteName ? ` (remote: ${vscode.env.remoteName})` : "";
  log(`Pythinker Code ${VSCodeSettings.getExtensionConfig().version} activating${remoteInfo}`);

  provider = new PythinkerWebviewProvider(
    context.extensionUri,
    context,
    () => outputChannel?.show(),
    (message) => log(message),
  );
  context.subscriptions.push(provider, outputChannel);

  try {
    await updateLoginContext(provider.harness);
  } catch (error) {
    logError("Unable to determine login status", error);
  }

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("pythinker-baseline", {
      provideTextDocumentContent: async (uri) => {
        const sessionId = new URLSearchParams(uri.query).get("sessionId");
        if (!sessionId || !provider) return "";
        const relativePath = decodeURIComponent(uri.path.replace(/^\//, ""));
        try {
          return await provider.getBaselineContent(sessionId, relativePath);
        } catch (error) {
          logError("Unable to open baseline content", error);
          return "";
        }
      },
    }),
   onSettingsChange((changedKeys) => {
      provider?.broadcast(Events.ExtensionConfigChanged, {
        config: VSCodeSettings.getExtensionConfig(),
        changedKeys,
      });
      if (changedKeys.includes("yoloMode")) {
        void provider
          ?.setPermissionModeForActiveSessions(defaultPermissionMode(VSCodeSettings.yoloMode))
          .catch((error) => logError("Unable to update session permission", error));
      }
    }), vscode.window.registerWebviewViewProvider("pythinker.webview", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }));

  const commands: Record<string, () => void | Promise<void>> = {
    "pythinker.clearAllState": async () => {
      await context.globalState.update("pythinker.config", undefined);
      await context.globalState.update("pythinker.mcpServers", undefined);
      await context.workspaceState.update("pythinker.mcpEnabled", undefined);
      await vscode.window.showInformationMessage("Pythinker: Extension UI state cleared.");
    },
    "pythinker.openInTab": () => {
      provider?.createPanel();
    },
    "pythinker.openInSideBar": async () => {
      await vscode.commands.executeCommand("pythinker.webview.focus");
    },
    "pythinker.focusInput": async () => {
      await vscode.commands.executeCommand("pythinker.webview.focus");
      provider?.broadcast(Events.FocusInput, {});
    },
    "pythinker.insertMention": async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        await vscode.window.showWarningMessage("No active editor");
        return;
      }
      await vscode.commands.executeCommand("pythinker.webview.focus");
      if (!(await provider?.insertEditorMention(editor.document.uri, editor.selection))) {
        await vscode.window.showWarningMessage("The active file is outside the selected working directory.");
      }
    },
    "pythinker.newConversation": async () => {
      await vscode.commands.executeCommand("pythinker.webview.focus");
      provider?.broadcast(Events.NewConversation, {});
    },
    "pythinker.showLogs": () => outputChannel?.show(),
    "pythinker.resetPythinker": () => provider?.resetAllWebviews(),
    "pythinker.logout": async () => {
      await vscode.commands.executeCommand("pythinker.webview.focus");
      await vscode.window.showInformationMessage("Use the logout button in Pythinker settings.");
    },
  };

  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  log("Pythinker Code activated");
}

export async function deactivate(): Promise<void> {
  log("Pythinker Code deactivating");
  await provider?.shutdown();
  provider = undefined;
}

function log(message: string): void {
  outputChannel?.appendLine(`[${new Date().toISOString()}] ${message}`);
}

function logError(message: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  log(`${message}: ${detail}`);
}

export { log };
