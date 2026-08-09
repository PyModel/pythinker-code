import * as vscode from "vscode";

import { Events } from "../shared/bridge";
import { PythinkerWebviewProvider } from "./PythinkerWebviewProvider";
import { getActivity, onActivityChange, type ActivityStatus } from "./activity";
import { onSettingsChange, VSCodeSettings } from "./config/vscode-settings";
import { performLogout } from "./handlers/auth.handler";
import { clearInputHistory } from "./handlers/workspace.handler";
import { registerChatContext } from "./integrations/chat-context";
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

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.name = "Pythinker Code";
  statusItem.command = "pythinker.webview.focus";
  const renderActivity = (activity: ActivityStatus): void => {
    if (activity.pendingApprovals > 0) {
      statusItem.text = "$(bell) Pythinker: approval needed";
      statusItem.tooltip =
        activity.pendingApprovals === 1
          ? "1 request waits for your decision"
          : `${activity.pendingApprovals} requests wait for your decision`;
      statusItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    } else if (activity.activeStreams > 0) {
      statusItem.text = "$(sync~spin) Pythinker";
      statusItem.tooltip = "Pythinker works on your request";
      statusItem.backgroundColor = undefined;
    } else {
      statusItem.text = "$(sparkle) Pythinker";
      statusItem.tooltip = "Open Pythinker Code";
      statusItem.backgroundColor = undefined;
    }
    statusItem.show();
    provider?.setSidebarBadge(activity.pendingApprovals);
  };
  renderActivity(getActivity());
  context.subscriptions.push(statusItem, { dispose: onActivityChange(renderActivity) });

  const commands: Record<string, () => void | Promise<void>> = {
    "pythinker.clearAllState": async () => {
      await clearInputHistory(context.workspaceState);
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
      if (!provider) return;
      const result = await performLogout(provider.harness, logError);
      if (!result.success) {
        await vscode.window.showErrorMessage(
          `Pythinker: Sign out failed.${result.error ? ` ${result.error}` : ""}`,
        );
        return;
      }
      // No login-state broadcast exists on the bridge; a reload re-runs the
      // webview init, which re-checks the login status and provider list.
      provider.reloadAllWebviews();
    },
  };

  for (const [id, handler] of Object.entries(commands)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  }

  context.subscriptions.push(
    ...registerChatContext({
      insertMention: (uri, selection) =>
        provider?.insertEditorMention(uri, selection) ?? Promise.resolve(false),
      insertText: (text) => provider?.broadcast(Events.InsertMention, { mention: text }),
      logError,
    }),
  );

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
