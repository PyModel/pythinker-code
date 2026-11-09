import * as vscode from "vscode";
import type { PythinkerHarness } from "@pymodel/pythinker-code-sdk";

export async function updateLoginContext(harness: PythinkerHarness): Promise<boolean> {
  const loggedIn = (await harness.isAuthenticated()) || (await hasOAuthProviderToken(harness));
  await vscode.commands.executeCommand("setContext", "pythinker.isLoggedIn", loggedIn);
  return loggedIn;
}

async function hasOAuthProviderToken(harness: PythinkerHarness): Promise<boolean> {
  const config = await harness.getConfig();
  for (const provider of Object.values(config.providers ?? {})) {
    if (provider.oauth === undefined) continue;
    if ((await harness.auth.getCachedAccessToken(provider.oauth)) !== undefined) return true;
  }
  return false;
}
