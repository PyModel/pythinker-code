---
"@pymodel/pythinker-code": patch
---

Add four shared UI primitives to the web app: `Popover`, `MenuRow`, `SwitchToggle` and `Chip`. `Popover` holds the anchored-menu positioning that each menu used to write for itself, including the flip above the trigger and the viewport clamp. `MenuRow` carries the standard list row, sized from `--ui-font-size` so the font-size setting still scales it. All four style themselves only from theme tokens, and a guard test fails on any colour literal.
