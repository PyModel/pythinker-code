import { describe, expect, it } from "vitest";

import {
  NO_MATCH,
  rankSlashCommands,
  scoreCommand,
} from "../webview-ui/src/components/inputarea/hooks/slash-command-match";

function command(name: string, description = ""): { name: string; description: string; aliases: string[] } {
  return { name, description, aliases: [] };
}

const RESEARCH_SKILL = command("skill:research-writing", "Write research reports.");
const CUSTOM_THEME = command(
  "custom-theme",
  // Its letters spell "research" in order, which is exactly what the old
  // subsequence match over descriptions matched on.
  "Create or edit a pythinker-code custom color theme — a JSON file of color tokens, then reload the chat.",
);

function rank(commands: readonly ReturnType<typeof command>[], query: string): string[] {
  return rankSlashCommands(commands, query).map((entry) => entry.name);
}

describe("scoreCommand", () => {
  it("does not match a command whose description merely contains the query's letters", () => {
    // The old subsequence match over descriptions let "research" through on
    // "Create or edit ...", which made the menu look unfiltered.
    expect(scoreCommand(CUSTOM_THEME, "research")).toBe(NO_MATCH);
  });

  it("finds a namespaced skill by the part the user actually types", () => {
    expect(rank([CUSTOM_THEME, RESEARCH_SKILL], "research")).toEqual(["skill:research-writing"]);
  });

  it("ranks a name prefix above a name that only contains the query", () => {
    expect(rank([command("sub-skill"), command("skills")], "skill")).toEqual(["skills", "sub-skill"]);
  });

  it("stays forgiving about dropped separators and skipped letters", () => {
    expect(Number.isFinite(scoreCommand(RESEARCH_SKILL, "researchwriting"))).toBe(true);
    expect(Number.isFinite(scoreCommand(RESEARCH_SKILL, "reswrit"))).toBe(true);
  });

  it("still falls back to the description when nothing matches the name", () => {
    expect(Number.isFinite(scoreCommand(CUSTOM_THEME, "color"))).toBe(true);
  });

  it("ranks every name match above a description match", () => {
    expect(rank([CUSTOM_THEME, command("theme-picker", "Nothing to see.")], "theme")).toEqual([
      "theme-picker",
      "custom-theme",
    ]);
  });
});
