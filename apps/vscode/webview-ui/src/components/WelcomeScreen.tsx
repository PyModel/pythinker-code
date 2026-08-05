import { PythinkerMascot } from "./PythinkerMascot";
import { useWelcomeHint } from "@/hooks/useWelcomeHint";

export function WelcomeScreen() {
  const hint = useWelcomeHint();

  return (
    <div className="flex flex-col items-center gap-3 px-4">
      <PythinkerMascot className="h-24 w-auto max-w-[280px]" />
      {hint.component ? (
        hint.component
      ) : (
        <div className="text-center space-y-0.5">
          <p className="text-xs font-medium text-foreground">{hint.title}</p>
          <p className="text-xs text-muted-foreground">{hint.description}</p>
        </div>
      )}
    </div>
  );
}
