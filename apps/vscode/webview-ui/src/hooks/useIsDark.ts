import { useSyncExternalStore } from "react";

/*
 * VS Code maintains theme-kind classes on <body> (vscode-light, vscode-dark,
 * vscode-high-contrast, vscode-high-contrast-light); colors come from
 * --vscode-* variables in CSS, so this hook exists only for the few JS
 * consumers that need a binary theme kind (syntax-highlighter style, artwork).
 */
function isDarkTheme(): boolean {
  const cls = document.body.classList;
  if (cls.contains("vscode-high-contrast-light")) return false;
  return cls.contains("vscode-dark") || cls.contains("vscode-high-contrast");
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDarkTheme);
}
