import * as vscode from "vscode";
import type { PythinkerHarness } from "@pymodel/pythinker-code-sdk";

export async function updateLoginContext(harness: PythinkerHarness): Promise<boolean> {
  const status = await harness.auth.status();
  const loggedIn = status.providers.some((provider) => provider.hasToken);
  await vscode.commands.executeCommand("setContext", "pythinker.isLoggedIn", loggedIn);
  return loggedIn;
}
