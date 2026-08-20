---
name: custom-theme
description: Create or edit a pythinker-code custom color theme — a JSON file under the resolved PYTHINKER_CODE_HOME data directory that recolors the TUI. Use when the user wants their own theme, asks for a specific palette or mood, or wants to tweak an existing custom theme's colors.
---

# Create a pythinker-code custom theme (custom-theme)

Help the user design, write, and apply a custom color theme for the pythinker-code TUI. A theme is a single JSON file; the TUI ships with `dark`, `light`, and `auto`, and any file the user adds becomes selectable alongside them.

## Rules of engagement

- **Never write a theme until the user has explicitly clarified what they want.** This skill may only run after the user has confirmed light vs dark, the style or mood, any specific colors they care about, and the intended filename. If any of these are missing, ask before creating files.
- **Never assume the data directory is `~/.pythinker-code`.** Always resolve `$PYTHINKER_CODE_HOME` first with the Bash command below.
- **Never edit a live theme file in place.** Always create a `.json.new` candidate, validate it, back up the old file, and then `mv` it into place.
- **Never overwrite an existing theme without reading it first.** Read, back up, then overwrite only after the user confirms.

## Where a theme lives

The pythinker-code runtime resolves the data directory as `PYTHINKER_CODE_HOME` first, falling back to `~/.pythinker-code`. Theme files live inside the `themes/` subdirectory of that data directory.

Before doing anything, resolve the actual data root with Bash so you don't write to the wrong place. Check whether `PYTHINKER_CODE_HOME` is set and fall back to `~/.pythinker-code` when it is empty:

```bash
echo "$PYTHINKER_CODE_HOME"
echo "$HOME/.pythinker-code"
```

Use the first line when it is non-empty; otherwise use the second line. In the rest of this skill, `<PYTHINKER_CODE_HOME>` means that resolved data root — **never assume `~/.pythinker-code`**. Theme files live at `<PYTHINKER_CODE_HOME>/themes/<name>.json`. Create the `themes/` directory if it doesn't exist.

## What a theme is

- A theme lives at `<PYTHINKER_CODE_HOME>/themes/<name>.json`.
- **The filename is the theme name**: `ember.json` shows up in the `/theme` picker as `Custom: ember`.
- Shape:

  ```json
  {
    "name": "ember",
    "displayName": "Ember",
    "colors": {
      "primary": "#83A598",
      "accent": "#FE8019"
    }
  }
  ```

  - `name` (required), `displayName` (optional), `base` (optional: `"dark"` default, or `"light"`), `colors` (each value a 6-digit hex `#RRGGBB`).
- **Partial themes are fine**: any token you leave out falls back to the **base** palette (`dark` by default; set `"base": "light"` for a light theme), so you can recolor just a few tokens or all of them.

## Source of truth: the docs token reference

Before choosing colors, use **FetchURL** to fetch the official custom-theme docs as the authoritative list of tokens and what each controls:

```
https://code.pythinker.com/pythinker-code/en/customization/themes.html
```

Only set tokens from this set — unknown keys are silently ignored at load. If FetchURL is unavailable or the fetch fails, fall back to the embedded reference below (it mirrors the same tokens) and tell the user you're working from the built-in list rather than the live docs.

## Color tokens (what each controls)

| Token | Controls |
| --- | --- |
| `primary` | Dominant interactive and brand color: links, inline code, selections, focus, plan badges, and spinners |
| `accent` | Secondary highlight for approval markers, device-code boxes, image placeholders, and queue panes |
| `primaryShimmer` | Bright primary pulse used by running-state animations |
| `accentShimmer` | Bright accent pulse for attention animations |
| `warningShimmer` | Bright warning pulse for attention animations |
| `borderShimmer` | Bright border pulse for focused-panel animations |
| `textDimShimmer` | Bright dim-text pulse for thinking and status animations |
| `text` | Body text in dialogs, todos, Markdown, tool output, and message bullets |
| `textStrong` | Emphasized text in input dialogs, status messages, and high-signal labels |
| `textDim` | Secondary text for thinking, hints, descriptions, completed todos, and status metadata |
| `textMuted` | Faint text for counters, scroll info, URLs, and code-block borders |
| `border` | Pane, editor, and Markdown horizontal-rule borders |
| `borderFocus` | Focus and attention borders |
| `success` | Success marks and completed states |
| `warning` | Warning badges, stale markers, and Plan mode hints |
| `error` | Error messages and failed tool output |
| `toolPendingBg` | Background tint for a running tool card |
| `toolSuccessBg` | Background tint for a successful tool card |
| `toolErrorBg` | Background tint for a failed tool card |
| `effortLow` | Low thinking effort indicator |
| `effortMedium` | Medium thinking effort indicator |
| `effortHigh` | High thinking effort indicator |
| `effortXHigh` | Extra-high thinking effort indicator |
| `effortMax` | Maximum thinking effort indicator |
| `diffAdded` | Added diff lines |
| `diffRemoved` | Removed diff lines |
| `diffAddedStrong` | Added intra-line changed words |
| `diffRemovedStrong` | Removed intra-line changed words |
| `diffGutter` | Diff line-number gutter |
| `diffMeta` | Diff meta and hunk headers |
| `diffAddedDimmed` | De-emphasized added diff context |
| `diffRemovedDimmed` | De-emphasized removed diff context |
| `roleUser` | User message accent and skill-activation name |
| `shellMode` | Shell mode (`!`) prompt, editor border, and echoed `$ command` line |
| `workflowTitle` | Dynamic Workflow mission-control title |
| `agentRed` | First agent identity color |
| `agentOrange` | Second agent identity color |
| `agentYellow` | Third agent identity color |
| `agentGreen` | Fourth agent identity color |
| `agentCyan` | Fifth agent identity color |
| `agentBlue` | Sixth agent identity color |
| `agentPurple` | Seventh agent identity color |
| `agentPink` | Eighth agent identity color |
| `rainbowRed` | Red spectrum stop for future highlighting |
| `rainbowOrange` | Orange spectrum stop for future highlighting |
| `rainbowYellow` | Yellow spectrum stop for future highlighting |
| `rainbowGreen` | Green spectrum stop for future highlighting |
| `rainbowBlue` | Blue spectrum stop for future highlighting |
| `rainbowIndigo` | Indigo spectrum stop for future highlighting |
| `rainbowViolet` | Violet spectrum stop for future highlighting |
| `modeAutoAccept` | Auto-accept mode badge |
| `modePlan` | Plan mode badge |
| `modePermission` | Permission mode badge |
| `modeFast` | Fast mode badge |
| `background` | Assumed terminal background for themed surfaces |
| `inverseText` | Foreground for active tabs; keep contrast with `selectionBg` at 4.5:1 or higher |
| `selectionBg` | Background for active tabs; keep contrast with `inverseText` at 4.5:1 or higher |
| `surfaceHighlight` | Subtle fill for highlighted rows and message surfaces |
| `progressFill` | Filled Dynamic Workflow progress segment |
| `progressHead` | Dynamic Workflow progress head |
| `progressEmpty` | Empty Dynamic Workflow progress segment |

## Workflow

1. **Ask the user what they want first — before choosing any colors.** Clarify, in one short exchange:
   - **Light or dark?** A light theme (dark text on a light background) or a dark theme (light text on a dark background). This sets the whole direction, so settle it first. For a light theme, set `"base": "light"` so the tokens you leave out inherit the light palette instead of dark.
   - **What style / mood?** e.g. warm vs cool, vivid vs muted, high vs low contrast, a named vibe ("nord", "solarized", "sunset"), or a base to start from (an existing theme, or `dark` / `light`).
   - **Any specific colors?** Whether they have exact hex values to anchor on (a brand color, a preferred `primary`, etc.).

   For the discrete choices (light vs dark, a few style options), prefer **AskUserQuestion** if it is available. If you are running in **auto mode** and `AskUserQuestion` is unavailable, ask the same question as a plain-text message with clear numbered or bulleted options, and wait for the user's reply. Don't start picking colors until you at least know light-vs-dark and the rough style.

2. **Resolve the actual theme directory and current theme(s).**
   - Resolve the data root by checking `echo "$PYTHINKER_CODE_HOME"`; if empty, use `echo "$HOME/.pythinker-code"`. Use `<root>/themes` for every subsequent step.
   - If tweaking an existing custom theme, **Read** `<PYTHINKER_CODE_HOME>/themes/<name>.json` first — never overwrite a theme you haven't read.
   - Starting fresh: build a `colors` object from the token table. You can `ls <PYTHINKER_CODE_HOME>/themes/` and Read one of the user's existing themes as a reference for the format.

3. **Pick a starting point and choose colors deliberately.**
   - Every value is a 6-digit hex `#RRGGBB` (not 3-digit, not a named color).
   - Keep contrast usable against the user's terminal background: don't let `text` / `textDim` sit too close to the background, and keep `success` / `warning` / `error` clearly distinguishable from each other.
   - `primary` is the most-seen color (links, selection, focus) — make it readable and distinct from `text`.
   - `roleUser` is the one role color meant to stand on its own — give it a distinct hue.

4. **Create a candidate file; never edit the live theme in place.**
   - Use Bash to create a candidate. If the target theme already exists, copy it verbatim: `cp <name>.json <name>.json.new` (inside `<PYTHINKER_CODE_HOME>/themes/`). If it doesn't exist, use **Write** to create a minimal skeleton named `<name>.json.new`.
   - Use **Edit** on the candidate to change only the intended keys. Keep every existing entry, comment, and formatting intact.

5. **Validate the candidate before overwriting.**
   - Read the candidate with **Read** to visually confirm it is well-formed JSON and that every `colors` value is a full 6-digit hex `#RRGGBB` (not 3-digit, not a named color).
   - Invalid hex values are silently skipped at load (they fall back to the base palette), but fix them so the theme renders as intended.

6. **Back up and overwrite.**
   - Back up the old file first — **always** create a new timestamped backup and never overwrite an existing backup: `cp <name>.json "<name>.json.$(date +%Y%m%d-%H%M%S).bak"`.
   - If the target didn't exist, skip the backup.
   - Overwrite with the candidate: `mv <name>.json.new <name>.json`.

7. **Tell the user how to apply it** (next section).

## Applying the theme

- The `/theme` picker re-scans the themes directory every time it opens, so a newly added file shows up **without restarting** — tell the user to run `/theme` and choose `Custom: <name>`.
- Or set it in `tui.toml`: `theme = "<name>"`.
- **Editing the active theme**: changes to the theme that's *currently in use* are not auto-reloaded. Tell the user to run **`/reload-tui`** (or switch to another theme and back). Re-selecting the **same** theme in `/theme` is a no-op ("Theme unchanged").

## Don'ts

- **Don't start creating or editing a theme until the user has clarified light/dark, style/mood, any specific colors, and the filename.** If anything is unclear, ask — don't guess.
- Don't invent token names — only use the documented set; unknown keys are silently ignored.
- Don't write 3-digit hex or named colors — use full `#RRGGBB`.
- Never edit the live theme file in place; work through a candidate and validate before `mv`.
- Before overwriting an existing theme file, **read it and back it up** so the user can recover.
- Don't tell the user to restart the app to apply a theme — `/theme` or `/reload-tui` is enough.
