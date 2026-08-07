import { runLogin } from "@pythoughts/pythinker-code-sdk";
import * as vscode from "vscode";

import { Methods } from "../../shared/bridge";
import type { LoginResult } from "../../shared/legacy-sdk";
import type { LoginStatus } from "../../shared/types";
import { createVscodeLoginUi } from "../auth/vscode-login-ui";
import { updateLoginContext } from "../utils/context";
import type { Handler, HandlerContext } from "./types";

/**
 * The login in flight, if any. Login owns modal UI — a second concurrent flow
 * would open a competing set of quick picks and race to write credentials — so
 * a repeated request joins the running one instead of starting a rival.
 */
let loginInFlight: Promise<LoginResult> | undefined;

async function runLoginOnce(ctx: HandlerContext): Promise<LoginResult> {
  // Owned here rather than inside the UI: the token has to exist before
  // `runLogin` starts, and cancelling has to reach whichever prompt is open,
  // not only the step that happens to hold a spinner.
  const cancellation = new vscode.CancellationTokenSource();
  const ui = createVscodeLoginUi(ctx, cancellation.token);
  try {
    // One login-wide progress notification, cancellable: the OAuth flows wait
    // minutes on a browser round trip with no per-step spinner of their own,
    // so this is the only surface that can offer a way out of them.
    const success = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Signing in to Pythinker",
        cancellable: true,
      },
      async (_progress, token) => {
        token.onCancellationRequested(() => {
          ui.cancelInFlight?.();
          cancellation.cancel();
        });
        // `runLogin` resolves true only when credentials were written; a false
        // result is a user cancellation or a failure the flow already reported.
        return runLogin(ui);
      },
    );
    // Credentials are already on disk at this point, so a status refresh that
    // fails is a stale badge, not a failed login — reporting it as one would
    // send the webview back to the sign-in screen the user just completed.
    await updateLoginContext(ctx.harness).catch((statusError: unknown) => {
      ctx.logError("Unable to refresh login status after a successful login", statusError);
    });
    return { success };
  } catch (error) {
    ctx.logError("Pythinker login failed", error);
    await updateLoginContext(ctx.harness).catch((statusError: unknown) => {
      ctx.logError("Unable to refresh login status after a failed login", statusError);
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    cancellation.dispose();
  }
}

export const authHandlers: Record<string, Handler<any, any>> = {
  [Methods.CheckLoginStatus]: async (_, ctx): Promise<LoginStatus> => {
    return { loggedIn: await updateLoginContext(ctx.harness) };
  },

  [Methods.Login]: async (_, ctx): Promise<LoginResult> => {
    if (loginInFlight !== undefined) return loginInFlight;
    const pending = runLoginOnce(ctx);
    loginInFlight = pending;
    void pending.finally(() => {
      // Identity-checked so a slow flow that lost the slot cannot clear a newer
      // one and strand every later login on a cached result.
      if (loginInFlight === pending) loginInFlight = undefined;
    });
    return pending;
  },

  [Methods.Logout]: async (_, ctx): Promise<LoginResult> => {
    try {
      const config = await ctx.harness.getConfig({ reload: true });
      for (const providerId of Object.keys(config.providers ?? {})) {
        await ctx.harness.removeProvider(providerId);
      }
      await updateLoginContext(ctx.harness);
      return { success: true };
    } catch (error) {
      ctx.logError("Pythinker logout failed", error);
      await updateLoginContext(ctx.harness).catch((statusError: unknown) => {
        ctx.logError("Unable to refresh login status after a failed logout", statusError);
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
