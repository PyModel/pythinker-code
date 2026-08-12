# Custom Themes

Pythinker Code CLI can use a built-in color scheme or a custom JSON theme file. Custom files live in the themes directory and appear in `/theme` alongside the built-in choices.

## Built-in color tokens

Custom themes can override the tokens below. The `dark` and `light` columns show the built-in values; `auto` resolves to one of those palettes at startup, and falls back to `dark` when terminal background detection is unavailable.

Active `/model` provider and `AskUserQuestion` tabs use `selectionBg` for the background and `inverseText` for the foreground. Keep this pair at 4.5:1 contrast or higher. The runtime validates six-digit hex syntax for each color, but it does not enforce or repair color contrast.

| Token | `dark` | `light` | What it controls |
| --- | --- | --- | --- |
| `primary` | `#BBC6FF` | `#4A5BC4` | Dominant interactive/brand colour: links & inline code, the selected item in nearly every dialog, the focused editor border, plan/"running" badges, spinners. The most widely used token. |
| `accent` | `#7B8CE8` | `#5566CC` | Secondary highlight: approval "▶" prefix, device-code box, image placeholder, BTW / queue panes, custom-registry import. |
| `primaryShimmer` | `#F4F5FF` | `#263BA8` | Brighter primary pulse for future spinner and running-state animations. |
| `accentShimmer` | `#AAB7FF` | `#3F4DB5` | Brighter accent pulse for future device-code and queue-pane animations. |
| `warningShimmer` | `#FFD474` | `#6F4700` | Brighter warning pulse for future stale-state and attention animations. |
| `borderShimmer` | `#848CA8` | `#4F567A` | Brighter border pulse for future focused-panel border animations. |
| `textDimShimmer` | `#B6B9C7` | `#222A4A` | Brighter dim-text pulse for future thinking and status animations. |
| `text` | `#E0E0E0` | `#1A1A1A` | Default body text: dialog bodies, todo titles, footer model label, markdown headings, tool/read output, and assistant-side message bullets (assistant / tool / agent / read) plus markdown list bullets. |
| `textStrong` | `#F5F5F5` | `#1A1A1A` | Emphasised text: input dialogs, status messages, high-signal tool names, user transcript text. |
| `textDim` | `#888888` | `#454545` | Secondary, dimmed text (the most widely used dim shade): thinking blocks, hints, descriptions, completed todos, markdown quotes, and the footer status bar (cwd path, git badge). |
| `textMuted` | `#6B6B6B` | `#5F5F5F` | Faintest text: counters, scroll info, descriptions, markdown link URLs, code-block borders. |
| `border` | `#5A5A5A` | `#737373` | Borders: pane & editor borders, markdown horizontal rule. |
| `borderFocus` | `#E8A838` | `#92660A` | Focus / attention border — currently only the approval panel. |
| `success` | `#4EC87E` | `#0E7A38` | Success: ✓ marks, "enabled", completed states. |
| `warning` | `#E8A838` | `#92660A` | Warning: auto/yolo badges, stale markers, plan-mode hint. |
| `error` | `#E85454` | `#B91C1C` | Error: error messages, failed tool output. |
| `effortLow` | `#8A8A8A` | `#8A8A8A` | Low thinking effort; colors the editor effort dot. |
| `effortMedium` | `#6FA8DC` | `#2E6FB8` | Medium thinking effort; colors the editor effort dot. |
| `effortHigh` | `#D33682` | `#A81D6E` | High thinking effort; colors the editor effort dot. |
| `effortXHigh` | `#C0392B` | `#8B1A1A` | Extra-high thinking effort; colors the editor effort dot. |
| `effortMax` | `#F2C744` | `#B8860B` | Maximum thinking effort; colors the editor effort dot. |
| `diffAdded` | `#4EC87E` | `#0E7A38` | Added lines. |
| `diffRemoved` | `#E85454` | `#B91C1C` | Removed lines. |
| `diffAddedStrong` | `#7AD99B` | `#0E7A38` | Added lines — intra-line changed words (bold). |
| `diffRemovedStrong` | `#F08585` | `#B91C1C` | Removed lines — intra-line changed words (bold). |
| `diffGutter` | `#6B6B6B` | `#737373` | Line-number gutter (also approval panel/preview). |
| `diffMeta` | `#888888` | `#5F5F5F` | Meta / hunk headers. |
| `diffAddedDimmed` | `#57966F` | `#316A48` | De-emphasised added context lines in future expanded diff hunks. |
| `diffRemovedDimmed` | `#B55E68` | `#8D4852` | De-emphasised removed context lines in future expanded diff hunks. |
| `roleUser` | `#FFCB6B` | `#9A4A00` | User-accent hue for skill-activation names and future user-specific accents. Assistant/thinking/status bullets reuse text/textDim. |
| `workflowTitle` | `#EE9983` | `#9C261C` | Coral title used by the Dynamic Workflow mission-control frame. |
| `agentRed` | `#E2697D` | `#9D2539` | Red identity used by the first future agent in Dynamic Workflow progress and grouped output. |
| `agentOrange` | `#E2B069` | `#9D6B25` | Orange identity used by the second future agent in Dynamic Workflow progress and grouped output. |
| `agentYellow` | `#BAE269` | `#759D25` | Yellow identity used by the third future agent in Dynamic Workflow progress and grouped output. |
| `agentGreen` | `#69E273` | `#259D2F` | Green identity used by the fourth future agent in Dynamic Workflow progress and grouped output. |
| `agentCyan` | `#69E2CE` | `#259D89` | Cyan identity used by the fifth future agent in Dynamic Workflow progress and grouped output. |
| `agentBlue` | `#699CE2` | `#25579D` | Blue identity used by the sixth future agent in Dynamic Workflow progress and grouped output. |
| `agentPurple` | `#9269E2` | `#4D259D` | Purple identity used by the seventh future agent in Dynamic Workflow progress and grouped output. |
| `agentPink` | `#E269D8` | `#9D2593` | Pink identity used by the eighth future agent in Dynamic Workflow progress and grouped output. |
| `rainbowRed` | `#E96E63` | `#9C261C` | Red spectrum stop for future keyword and gradient highlighting. |
| `rainbowOrange` | `#E9B163` | `#9C671C` | Orange spectrum stop for future keyword and gradient highlighting. |
| `rainbowYellow` | `#DEE963` | `#919C1C` | Yellow spectrum stop for future keyword and gradient highlighting. |
| `rainbowGreen` | `#63E96E` | `#1C9C26` | Green spectrum stop for future keyword and gradient highlighting. |
| `rainbowBlue` | `#639BE9` | `#1C519C` | Blue spectrum stop for future keyword and gradient highlighting. |
| `rainbowIndigo` | `#6E63E9` | `#261C9C` | Indigo spectrum stop for future keyword and gradient highlighting. |
| `rainbowViolet` | `#C763E9` | `#7C1C9C` | Violet spectrum stop for future keyword and gradient highlighting. |
| `modeAutoAccept` | `#66D49A` | `#26704C` | Auto-accept badge colour for the future mode-specific status treatment. |
| `modePlan` | `#A9B8FF` | `#4A5BC4` | Plan badge colour for the future mode-specific status treatment. |
| `modePermission` | `#D99AF0` | `#7A3C96` | Permission badge colour for the future mode-specific status treatment. |
| `modeFast` | `#FFB45E` | `#9A570F` | Fast badge colour for the future mode-specific status treatment. |
| `background` | `#000000` | `#FFFFFF` | Assumed terminal background against which future themed surfaces are tuned. |
| `inverseText` | `#FFFFFF` | `#0B1020` | Foreground for active `/model` provider and `AskUserQuestion` tabs; pair with `selectionBg` at 4.5:1 contrast or higher. |
| `selectionBg` | `#344274` | `#C9D1FA` | Background for active `/model` provider and `AskUserQuestion` tabs; pair with `inverseText` at 4.5:1 contrast or higher. |
| `surfaceHighlight` | `#1C2238` | `#E8EBFC` | Subtle fill for highlighted rows and message surfaces, including user transcript rows. |
| `toolPendingBg` | `#1D2129` | `#E8EEF7` | Background tint for a tool card while the call is running. |
| `toolSuccessBg` | `#14171B` | `#F1F3F5` | Background tint for a tool card after a successful result. |
| `toolErrorBg` | `#291D1D` | `#F9E9E9` | Background tint for a tool card after an error result. |
| `progressFill` | `#25764A` | `#3B9A65` | Filled segment of the Dynamic Workflow aggregate progress line. |
| `progressHead` | `#4EC87E` | `#0E7A38` | Static head of the Dynamic Workflow aggregate progress track. |
| `progressEmpty` | `#D9DEE8` | `#6B7280` | Empty segment of the Dynamic Workflow aggregate progress line. |

## Use the custom-theme skill

You do not need to write the JSON by hand. Run the built-in `/custom-theme [extra text]` skill command to enter the custom-theme workflow; the skill can choose colors, write the file under `~/.pythinker-code/themes/`, validate the hex values, and tell you how to apply it.

Example invocations:

- `/custom-theme Create a warm dark theme with amber accents.`
- `/custom-theme Make a light theme based on Solarized, but keep errors easy to see.`
- `/custom-theme Tweak my ember theme so diffs have higher contrast.`

After activation, the skill usually asks whether you want a light or dark base, what mood or palette you prefer, and whether you have exact colors to include. If you use it to edit an existing theme, make sure it reads and backs up the file before overwriting it.

## Create a theme

Add a `.json` file to the themes directory:

- `~/.pythinker-code/themes/`
- or `$PYTHINKER_CODE_HOME/themes/` when the `PYTHINKER_CODE_HOME` environment variable is set

Create the directory if it does not exist. **The filename is the theme name**: `ember.json` appears in `/theme` as `Custom: ember`.

A minimal theme only sets the colors you want to change; the rest fall back to the **base palette** (`dark` by default):

```json
{
  "name": "ember",
  "colors": {
    "primary": "#83A598",
    "accent": "#FE8019"
  }
}
```

Fields:

- `name` (required): the theme identifier.
- `displayName` (optional): a human-readable name.
- `base` (optional): the built-in palette that unspecified tokens inherit — `"dark"` (default) or `"light"`. Set `"base": "light"` when you are building a **light** theme so the tokens you leave out stay readable on a light background (otherwise they fall back to the dark palette).
- `colors` (optional): the color tokens to override, each a 6-digit hex value (e.g. `#FE8019`).

Use the token names from [Built-in color tokens](#built-in-color-tokens). Any token you omit falls back to the selected base palette, so partial themes are fine:

```json
{
  "name": "just-blue",
  "colors": {
    "primary": "#3B82F6",
    "roleUser": "#3B82F6"
  }
}
```

## Select a theme

Two ways:

1. **The `/theme` command** (recommended): opens the theme picker, where custom themes appear as `Custom: <filename>`. The picker **re-scans the themes directory every time it opens**, so a theme file you just added shows up **without a restart**.
2. **`tui.toml`**: set `theme` to your theme name:

   ```toml
   # ~/.pythinker-code/tui.toml
   theme = "ember"
   ```

## What happens on errors

Custom themes are designed to never get in your way:

- **An invalid color value** (not `#` followed by 6 hex digits): that one entry is silently skipped and falls back to the selected base palette; the rest of the colors still apply.
- **An unrecognized token**: ignored, with no effect on other colors.
- **A missing custom theme file or malformed JSON**: silently falls back to the built-in `dark` palette. It does not retry `auto`.

## Editing the active theme

If you edit the theme file that is **currently active**, the change is not reloaded automatically. To apply the new colors:

- run `/reload-tui` — it reloads `tui.toml` and re-applies the current theme (including re-reading the theme file); or
- switch to another theme in `/theme` and back.

::: warning Note
Re-selecting the **same** theme in `/theme` does not reload it (you get a "Theme unchanged" message). To reload changes to the active theme, use one of the two methods above.
:::
