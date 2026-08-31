import { useState } from "react";
import { IconLoader2, IconArrowRight } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { PythinkerMascot } from "./PythinkerMascot";
import { bridge } from "@/services";
import { loginOutcomeState, type LoginState } from "./login-outcome";

interface LoginScreenProps {
  onLoginSuccess: () => void;
  onSkip: () => void;
}

export function LoginScreen({ onLoginSuccess, onSkip }: LoginScreenProps) {
  const [state, setState] = useState<LoginState>("idle");
  const [error, setError] = useState<string | null>(null);


  const handleLogin = async () => {
    setState("pending");
    setError(null);
    try {
      const result = await bridge.login();
      if (result.success) {
        onLoginSuccess();
      } else {
        const outcome = loginOutcomeState(result);
        setState(outcome.state);
        setError(outcome.error);
      }
    } catch (error) {
      setState("error");
      setError(error instanceof Error ? error.message : String(error));
    }
  };


  if (state === "pending") {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          <PythinkerMascot className="h-24 w-auto max-w-[280px] mx-auto" />
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 text-brand">
              <IconLoader2 className="size-5 animate-spin" />
              <span className="text-sm font-medium">Waiting for authentication…</span>
            </div>
            <p className="text-xs leading-5 text-muted-foreground text-left">A browser window should open automatically. Complete the sign-in process there.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          <PythinkerMascot className="h-24 w-auto max-w-[280px] mx-auto" />
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">Welcome to Pythinker Code</h1>
            <div className="text-left space-y-2">
              <p className="text-xs leading-5">Sign in to add a provider, or skip and use your existing API key configuration.</p>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/40 rounded-lg px-3 py-2 text-left">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-5">
            <div className="text-left space-y-1">
              <Button
                onClick={() => {
                  void handleLogin();
                }}
                className="w-full justify-center gap-2"
              >
                Sign in
              </Button>
              <p className="text-[11px] text-muted-foreground leading-4">Pick a provider and paste its API key, or authorize OpenAI Codex.</p>
            </div>

            <div className="text-left space-y-1">
              <Button type="button" variant="outline" onClick={onSkip} className="w-full relative justify-center font-normal">
                <span>Skip</span>
                <IconArrowRight className="size-4 text-muted-foreground absolute right-3" />
              </Button>
              <p className="text-[11px] text-muted-foreground leading-4">Use your existing API key configuration.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
