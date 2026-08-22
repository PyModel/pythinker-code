# Custom Themes

Pythinker Code CLI can use a built-in color scheme or a custom JSON theme file. Custom files live in the themes directory and appear in `/theme` alongside the built-in choices.

## Built-in color tokens

Custom themes can override the tokens below. The `dark` and `light` columns show the built-in values; `auto` resolves to one of those palettes at startup, and falls back to `dark` when terminal background detection is unavailable.

| Token | `dark` | `light` | What it controls |
| --- | --- | --- | --- |
| `primary` | `#BBC6FF` | `#4A5BC4` | Dominant interactive and brand color: links, inline code, selections, focus, plan badges, and spinners |
| `accent` | `#7B8CE8` | `#5566CC` | Secondary highlight for approval markers, device-code boxes, image placeholders, and queue panes |
| `primaryShimmer` | `#F4F5FF` | `#263BA8` | Bright primary pulse used by running-state animations |
| `accentShimmer` | `#AAB7FF` | `#3F4DB5` | Bright accent pulse for attention animations |
| `warningShimmer` | `#FFD474` | `#6F4700` | Bright warning pulse for attention animations |
| `borderShimmer` | `#848CA8` | `#4F567A` | Bright border pulse for focused-panel animations |
| `textDimShimmer` | `#B6B9C7` | `#222A4A` | Bright dim-text pulse for thinking and status animations |
| `text` | `#E0E0E0` | `#1A1A1A` | Body text in dialogs, todos, Markdown, tool output, and message bullets |
| `textStrong` | `#F5F5F5` | `#1A1A1A` | Emphasized text in input dialogs, status messages, and high-signal labels |
| `textDim` | `#888888` | `#454545` | Secondary text for thinking, hints, descriptions, completed todos, and status metadata |
| `textMuted` | `#6B6B6B` | `#5F5F5F` | Faint text for counters, scroll info, URLs, and code-block borders |
| `border` | `#5A5A5A` | `#737373` | Pane, editor, and Markdown horizontal-rule borders |
| `borderFocus` | `#E8A838` | `#92660A` | Focus and attention borders |
| `success` | `#4EC87E` | `#0E7A38` | Success marks and completed states |
| `warning` | `#E8A838` | `#92660A` | Warning badges, stale markers, and Plan mode hints |
| `error` | `#E85454` | `#B91C1C` | Error messages and failed tool output |
| `toolPendingBg` | `#1D2129` | `#E8EEF7` | Background tint for a running tool card |
| `toolSuccessBg` | `#14171B` | `#F1F3F5` | Background tint for a successful tool card |
| `toolErrorBg` | `#291D1D` | `#F9E9E9` | Background tint for a failed tool card |
| `effortOff` | `#8A8A8A` | `#767676` | Off thinking effort — grey prompt border |
| `effortLow` | `#B3B3B3` | `#8C8C8C` | Low thinking effort — lighter grey prompt border |
| `effortMedium` | `#E8E8E8` | `#404040` | Medium thinking effort — near-white prompt border |
| `effortHigh` | `#6FA8DC` | `#2E6FB8` | High thinking effort — light-blue prompt border |
| `effortXHigh` | `#A78BFA` | `#7048B6` | Extra-high thinking effort — light-purple prompt border |
| `effortMax` | `#F2C744` | `#B8860B` | Maximum thinking effort — gold prompt border |
| `diffAdded` | `#4EC87E` | `#0E7A38` | Added diff lines |
| `diffRemoved` | `#E85454` | `#B91C1C` | Removed diff lines |
| `diffAddedStrong` | `#7AD99B` | `#0E7A38` | Added intra-line changed words |
| `diffRemovedStrong` | `#F08585` | `#B91C1C` | Removed intra-line changed words |
| `diffGutter` | `#6B6B6B` | `#737373` | Diff line-number gutter |
| `diffMeta` | `#888888` | `#5F5F5F` | Diff meta and hunk headers |
| `diffAddedDimmed` | `#57966F` | `#316A48` | De-emphasized added diff context |
| `diffRemovedDimmed` | `#B55E68` | `#8D4852` | De-emphasized removed diff context |
| `roleUser` | `#FFCB6B` | `#9A4A00` | User message accent and skill-activation name |
| `shellMode` | `#BD93F9` | `#7C3AED` | Shell mode (`!`) prompt, editor border, and echoed `$ command` line |
| `workflowTitle` | `#EE9983` | `#9C261C` | Dynamic Workflow mission-control title |
| `agentRed` | `#E2697D` | `#9D2539` | First agent identity color |
| `agentOrange` | `#E2B069` | `#9D6B25` | Second agent identity color |
| `agentYellow` | `#BAE269` | `#759D25` | Third agent identity color |
| `agentGreen` | `#69E273` | `#259D2F` | Fourth agent identity color |
| `agentCyan` | `#69E2CE` | `#259D89` | Fifth agent identity color |
| `agentBlue` | `#699CE2` | `#25579D` | Sixth agent identity color |
| `agentPurple` | `#9269E2` | `#4D259D` | Seventh agent identity color |
| `agentPink` | `#E269D8` | `#9D2593` | Eighth agent identity color |
| `rainbowRed` | `#E96E63` | `#9C261C` | Red spectrum stop for future highlighting |
| `rainbowOrange` | `#E9B163` | `#9C671C` | Orange spectrum stop for future highlighting |
| `rainbowYellow` | `#DEE963` | `#919C1C` | Yellow spectrum stop for future highlighting |
| `rainbowGreen` | `#63E96E` | `#1C9C26` | Green spectrum stop for future highlighting |
| `rainbowBlue` | `#639BE9` | `#1C519C` | Blue spectrum stop for future highlighting |
| `rainbowIndigo` | `#6E63E9` | `#261C9C` | Indigo spectrum stop for future highlighting |
| `rainbowViolet` | `#C763E9` | `#7C1C9C` | Violet spectrum stop for future highlighting |
| `modeAutoAccept` | `#66D49A` | `#26704C` | Auto-accept mode badge |
| `modePlan` | `#A9B8FF` | `#4A5BC4` | Plan mode badge |
| `modePermission` | `#D99AF0` | `#7A3C96` | Permission mode badge |
| `modeFast` | `#FFB45E` | `#9A570F` | Fast mode badge |
| `background` | `#000000` | `#FFFFFF` | Assumed terminal background for themed surfaces |
| `inverseText` | `#FFFFFF` | `#0B1020` | Foreground for active tabs; keep contrast with `selectionBg` at 4.5:1 or higher |
| `selectionBg` | `#344274` | `#C9D1FA` | Background for active tabs; keep contrast with `inverseText` at 4.5:1 or higher |
| `surfaceHighlight` | `#1C2238` | `#E8EBFC` | Subtle fill for highlighted rows and message surfaces |
| `progressFill` | `#25764A` | `#3B9A65` | Filled Dynamic Workflow progress segment |
| `progressHead` | `#4EC87E` | `#0E7A38` | Dynamic Workflow progress head |
| `progressEmpty` | `#D9DEE8` | `#6B7280` | Empty Dynamic Workflow progress segment |

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
