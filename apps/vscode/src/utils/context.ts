import * as vscode from "vscode";
import type { PythinkerHarness } from "@pymodel/pythinker-code-sdk";

export async function updateLoginContext(harness: PythinkerHarness): Promise<boolean> {
  const loggedIn = (await harness.isAuthenticated()) || (await hasOAuthProviderToken(harness));
  await vscode.commands.executeCommand("setContext", "pythinker.isLoggedIn", loggedIn);
  return loggedIn;
}

async function hasOAuthProviderToken(harness: PythinkerHarness): Promise<boolean> {
  const config = await harness.getConfig();
  for (const [name, provider] of Object.entries(config.providers ?? {})) {
    if (provider.oauth === undefined) continue;
    const status = await harness.auth.status(name);
    if (status.providers.some((p) => p.hasToken)) return true;
  }
  return false;
}
