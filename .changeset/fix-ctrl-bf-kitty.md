---
"@pythoughts/pythinker-code": patch
---

Fix ctrl+b / ctrl+f paging in the approval preview and task output viewer under the Kitty keyboard protocol. Both shortcuts compared raw C0 bytes, so they did nothing in terminals that send CSI-u — including VSCode's integrated terminal — while the page-up/page-down checks beside them worked.
