# TUI Design Spec

> Single source of truth for every dialog, selector, and input in this directory. Read this file before adding or changing interactive components, and check the checklist at the end before submitting.
> Reference component: `components/dialogs/model-selector.ts` (`/model`). All list-style dialogs align header, hint, search, selection, and current-state styling to it.

---

## 1. Visual states

| Semantics | Spec | Constant / token |
|---|---|---|
| Selected pointer | `❯ ` (`primary`) | `constant/symbols.ts` → `SELECT_POINTER` |
| Selected text | `primary` + bold | `chalk.hex(colors.primary).bold` |
| Current / active item | trailing ` ← current` (`success`) | `constant/symbols.ts` → `CURRENT_MARK` |
| Danger item / action | `error` (bold when selected) | `chalk.hex(colors.error)` |
| Danger confirm `[y/N]` | `warning` + bold | `chalk.hex(colors.warning)` |
| Toggle on | trailing `  enabled` (`success`) | `chalk.hex(colors.success)` |
| Toggle off | trailing `  disabled` (`textDim`) | `chalk.hex(colors.textDim)` |
| List / selector border | flat `─` (`primary`), top and bottom only | — |
| Input border | rounded `╭ ╮ ╰ ╯` (`primary`) | — |

- **Do not** invent custom selection pointers (`>` / `▶` / `→`, etc.); always use `SELECT_POINTER`.
- **Do not** use `● ` / `(current)` for the current item; always use `CURRENT_MARK` (trailing, `success`, with a leading space).
- Current item and selected item are **independent**: current item is the value in effect (trailing marker); selected item is the row under the cursor (pointer + highlight). Both can be on the same row.
- **Primary chat composer exception:** the main chat composer is compact and unboxed while it occupies one visual row, using `› ` as its prompt. It gains the normal rounded `╭ ╮ ╰ ╯` border only after wrapping or an explicit newline. Dialog and multi-field inputs retain the rounded-border rule.

## 2. Colors

- Always use **semantic tokens**: `chalk.hex(colors.<token>)`. The repo's `chalk-named-color-guard` enforces this; **do not** use named colors like `chalk.red` / `chalk.gray`.
- `ThemeStyles` (`state.theme.styles.*()`) is an optional convenience wrapper. Either style is fine, but colors must come from `ColorPalette` tokens.
- Available semantic tokens are in `theme/colors.ts`: `primary` `accent` `text` `textStrong` `textDim` `textMuted` `border` `borderFocus` `success` `warning` `error` `status` …
- Active `/model` provider and `AskUserQuestion` tabs use `selectionBg` for the background and `inverseText` for the foreground. Keep this pair at 4.5:1 contrast or higher.
- The runtime validates six-digit hex syntax for each color, but it does not enforce or repair color contrast.
- **Do not highlight keys in hint lines**: the whole hint line uses `textMuted`; do not color `Enter` / `Esc` / `D` separately.

## 3. Standard list-dialog layout

Use `model-selector` as the template. Top to bottom:

```
─────────────────────────────────────────  ① top border (primary, full-width ─)
 Select a model  (type to search)          ② title (primary+bold) + searchable suffix when query is empty (textMuted)
 ↑↓ navigate · Enter select · Esc cancel    ③ hint (textMuted, directly under title, no key highlighting)
                                            ④ blank line
 Search: gpt                                ⑤ search row: only when query is non-empty (` Search: ` primary + query text)
  ❯ GPT-5            openai                  ⑥ list row: pointer + name (left) + secondary column (right, textMuted)
    Pythinker K2          Pythinker Code ← current        current item trailing ` ← current` (success)
                                            ⑦ blank line
 ▼ 3 more                                   ⑧ scroll / match indicator: `▼ N more` without query, `x / y` with query
─────────────────────────────────────────  ⑨ bottom border (primary, full-width ─)
```

Hard rules:

- **Only one top `─` in the header**. Title is followed immediately by the hint; **no** extra `─` between them. The dialog has exactly two full-width `─` lines (top + bottom).
- **`(type to search)` appears only in the title suffix** (searchable list, empty query); the hint line **must not** repeat "type to search".
- **`Search:` row sits below the blank line and above the list**, rendered only when query is non-empty.
- Hint sits directly under the title (no blank line between); one blank line separates hint from body.
- Every line ends with `truncateToWidth(line, width)` so wide characters and narrow terminals do not overflow.

## 4. Hint lines and copy (English UI)

Each hint segment is **key + description**, separated by ` · ` (space-middle-dot).

| Action | Key token | Description | Full segment |
|---|---|---|---|
| Move | `↑↓` | navigate | `↑↓ navigate` |
| Page | `←→` or `PgUp/PgDn` | page | `←→ page` |
| Confirm / select | `Enter` | select | `Enter select` |
| Cancel / close | `Esc` | cancel | `Esc cancel` |
| Delete | `D` | delete | `D delete` |
| Clear search | `Backspace` | clear | `Backspace clear` |
| Switch provider | `Tab` | toggle provider | `Tab toggle provider` |
| Search (title suffix) | typing | — | `(type to search)` |

- **Key tokens are capitalized** (`Enter` / `Esc` / `Tab` / `Backspace` / `D`); **descriptions are lowercase** (navigate / select / cancel / page / delete / clear). Direction glyphs `↑↓` / `←→` stay as-is.
- Direction glyphs use `↑↓` (not `▲/▼`).
- Leaving a dialog is always `cancel` (do not mix close / back / exit / dismiss). Domain-specific wording (e.g. approval reject) is an exception.
- Hints stay minimal by state: when a searchable list has no query, "type to search" already appears in the title suffix, so the hint does not repeat it; with a query, append `Backspace clear`.

## 5. Tab bar (`/model` provider switching)

`tabbed-model-selector` wraps the flat `model-selector` with provider tabs, styled like **AskUserQuestion** tabs:

```
 Select a model  (type to search)
 Tab toggle provider · ↑↓ navigate · Enter select · Esc cancel   ← hint starts with Tab switching
                                            ← blank line
 All   Pythinker Code   openai                   ← tab bar: active tab filled background (selectionBg bg + inverseText fg + bold), others textMuted
                                            ← blank line
  ❯ ...
```

- Tab bar position: **below the hint line**, with **one blank line above and below** (separated from hint and list).
- Active tab: `chalk.bgHex(colors.selectionBg).hex(colors.inverseText).bold(\` ${label} \`)`; inactive: `chalk.hex(colors.textMuted)`. Visible widths must match so switching does not jitter.
- First tab is always `All` (all providers aggregated); **default to `All`**. Only pass `initialTabId` explicitly (e.g. after `/provider` add flow) to land on a specific provider tab.
- `Tab` / `Shift+Tab` cycle tabs; hint's first segment is `Tab toggle provider`.
- Current model in its tab still uses `❯` + ` ← current`; switching tabs does not lose positioning.

## 6. Keybindings

| Action | Key | Detection |
|---|---|---|
| Move | `↑` / `↓` | `matchesKey(data, Key.up/down)` |
| Page | `PgUp` / `PgDn` | `matchesKey(data, Key.pageUp/pageDown)` |
| Confirm / select | `Enter` | `matchesKey(data, Key.enter)` |
| Cancel / close | `Esc` | `matchesKey(data, Key.escape)` |
| Delete | `D` | `printableChar(data) === 'D'` (also accepts `'d'`) |
| Search | typing | `printableChar(data)` |

- **Character comparisons must go through `printableChar()`** (Kitty protocol), enforced by `printable-key-guard`; function keys use `matchesKey(data, Key.*)`.
- **Two-stage `Esc`**: when query is non-empty, clear query first (`list.clearQuery()`); only call `onCancel()` when query is empty.
- `←` / `→` are context-dependent: in components without paging they switch values (e.g. `/model` thinking effort); in lists like `choice-picker` they page. **Do not** use `←→` for paging in components that already use it for thinking effort.
- **Delete is always letter `D`** (`/provider`, `/plugins`). Letter keys require the list **not** be type-to-search (otherwise input goes into search). Current delete lists are not searchable; if a list needs both search and delete, delete must use a non-printable key.

## 7. Toggle lists and multi-select

For per-row on/off lists (e.g. installed plugins in `/plugins`, MCP server lists). Unlike single-select (`Enter` commits and closes), toggle lists use `Space` to flip the current row in place without closing the dialog.

```
 Plugins
 ↑↓ navigate · Space toggle · Enter details · Esc cancel
                                            ← blank line
 Installed plugins (2)                      ← section title (textStrong / bold)
  ❯ Pythinker Datasource  enabled                ← selected row (❯ + primary+bold name) + status label (success)
    id pythinker-datasource · 1 skill · MCP 1/1 · via code.pythinker.com · official   ← secondary line (textMuted, ` · ` separated)
    Superpowers  disabled                   ← unselected row (text name) + off label (textDim)
    id superpowers · 14 skills · via code.pythinker.com · curated
```

Rules:

- **`Space` toggles the current row** (on ↔ off), applies immediately, dialog stays open; hint includes `Space toggle`.
- **Status labels** follow the name with two spaces: on ` enabled` (`success`), off ` disabled` (`textDim`). Other semantics (`installed`=success, `install…`=primary) follow the same `statusStyle` pattern.
- `Enter` has a separate role in toggle lists (e.g. `Enter details`); it does not toggle.
- When multiple actions exist (toggle / details / delete / submenu), list every hint segment with capitalized keys: `Space toggle · Enter details · D remove` (see section 4).
- Rows may have one secondary line below (id / counts / source / trust level), `textMuted`, ` · ` separated.

## 8. Thinking control (`/model` only)

Below the list, show the selected model's thinking effort levels as segments:

- Title: `Thinking  (←→ to switch)` when the model offers more than one level; `Thinking` only otherwise.
- `toggle`: one segment per selectable level — `off` plus the model's `supportEfforts` (fallback `low / med / high`), e.g. `off  low  [ med ]  high`; active segment `primary+bold`, labels via `shortEffortLabel` (`medium` → `med`).
- `always-on`: the supported levels without an `off` segment.
- `unsupported`: a single muted `Off (Unsupported)` (textMuted).
- `←` / `→` move the draft one level within the list (no wraparound); the draft commits on `Enter`. Availability/level helpers live in `utils/thinking-levels.ts` (`effortLevelsForModel`, `coerceEffortForModel`).

## 9. Multi-field inputs

- Rounded box `╭ ╮ ╰ ╯` (`primary`).
- Field switching: `Tab` / `Shift+Tab` / `↑` / `↓`.
- `Enter`: non-final field → advance; final field → submit.
- Cancel: `Esc` / `Ctrl+C` / `Ctrl+D`.
- Footer follows focus: non-final fields show `Enter next`, final field shows `Enter submit`.
- Required-field validation focuses in field order (e.g. custom-registry: empty URL → focus URL, empty token → focus token), with matching sub-prompt error state.

## 10. Shared components (reuse; do not reinvent)

| Pattern | Component |
|---|---|
| List cursor / search / paging state machine | `utils/searchable-list.ts` → `SearchableList` |
| Paged view | `utils/paging.ts` → `pageView` |
| Kitty printable chars | `utils/printable-key.ts` → `printableChar` / `isPrintableChar` (with guard) |
| Selection pointer / current marker | `constant/symbols.ts` → `SELECT_POINTER` / `CURRENT_MARK` |

New list components **must reuse `SearchableList`** (cursor / search / paging) and manually align layout, keybindings, and copy with sections 3–8 of this file.

## 11. Checklist for new / changed dialogs

- [ ] Header follows section 3: top `─`, title (+ `(type to search)` suffix), hint, blank line, `Search:` row, list, bottom `─`; **no** inner `─` under the title.
- [ ] Hint line is all `textMuted`, **no** per-key highlighting; keys capitalized, descriptions lowercase, ` · ` separators.
- [ ] Selection pointer is `SELECT_POINTER`, current item is `CURRENT_MARK`; no custom `>` / `▶` / `→` / `● ` / `(current)`.
- [ ] All colors from `colors.<token>`; no named colors.
- [ ] Keys: `↑↓` move, `PgUp/PgDn` page, `Enter` confirm, `Esc` cancel (searchable lists: two-stage Esc — clear query then close), `D` delete; character checks via `printableChar()`.
- [ ] Leaving a dialog says `cancel` only; no close / back / exit / dismiss mix.
- [ ] Toggle lists use `Space toggle` in place without closing; status labels ` enabled` (`success`) / ` disabled` (`textDim`) two spaces after the name (section 7).
- [ ] Long lists show scroll / page indicators (`▼ N more` or `x / y`); empty states are explicit (`No matches`, etc.).
- [ ] Every line uses `truncateToWidth(line, width)` so wide characters and narrow terminals do not overflow.
- [ ] Reuse `SearchableList`; input boxes use rounded borders; multi-field inputs support `Tab/↑↓` switching and Enter advance / final submit.
- [ ] Component tests cover render snapshots and `handleInput` key behavior.
