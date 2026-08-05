import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "@/stores";
import type { SlashCommandInfo } from "shared/legacy-sdk";
import { rankSlashCommands } from "./slash-command-match";

interface ActiveToken {
  trigger: "/" | "@";
  start: number;
  query: string;
}

export function findActiveToken(text: string, cursorPos: number): ActiveToken | null {
  const beforeCursor = text.slice(0, cursorPos);
  const lastSpace = Math.max(beforeCursor.lastIndexOf(" "), beforeCursor.lastIndexOf("\n"), beforeCursor.lastIndexOf("\t"), -1);
  const currentWord = beforeCursor.slice(lastSpace + 1);

  if (currentWord.startsWith("@")) {
    return { trigger: "@", start: lastSpace + 1, query: currentWord.slice(1) };
  }
  if (currentWord.startsWith("/")) {
    return { trigger: "/", start: lastSpace + 1, query: currentWord.slice(1) };
  }
  return null;
}

interface UseSlashMenuResult {
  showSlashMenu: boolean;
  filteredCommands: SlashCommandInfo[];
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  handleSlashMenuKey: (e: React.KeyboardEvent) => boolean;
  resetSlashMenu: () => void;
}

export function useSlashMenu(activeToken: ActiveToken | null, onSelectCommand: (name: string) => void, onCancel: () => void): UseSlashMenuResult {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { slashCommands } = useSettingsStore();

  const showSlashMenu = activeToken?.trigger === "/";

  const filteredCommands = useMemo(() => {
    if (!showSlashMenu) {
      return [];
    }
    return rankSlashCommands(slashCommands, activeToken.query);
  }, [showSlashMenu, activeToken?.query, slashCommands]);

  const resetSlashMenu = useCallback(() => {
    setSelectedIndex(0);
  }, []);

  // Every keystroke reorders the list, so a selection carried over from the
  // previous query points at an unrelated command — or past the end of the list.
  const query = showSlashMenu ? activeToken.query : "";
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSlashMenuKey = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!showSlashMenu || filteredCommands.length === 0) {
        return false;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
          return true;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return true;
        case "Tab":
        case "Enter": {
          e.preventDefault();
          const cmd = filteredCommands[selectedIndex];
          if (cmd) {
            onSelectCommand(cmd.name);
          }
          return true;
        }
        case "Escape":
          e.preventDefault();
          onCancel();
          return true;
        default:
          return false;
      }
    },
    [showSlashMenu, filteredCommands, selectedIndex, onSelectCommand, onCancel],
  );

  return {
    showSlashMenu,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    handleSlashMenuKey,
    resetSlashMenu,
  };
}
