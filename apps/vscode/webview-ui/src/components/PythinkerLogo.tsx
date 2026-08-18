import { useExtensionImageUrl } from "./hooks/useExtensionImageUrl";

export function PythinkerLogo({ className }: { className?: string }) {
  const logoUrl = useExtensionImageUrl("pythinker-logo.png");

  if (!logoUrl) {
    return null;
  }

  return <img src={logoUrl} alt="PYTHINKER" className={className} aria-label="PYTHINKER" />;
}
