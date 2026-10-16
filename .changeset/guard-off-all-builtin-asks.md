---
"@pymodel/pythinker-code": patch
---

Setting `dangerous_command_guard = false` now also turns off the confirmation prompts for sensitive files such as `.env` and for git control paths; set it to `true` to restore them.
