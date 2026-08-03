---
"@pythoughts/pythinker-code": minor
---

Wire the vim core into the composer behind an opt-in `vimMode` option. A narrow, version-pinned bridge is the only seam to pi-tui's private editor state; terminal escape sequences and bracketed pastes are classified before vim sees them, so paste, arrows, and Kitty-protocol keys keep working in every mode.
