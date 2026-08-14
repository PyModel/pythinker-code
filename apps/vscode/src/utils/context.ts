import * as vscode from "vscode";
import type { PythinkerHarness } from "@pymodel/pythinker-code-sdk";

export async function updateLoginContext(harness: PythinkerHarness): Promise<boolean> {
  const loggedIn = await harness.isAuthenticated();
  await vscode.commands.executeCommand("setContext", "pythinker.isLoggedIn", loggedIn);
  return loggedIn;
}
