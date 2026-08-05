import { useState, useEffect } from "react";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function BrailleSpinner({ className }: { className?: string }) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % BRAILLE_FRAMES.length);
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return (
    <span className={className} aria-hidden="true">
      {BRAILLE_FRAMES[frameIndex]}
    </span>
  );
}
