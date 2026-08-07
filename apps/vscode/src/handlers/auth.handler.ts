import { runLogin } from "@pythoughts/pythinker-code-sdk";

import { Methods } from "../../shared/bridge";
import type { LoginResult } from "../../shared/legacy-sdk";
import type { LoginStatus } from "../../shared/types";
import { createVscodeLoginUi } from "../auth/vscode-login-ui";
import { updateLoginContext } from "../utils/context";
import type { Handler } from "./types";

export const authHandlers: Record<string, Handler<any, any>> = {
  [Methods.CheckLoginStatus]: async (_, ctx): Promise<LoginStatus> => {
    return { loggedIn: await updateLoginContext(ctx.harness) };
  },

  [Methods.Login]: async (_, ctx): Promise<LoginResult> => {
    try {
      // `runLogin` resolves true only when credentials were written; a false
      // result is a user cancellation or a failure the flow already reported.
      const success = await runLogin(createVscodeLoginUi(ctx));
      await updateLoginContext(ctx.harness);
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
    }
  },

  [Methods.Logout]: async (_, ctx): Promise<LoginResult> => {
    try {
      await ctx.harness.auth.logout();
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
