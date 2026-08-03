---
"@pythoughts/pythinker-code": minor
---

Add the `/update` slash command (alias `/upgrade`) the welcome banner has been advertising: it checks the CDN for a newer version and installs it in the background, falling back to a copyable command for installs that cannot self-update (e.g. Homebrew). `pythinker doctor` now reports whether auto-update is on, off via `tui.toml [upgrade].auto_install`, or disabled by `PYTHINKER_CODE_NO_AUTO_UPDATE`.
