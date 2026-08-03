---
"@pythoughts/pythinker-code": patch
---

Fix display-width measurement on the OpenTUI render path: strip ANSI escapes before measuring, segment by grapheme cluster so ZWJ emoji and skin-tone modifiers count once, and expand tabs to match the legacy renderer. Footer, composer, and dialog-list text no longer mis-truncate when coloured or containing emoji.
