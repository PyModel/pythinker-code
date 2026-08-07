---
"@pythoughts/pythinker-code": patch
---

Accept a provider's plain id for `--provider` at login, so a catalog provider no longer has to be named by its full display name, and stop a cancelled OpenAI Codex sign-in from holding the process open for the rest of its two-minute callback timeout. In the editor extension, signing in now shows one cancellable progress notification, a repeated sign-in joins the one already running instead of opening a second set of prompts, and a completed sign-in is no longer reported as failed when the status refresh behind it fails.
