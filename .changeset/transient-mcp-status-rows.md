---
"@pythoughts/pythinker-code": patch
---

Make MCP startup status lines transient in the TUI: connected/disabled rows show a success mark and disappear after 3 seconds instead of permanently cluttering the transcript, while failed and needs-auth rows stay visible. The welcome-header aggregate remains the durable indicator.
