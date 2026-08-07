---
"@pythoughts/pythinker-code": patch
---

Refuse a device authorization whose verification URL is not HTTPS. Every surface hands that URL to the host's "open externally" API, so a provider answering with `file:`, `javascript:`, or an installed application's own scheme had the agent launch it. The check runs where the response is parsed, so the terminal, the TUI, and the editor extension are all covered.
