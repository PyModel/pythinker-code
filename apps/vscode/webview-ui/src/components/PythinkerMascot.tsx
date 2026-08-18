import { useState, useEffect } from "react";
import { useExtensionImageUrl } from "./hooks/useExtensionImageUrl";

export function PythinkerMascot({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const checkTheme = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };

    const observer = new MutationObserver(checkTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  const imageName = isDark ? "pythinker-banner-dark.svg" : "pythinker-banner-light.svg";
  const logoUrl = useExtensionImageUrl(imageName);

  if (!logoUrl) {
    return null;
  }

  return <img src={logoUrl} alt="PYTHINKER" className={className} aria-label="PYTHINKER" />;
}
