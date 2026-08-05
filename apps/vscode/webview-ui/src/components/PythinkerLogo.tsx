import { cn } from "@/lib/utils";
import { useExtensionImageUrl } from "./hooks/useExtensionImageUrl";

export function PythinkerLogo({ className }: { className?: string }) {
  const logoUrl = useExtensionImageUrl("icon.ico");

  if (!logoUrl) {
    return null;
  }

  return (
    <img
      src={logoUrl}
      alt="Pythinker"
      className={cn("size-5 shrink-0 object-contain", className)}
      aria-label="Pythinker"
    />
  );
}
