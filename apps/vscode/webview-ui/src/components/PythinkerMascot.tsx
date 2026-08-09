import { cn } from "@/lib/utils";
import { useExtensionImageUrl } from "./hooks/useExtensionImageUrl";
import { useIsDark } from "@/hooks/useIsDark";

export function PythinkerMascot({ className }: { className?: string }) {
  const isDark = useIsDark();

  const imageName = isDark ? "pythinker_banner_dark.svg" : "pythinker_banner_light.svg";
  const logoUrl = useExtensionImageUrl(imageName);

  if (!logoUrl) {
    return null;
  }

  return <img src={logoUrl} alt="Pythinker" className={cn("object-contain", className)} aria-label="Pythinker" />;
}
